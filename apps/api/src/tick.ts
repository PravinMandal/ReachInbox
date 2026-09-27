import { prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { redis } from "./redis.js";
import { processOne } from "./processor.js";

// Live (Vercel) driver. Hobby has no persistent worker and its crons are
// daily-only, so an external pinger (see .github/workflows/tick.yml) hits
// POST /api/worker/tick; this claims due rows and runs the SAME processOne()
// the local worker uses. Limited outcomes bump scheduledAt into the next
// window (DB-side equivalent of moveToDelayed).
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
  await redis.del("worker:tick:lock").catch(() => undefined);
  return { processed: rows.length, sent, delayed };
}
