import { Worker } from "bullmq";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { redis } from "./redis.js";
import { bullConnection } from "./redis.js";
import { EMAIL_QUEUE_NAME, emailQueue, type SendJobData } from "./queue.js";
import { processJob } from "./processor.js";

// Live (Vercel) driver. Hobby has no persistent worker and its crons are
// daily-only, so an external pinger (see .github/workflows/tick.yml) hits
// POST /api/worker/tick.
//
// Why an ephemeral Worker instead of calling processOne() directly: BullMQ
// only moves jobs to completed/failed/delayed via the worker lock token.
// Direct DB+SMTP processing left bull-board stuck at perpetual 0s (the old
// code even deleted processed jobs, hiding all history). A short-lived
// Worker runs the SAME processJob() the local worker uses, so completed /
// failed / delayed tabs populate truthfully on every runtime.
export async function runTick(limit = 25): Promise<{ processed: number; sent: number; delayed: number }> {
  // Overlap guard: FOR UPDATE below cannot span the whole run (autocommit), so
  // serialize ticks with a Redis lock instead. A second tick exits quietly.
  const lock = await redis.set("worker:tick:lock", "1", "EX", 90, "NX");
  if (!lock) {
    logger.info("tick skipped — previous tick still running");
    return { processed: 0, sent: 0, delayed: 0 };
  }

  const now = new Date();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Email"
    WHERE status = 'scheduled' AND "scheduledAt" <= ${now}
    ORDER BY "scheduledAt" ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `;

  if (rows.length === 0) {
    await redis.del("worker:tick:lock").catch(() => undefined);
    return { processed: 0, sent: 0, delayed: 0 };
  }

  // Make sure every due row has a live BullMQ job for the worker to claim.
  // Old ticks deleted processed jobs, so rows from that era have none.
  const targets: string[] = [];
  for (const row of rows) {
    try {
      let job = await emailQueue.getJob(row.id);
      if (job) {
        const state = await job.getState().catch(() => "unknown");
        // Terminal leftovers block re-add under the same jobId — clear them;
        // a `scheduled` row with a completed job means it was never really sent.
        if (state === "completed" || state === "failed" || state === "unknown") {
          await job.remove().catch(() => undefined);
          job = undefined;
        }
      }
      if (!job) {
        const added = await emailQueue
          .add("send", { emailId: row.id, index: 0, gapMs: env.MIN_GAP_MS }, { jobId: row.id })
          .catch(() => undefined);
        if (!added) continue;
      }
      targets.push(row.id);
    } catch (err) {
      logger.warn({ err, id: row.id }, "tick ensure-job failed");
    }
  }

  // Ephemeral worker: claims waiting jobs, runs processJob with its own
  // token, and lets BullMQ record completed/failed/delayed normally.
  const done = new Set<string>();
  const worker = new Worker<SendJobData>(EMAIL_QUEUE_NAME, (job, token) => processJob(job, token), {
    connection: bullConnection,
    concurrency: Math.min(5, Math.max(1, targets.length)),
    limiter: { max: 1, duration: env.MIN_GAP_MS },
  });
  const finished = new Promise<void>((resolve) => {
    const check = (): void => {
      if (done.size >= targets.length) resolve();
    };
    worker.on("completed", (job) => {
      if (job.id) done.add(job.id);
      check();
    });
    worker.on("failed", (job) => {
      if (job?.id) done.add(job.id);
      check();
    });
  });

  try {
    await worker.waitUntilReady().catch(() => undefined);
    // Bounded wait: small (inline-drain) batches resolve fast; big waker
    // batches return counts-so-far and the next tick continues. Never hang
    // a serverless function.
    const waitMs = limit <= 3 ? 9000 : 45000;
    await Promise.race([finished, new Promise((r) => setTimeout(r, waitMs))]);

    // Count from BullMQ states, falling back to DB truth for jobs that left
    // the waiting set between the event and the poll.
    let sent = 0;
    let delayed = 0;
    for (const id of targets) {
      try {
        const job = await emailQueue.getJob(id).catch(() => undefined);
        const state = job ? await job.getState().catch(() => "unknown") : "unknown";
        if (state === "completed") {
          sent++;
        } else if (state === "failed") {
          // failed outcome — counted in `processed`, not `sent`
        } else {
          const row = await prisma.email
            .findUnique({ where: { id }, select: { status: true } })
            .catch(() => null);
          if (row?.status === "sent") sent++;
          else if (state === "delayed") delayed++;
          else if (row?.status === "scheduled" && state === "delayed") delayed++;
        }
      } catch (err) {
        logger.warn({ err, id }, "tick count failed");
      }
    }
    logger.info({ n: targets.length, sent, delayed }, "tick done");
    return { processed: targets.length, sent, delayed };
  } finally {
    await worker.close().catch(() => undefined);
    await redis.del("worker:tick:lock").catch(() => undefined);
  }
}
