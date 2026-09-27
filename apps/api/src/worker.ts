import { QueueEvents, Worker } from "bullmq";
import { bullConnection } from "./redis.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { EMAIL_QUEUE_NAME, type SendJobData } from "./queue.js";
import { processJob } from "./processor.js";
import { reconcile } from "./reconciler.js";
import { ensureIndex } from "./es.js";

/**
 * Long-lived local worker (Docker `worker` + `npm run worker:dev`).
 * Pure BullMQ delayed jobs — zero cron. Limiter enforces the global 2s floor
 * (Redis-backed, cross-worker); Lua quota handles hourly caps.
 */
async function main(): Promise<void> {
  await ensureIndex().catch((err) => logger.warn({ err }, "ensureIndex failed"));

  const worker = new Worker<SendJobData>(EMAIL_QUEUE_NAME, (job, token) => processJob(job, token), {
    connection: bullConnection,
    concurrency: env.WORKER_CONCURRENCY,
    limiter: { max: 1, duration: env.MIN_GAP_MS },
  });

  worker.on("completed", (job) => logger.info({ id: job.id }, "job completed"));
  worker.on("failed", (job, err) => logger.warn({ id: job?.id, err: err.message }, "job failed"));
  worker.on("error", (err) => logger.error({ err }, "worker error"));

  // DelayedError reschedules (rate-limit path) are neither completed nor failed;
  // QueueEvents surfaces them so hourly-cap delays stay visible in demos/triage.
  const events = new QueueEvents(EMAIL_QUEUE_NAME, { connection: bullConnection });
  events.on("delayed", ({ jobId, delay }) => logger.info({ id: jobId, delay }, "job delayed (rate-limit reschedule)"));

  const { requeued, resetStale } = await reconcile().catch((err) => {
    logger.warn({ err }, "reconcile failed at boot");
    return { requeued: 0, resetStale: 0 };
  });
  logger.info(
    { concurrency: env.WORKER_CONCURRENCY, gapMs: env.MIN_GAP_MS, requeued, resetStale },
    "worker started",
  );
}

main().catch((err) => {
  logger.error({ err }, "worker boot failed");
  process.exit(1);
});
