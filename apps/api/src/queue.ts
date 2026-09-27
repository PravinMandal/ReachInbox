import { Queue, QueueEvents } from "bullmq";
import { bullConnection } from "./redis.js";

export const EMAIL_QUEUE_NAME = "email-send";

export interface SendJobData {
  emailId: string;
  /** Position in the batch (0-based) — best-effort order on reschedule. */
  index: number;
  /** Effective per-email gap in ms chosen at enqueue time. */
  gapMs: number;
}

/** Shared queue handle for the API process (enqueue + inspect). */
export const emailQueue = new Queue<SendJobData>(EMAIL_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const emailEvents = new QueueEvents(EMAIL_QUEUE_NAME, {
  connection: bullConnection,
});
