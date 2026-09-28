import { z } from "zod";

/**
 * Single source of truth for email shapes + campaign limits.
 * Imported by the Express API (request validation) and the Vite web app
 * (client-side pre-validation + shared TypeScript types).
 */

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const scheduleCampaignSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(300),
  body: z.string().trim().min(1, "Body is required").max(100_000),
  senderId: z.string().min(1).optional(),
  from: z.string().email().optional(),
  startAt: z.coerce.date({ invalid_type_error: "startAt must be ISO datetime" }),
  delaySec: z.coerce.number().int().min(0).max(3600).default(2),
  hourlyLimit: z.coerce.number().int().min(1).max(10_000).default(200),
  to: z.array(emailSchema).max(2000).optional().default([]),
});

export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>;

export const emailQuerySchema = z.object({
  status: z.enum(["scheduled", "sending", "sent", "failed"]).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["scheduledAt", "sentAt", "createdAt"]).default("scheduledAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type EmailQuery = z.infer<typeof emailQuerySchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  email: emailSchema,
  password: z.string().min(6, "Password min 6 chars").max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password required").max(128),
});

export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;

/** Extract + dedupe email addresses from arbitrary CSV/TXT text. */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = String(text).match(EMAIL_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const e = raw.trim().toLowerCase();
    if (emailSchema.safeParse(e).success && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

/** UTC hour bucket `YYYYMMDDHH` — all quota windows are UTC. */
export function hourBucketUTC(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}`
  );
}

/** ms from `date` until the end of its UTC hour. */
export function msUntilNextHourEnd(date: Date = new Date()): number {
  const next = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours() + 1,
      0,
      0,
      0,
    ),
  );
  return Math.max(0, next.getTime() - date.getTime());
}
