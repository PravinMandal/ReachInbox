import { prisma } from "../src/db.js";
import { esClient, ES_INDEX } from "../src/es.js";
import { logger } from "../src/logger.js";

/** Full reindex: Postgres → Elasticsearch (fixes drift, backfills after ES outage). */
async function main(): Promise<void> {
  const rows = await prisma.email.findMany({
    select: { id: true, userId: true, batchId: true, senderId: true, to: true, subject: true, body: true, status: true, scheduledAt: true, sentAt: true },
    take: 50_000,
  });
  const ops = rows.flatMap((r) => [
    { index: { _index: ES_INDEX, _id: r.id } },
    {
      id: r.id, userId: r.userId, batchId: r.batchId, senderId: r.senderId,
      to: r.to, subject: r.subject, body: r.body.slice(0, 5000), status: r.status,
      scheduledAt: r.scheduledAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null,
    },
  ]);
  if (ops.length > 0) await esClient().bulk({ operations: ops as never });
  logger.info({ n: rows.length }, "reindex done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "reindex failed");
    process.exit(1);
  });
