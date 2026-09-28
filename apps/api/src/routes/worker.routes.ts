import { Router } from "express";
import type { JobType } from "bullmq";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { env } from "../env.js";
import { runTick } from "../tick.js";
import { emailQueue, type SendJobData } from "../queue.js";

export const workerRouter = Router();

/**
 * Queue overview for the in-app Queues page. Counts are EMAIL truth scoped to
 * the caller (scheduled-due / scheduled-future / sending / sent / failed) —
 * exact on every runtime, including live where no persistent worker moves
 * BullMQ jobs to completed/failed. Raw queue internals stay on bull-board.
 */
workerRouter.get("/status", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.userId!;
    const now = new Date();
    const [delayed, waiting, active, completed, failed, due] = await Promise.all([
      prisma.email.count({ where: { userId, status: "scheduled", scheduledAt: { gt: now } } }),
      prisma.email.count({ where: { userId, status: "scheduled", scheduledAt: { lte: now } } }),
      prisma.email.count({ where: { userId, status: "sending" } }),
      prisma.email.count({ where: { userId, status: "sent" } }),
      prisma.email.count({ where: { userId, status: "failed" } }),
      // Scoped like every other count: a caller must never see other
      // tenants' backlog size in their own dashboard numbers.
      prisma.email.count({ where: { userId, status: "scheduled", scheduledAt: { lte: now } } }),
    ]);
    res.json({ waiting, delayed, active, completed, failed, due, now: now.toISOString() });
  } catch (err) {
    next(err);
  }
});

const JOB_STATES = ["waiting", "active", "delayed", "completed", "failed"] as const;
type JobState = (typeof JOB_STATES)[number];

/**
 * Job list scoped to the caller. Placement follows EMAIL truth, not raw BullMQ
 * state: live has no persistent worker, so a sent email's job can sit in
 * `waiting` forever — it is shown under Completed anyway (and hidden from
 * Waiting). Missing-job emails are synthesized so no tab ever drops rows that
 * the counts promise. Users only ever see their own emails.
 */
workerRouter.get("/jobs", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.userId!;
    const raw = String(req.query.state ?? "delayed");
    const state: JobState = (JOB_STATES as readonly string[]).includes(raw) ? (raw as JobState) : "delayed";
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const jobs = await emailQueue.getJobs([state] as JobType[], 0, limit - 1);
    const emailIds = jobs.map((j) => (j.data as SendJobData)?.emailId).filter(Boolean);
    const emails = emailIds.length
      ? await prisma.email.findMany({
          where: { id: { in: emailIds }, userId },
          select: {
            id: true, to: true, subject: true, status: true, attempts: true,
            scheduledAt: true, sentAt: true, createdAt: true, error: true,
          },
        })
      : [];
    const byId = new Map(emails.map((e) => [e.id, e]));
    const terminalBucket = (s: string): JobState | null =>
      s === "sent" ? "completed" : s === "failed" ? "failed" : null;

    type Row = {
      jobId: string; state: JobState; attemptsMade: number; delay: number;
      timestamp: number; processedOn: number | null; finishedOn: number | null;
      failedReason: string | null;
      email: {
        id: string; to: string; subject: string; status: never; attempts: number;
        scheduledAt: string; sentAt: string | null; createdAt: string; error: string | null;
      };
    };
    const data: Row[] = [];
    const represented = new Set<string>();
    for (const j of jobs) {
      const email = byId.get((j.data as SendJobData)?.emailId);
      if (!email) continue; // someone else's job (or gone)
      const bucket = terminalBucket(String(email.status));
      if (bucket && bucket !== state) continue; // truth lives under another tab
      represented.add(email.id);
      data.push({
        jobId: j.id ?? "",
        state,
        attemptsMade: j.attemptsMade,
        delay: j.opts.delay ?? 0,
        timestamp: j.timestamp,
        processedOn: j.processedOn ?? null,
        finishedOn: j.finishedOn ?? null,
        failedReason: (j.failedReason ?? "").slice(0, 300) || null,
        email: {
          id: email.id, to: email.to, subject: email.subject,
          status: email.status as never, attempts: email.attempts,
          scheduledAt: email.scheduledAt.toISOString(),
          sentAt: email.sentAt?.toISOString() ?? null,
          createdAt: email.createdAt.toISOString(), error: email.error,
        },
      });
    }

    // Supplement tabs whose BullMQ set is incomplete (live has no worker to
    // move jobs). Synthesized rows carry email truth with job-shaped fields.
    const now = new Date();
    const supplementWhere =
      state === "completed"
        ? { userId, status: "sent" as never }
        : state === "failed"
          ? { userId, status: "failed" as never }
          : state === "delayed"
            ? { userId, status: "scheduled" as never, scheduledAt: { gt: now } }
            : state === "waiting"
              ? { userId, status: "scheduled" as never, scheduledAt: { lte: now } }
              : null;
    if (supplementWhere && data.length < limit) {
      const missing = await prisma.email.findMany({
        where: { ...supplementWhere, id: { notIn: [...represented] } },
        select: {
          id: true, to: true, subject: true, status: true, attempts: true,
          scheduledAt: true, sentAt: true, createdAt: true, error: true,
        },
        orderBy: state === "completed" || state === "failed" ? { sentAt: "desc" } : { scheduledAt: "asc" },
        take: limit - data.length,
      });
      for (const e of missing) {
        data.push({
          jobId: e.id,
          state,
          attemptsMade: e.attempts,
          delay: state === "delayed" ? Math.max(0, e.scheduledAt.getTime() - Date.now()) : 0,
          timestamp: e.createdAt.getTime(),
          processedOn: null,
          finishedOn: e.sentAt?.getTime() ?? null,
          failedReason: state === "failed" ? e.error?.slice(0, 300) ?? null : null,
          email: {
            id: e.id, to: e.to, subject: e.subject, status: e.status as never,
            attempts: e.attempts, scheduledAt: e.scheduledAt.toISOString(),
            sentAt: e.sentAt?.toISOString() ?? null,
            createdAt: e.createdAt.toISOString(), error: e.error,
          },
        });
      }
      if (state === "completed" || state === "failed") {
        data.sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0));
      }
    }
    res.json({ state, data });
  } catch (err) {
    next(err);
  }
});

/** Retry one of the caller's FAILED jobs: reset the row, then BullMQ redelivers
 * the same jobId (processor re-sends; quota re-reserved — a retry is a new send). */
workerRouter.post("/jobs/:id/retry", authMiddleware, async (req, res, next) => {
  try {
    const job = await emailQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    const state = await job.getState().catch(() => "unknown");
    if (state !== "failed") {
      return res.status(409).json({ error: { code: "WRONG_STATE", message: `Only failed jobs can be retried (state: ${state})` } });
    }
    const emailId = (job.data as SendJobData)?.emailId;
    const mine = emailId
      ? await prisma.email.findFirst({ where: { id: emailId, userId: req.userId! }, select: { id: true } })
      : null;
    if (!mine) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    // Reset first: the processor's CAS only claims scheduled/sending rows, so
    // retrying a `failed` row without this would no-op as a duplicate.
    await prisma.email.update({ where: { id: mine.id }, data: { status: "scheduled", error: null } });
    await job.retry();
    res.json({ retried: job.id });
  } catch (err) {
    next(err);
  }
});

/**
 * Vercel Cron driver (1/min). Guarded by CRON_SECRET — Vercel sends it as
 * `Authorization: Bearer <secret>`. Local dev may call it with no secret when
 * CRON_SECRET is unset.
 */
workerRouter.post("/tick", async (req, res, next) => {
  try {
    if (env.CRON_SECRET) {
      const got = req.headers.authorization?.replace("Bearer ", "");
      if (got !== env.CRON_SECRET) {
        return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "bad cron secret" } });
      }
    }
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25) || 25));
    const result = await runTick(limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
