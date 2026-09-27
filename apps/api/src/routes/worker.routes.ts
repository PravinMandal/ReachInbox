import { Router } from "express";
import type { JobType } from "bullmq";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { env } from "../env.js";
import { runTick } from "../tick.js";
import { emailQueue, type SendJobData } from "../queue.js";

export const workerRouter = Router();

/**
 * Live queue overview for the in-app Queues page. Counts are queue-global
 * (single shared queue); the job list below is scoped to the caller.
 */
workerRouter.get("/status", authMiddleware, async (_req, res, next) => {
  try {
    const [waiting, delayed, active, completed, failed] = await Promise.all([
      emailQueue.getWaitingCount().catch(() => -1),
      emailQueue.getDelayedCount().catch(() => -1),
      emailQueue.getActiveCount().catch(() => -1),
      emailQueue.getCompletedCount().catch(() => -1),
      emailQueue.getFailedCount().catch(() => -1),
    ]);
    const due = await prisma.email.count({
      where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    });
    res.json({ waiting, delayed, active, completed, failed, due, now: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

const JOB_STATES = ["waiting", "active", "delayed", "completed", "failed"] as const;
type JobState = (typeof JOB_STATES)[number];

/**
 * Job list scoped to the caller: BullMQ state + the email it carries.
 * Users only ever see their own emails (jobId = email.id, filtered by userId).
 */
workerRouter.get("/jobs", authMiddleware, async (req, res, next) => {
  try {
    const raw = String(req.query.state ?? "delayed");
    const state: JobState = (JOB_STATES as readonly string[]).includes(raw) ? (raw as JobState) : "delayed";
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const jobs = await emailQueue.getJobs([state] as JobType[], 0, limit - 1);
    const emailIds = jobs.map((j) => (j.data as SendJobData)?.emailId).filter(Boolean);
    const emails = emailIds.length
      ? await prisma.email.findMany({
          where: { id: { in: emailIds }, userId: req.userId! },
          select: { id: true, to: true, subject: true, status: true, scheduledAt: true, sentAt: true, error: true },
        })
      : [];
    const byId = new Map(emails.map((e) => [e.id, e]));
    // Drop jobs whose email belongs to someone else (or is gone).
    const data = jobs
      .map((j) => {
        const email = byId.get((j.data as SendJobData)?.emailId);
        if (!email) return null;
        return {
          jobId: j.id ?? "",
          state,
          attemptsMade: j.attemptsMade,
          delay: j.opts.delay ?? 0,
          timestamp: j.timestamp,
          processedOn: j.processedOn ?? null,
          finishedOn: j.finishedOn ?? null,
          failedReason: (j.failedReason ?? "").slice(0, 300) || null,
          email,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
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
