import { UnrecoverableError, DelayedError, type Job } from "bullmq";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { indexEmail } from "./es.js";
import { logger } from "./logger.js";
import { sendEmail } from "./mailer.js";
import { compensateQuota, tryReserveQuota } from "./ratelimit.js";
import { notifyRateLimitOnce } from "./slack.js";
import type { SendJobData } from "./queue.js";
import {
  batchQuotaKey,
  globalQuotaKey,
  hourBucketUTC,
  msUntilNextHourEnd,
  senderQuotaKey,
} from "./time.js";

export interface ProcessOutcome {
  outcome: "sent" | "delayed" | "duplicate" | "failed";
  delayMs?: number;
}

/**
 * The single send pipeline shared by BOTH runtimes:
 * - local: BullMQ Worker calls `processJob(job, token)`
 * - live (Vercel): `POST /api/worker/tick` claims due rows and calls `processOne()`
 *
 * Order matters (reservation-before-CAS):
 *  1. Load row; `sent` = dup-ok (idempotency).
 *  2. Lua reserve quota FIRST — LIMITED leaves the DB untouched (no stuck `sending`).
 *  3. CAS `scheduled→sending` (accept `sending` for same-job BullMQ retries).
 *     CAS miss after a reservation → compensate (DECR) + dup-ok, never send.
 *  4. SMTP via Ethereal → `sent` (+ previewUrl) or error handling.
 *  5. ES re-index (never throws), Slack once per sender/hour on LIMITED.
 */
export async function processOne(
  emailId: string,
  opts: { index?: number; gapMs?: number; reschedule?: (delayMs: number) => Promise<void> } = {},
): Promise<ProcessOutcome> {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { batch: { select: { id: true, hourlyLimit: true } }, sender: { select: { fromEmail: true } } },
  });
  if (!email) {
    logger.warn({ emailId }, "job for missing email — treating as failed");
    throw new UnrecoverableError("email row not found");
  }
  if (email.status === "sent") return { outcome: "duplicate" };

  const bucket = hourBucketUTC();
  const batchCap = email.batch?.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_GLOBAL;
  // Quota is per-BATCH: each campaign gets a fresh hourly budget, so a new
  // batch sends instantly even if an earlier batch spent its allowance.
  // The global cap is the only cross-batch guardrail.
  const verdict = await tryReserveQuota(
    globalQuotaKey(bucket),
    senderQuotaKey(email.senderId, bucket),
    batchQuotaKey(email.batchId, bucket),
    env.MAX_EMAILS_PER_HOUR_GLOBAL,
    env.MAX_EMAILS_PER_HOUR_GLOBAL,
    batchCap,
  );

  if (verdict === "limited") {
    // Delay into next window. Deterministic index offset preserves best-effort
    // order; tiny jitter avoids a thundering herd at the hour boundary.
    const gapMs = opts.gapMs ?? env.MIN_GAP_MS;
    const index = opts.index ?? 0;
    const jitter = Math.floor(Math.random() * 2000);
    const delayMs = msUntilNextHourEnd() + index * gapMs + jitter;

    await notifyRateLimitOnce({
      userId: email.userId,
      senderId: email.senderId,
      fromEmail: email.sender.fromEmail,
      hourBucket: bucket,
      sent: batchCap,
      cap: batchCap,
      delayed: 1,
    }).catch(() => undefined);

    if (opts.reschedule) await opts.reschedule(delayMs);
    return { outcome: "delayed", delayMs };
  }

  // Reservation succeeded — claim the row. Accept `sending` too: BullMQ may
  // redeliver the same jobId after a crash between CAS and completion.
  const claimed = await prisma.email.updateMany({
    where: { id: emailId, status: { in: ["scheduled", "sending"] } },
    data: { status: "sending", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    // Lost the race (already sent/failed by a concurrent attempt) — give the
    // quota slot back and stop. Never send twice.
    await compensateQuota(globalQuotaKey(bucket), senderQuotaKey(email.senderId, bucket), batchQuotaKey(email.batchId, bucket));
    return { outcome: "duplicate" };
  }

  try {
    const result = await sendEmail({
      senderId: email.senderId,
      from: email.sender.fromEmail,
      to: email.to,
      subject: email.subject,
      body: email.body,
    });
    await prisma.email.update({
      where: { id: emailId },
      data: { status: "sent", sentAt: new Date(), messageId: result.messageId, previewUrl: result.previewUrl, error: null },
    });
    await indexEmail({
      id: email.id,
      userId: email.userId,
      batchId: email.batchId,
      senderId: email.senderId,
      to: email.to,
      subject: email.subject,
      body: email.body.slice(0, 5000),
      status: "sent",
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: new Date().toISOString(),
    });
    return { outcome: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = /timeout|temporar|econn|eai_again|rate|421|451|4\d\d/i.test(message);
    if (transient) {
      // Back to `scheduled` — BullMQ backoff retries the same jobId. Quota
      // stays consumed (fail-closed): we attempted a send this hour.
      await prisma.email.update({
        where: { id: emailId },
        data: { status: "scheduled", error: message.slice(0, 2000) },
      });
      throw err;
    }
    await prisma.email.update({
      where: { id: emailId },
      data: { status: "failed", error: message.slice(0, 2000) },
    });
    await indexEmail({
      id: email.id,
      userId: email.userId,
      batchId: email.batchId,
      senderId: email.senderId,
      to: email.to,
      subject: email.subject,
      body: email.body.slice(0, 5000),
      status: "failed",
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: null,
    });
    throw new UnrecoverableError(message);
  }
}

/** BullMQ job wrapper — translates `delayed` into moveToDelayed + DelayedError. */
export async function processJob(job: Job<SendJobData>, token?: string): Promise<ProcessOutcome> {
  const { emailId, index, gapMs } = job.data;
  return processOne(emailId, {
    index,
    gapMs,
    reschedule: async (delayMs: number) => {
      // Persist the new fire time FIRST so DB truth survives even if Redis is
      // lost before the job fires (same as the tick path — one behavior).
      await prisma.email.update({
        where: { id: emailId },
        data: { scheduledAt: new Date(Date.now() + delayMs) },
      });
      // Token-scoped delay: without it BullMQ throws `Missing lock`.
      // DelayedError (not a plain Error) tells BullMQ this is a reschedule,
      // not a failure — attempts are preserved.
      if (token) await job.moveToDelayed(Date.now() + delayMs, token);
      throw new DelayedError();
    },
  });
}
