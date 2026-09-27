import { prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { processOne } from "./processor.js";

/**
 * Live (Vercel) driver. Hobby functions can't host a persistent BullMQ Worker,
 * so Vercel Cron hits `POST /api/worker/tick` 1/min; this claims due rows with
 * `FOR UPDATE SKIP LOCKED` (safe if two ticks overlap) and runs the SAME
 * `processOne()` the local worker uses. Limited outcomes bump `scheduledAt`
 * into the next window (DB-side equivalent of `moveToDelayed`).
 */
export async function runTick(limit = 25): Promise<{ processed: number; sent: number; delayed: number }> {
  const now = new Date();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Email"
    WHERE status = 'scheduled' AND "scheduledAt" <= ${now}
    ORDER BY "scheduledAt" ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `;

  let sent = 0;
  let delayed = 0;
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i]!.id;
    try {
      const out = await processOne(id, {
        index: i,
        gapMs: env.MIN_GAP_MS,
        reschedule: async (delayMs: number) => {
          await prisma.email.update({
            where: { id },
            data: { scheduledAt: new Date(Date.now() + delayMs) },
          });
        },
      });
      if (out.outcome === "sent") sent++;
      if (out.outcome === "delayed") delayed++;
    } catch (err) {
      logger.warn({ err, id }, "tick processOne failed");
    }
  }
  logger.info({ n: rows.length, sent, delayed }, "tick done");
  return { processed: rows.length, sent, delayed };
}
