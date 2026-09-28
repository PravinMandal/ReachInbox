/** Shared API + prop types. Import from `@reachinbox/shared`, never redeclare. */

export type EmailStatus = "scheduled" | "sending" | "sent" | "failed";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

export interface Sender {
  id: string;
  fromEmail: string;
  createdAt: string;
}

export interface EmailRow {
  id: string;
  to: string;
  subject: string;
  body?: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  previewUrl: string | null;
  starred: boolean;
}

export type SearchSource = "es" | "db" | "db-fallback";

export interface PagedEmails {
  data: EmailRow[];
  page: number;
  limit: number;
  total: number;
  source?: SearchSource;
  warning?: string;
}

export interface EmailDetail extends EmailRow {
  error: string | null;
  messageId: string | null;
  sender?: { fromEmail: string };
}

export interface ScheduleResult {
  batchId: string;
  total: number;
  detected: number;
  firstAt: string;
  lastAt: string;
  estimatedHours: number;
  /** Live only: rows already sent inline during the schedule call. */
  instantSent?: number;
  note: string;
}

export interface CountsSummary {
  scheduled: number;
  sent: number;
  failed: number;
}

export type QueueJobState = "waiting" | "active" | "delayed" | "completed" | "failed";

export interface QueueStatus {
  waiting: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
  due: number;
  now: string;
}

export interface QueueJobRow {
  jobId: string;
  state: QueueJobState;
  attemptsMade: number;
  delay: number;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  failedReason: string | null;
  email: {
    id: string;
    to: string;
    subject: string;
    status: EmailStatus;
    attempts: number;
    scheduledAt: string;
    sentAt: string | null;
    createdAt: string;
    error: string | null;
  };
}
