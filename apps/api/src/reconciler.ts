import { prisma } from "./db.js";
import { env } from "./env.js";
import { emailQueue } from "./queue.js";
import { logger } from "./logger.js";

/**
 * Crash/restart recovery. Covers two cases BullMQ alone cannot:
 *  1. Redis was flushed/lost → delayed jobs gone, but Postgres still says
 *     `scheduled`. Re-enqueue anything due with no live job.
 *  2. Worker died mid-send → rows stuck in `sending`. Older than
 *     STALE_SENDING_MINUTES are reset to `scheduled` and requeued.
 * Idempotent: `jobId = email.id` means re-adds are dedups, never duplicates.
 */
export async function reconcile(): Promise<{ requeued: number; resetStale: number }> {
  let requeued = 0;
  let resetStale = 0;

  const staleBefore = new Date(Date.now() - env.STALE_SENDING_MINUTES * 60_000);
  const stale = await prisma.email.updateMany({
    where: { status: "sending", updatedAt: { lt: staleBefore } },
    data: { status: "scheduled" },
  });
  resetStale = stale.count;
  if (resetStale > 0) logger.info({ resetStale }, "reconciler reset stale sending rows");

  const due = await prisma.email.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date(Date.now() + 60_000) } },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
    take: 2000,
  });

  for (const row of due) {
    try {
      const job = await emailQueue.getJob(row.id);
      if (job) {
        const state = await job.getState().catch(() => "unknown");
        if (state === "delayed" || state === "waiting" || state === "active") continue;
      }
      await emailQueue.add(
        "send",
        { emailId: row.id, index: 0, gapMs: env.MIN_GAP_MS },
        { jobId: row.id, delay: Math.max(0, row.scheduledAt.getTime() - Date.now()) },
      );
      requeued++;
    } catch (err) {
      logger.warn({ err, id: row.id }, "reconciler requeue failed");
    }
  }
  if (requeued > 0) logger.info({ requeued }, "reconciler requeued due emails");
  return { requeued, resetStale };
}
