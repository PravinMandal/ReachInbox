/**
 * UTC hour-bucket helpers. ALL quota windows are UTC so multi-instance
 * workers agree regardless of host timezone.
 */
export function hourBucketUTC(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}`
  );
}

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

export function secsUntilHourEnd(date: Date = new Date()): number {
  return Math.ceil(msUntilNextHourEnd(date) / 1000);
}

export function globalQuotaKey(bucket: string): string {
  return `ratelimit:global:${bucket}`;
}

export function senderQuotaKey(senderId: string, bucket: string): string {
  return `ratelimit:sender:${senderId}:${bucket}`;
}

/** Per-batch quota: each campaign gets its own hourly budget so a fresh
 * batch never inherits an earlier batch's spent allowance. */
export function batchQuotaKey(batchId: string, bucket: string): string {
  return `ratelimit:batch:${batchId}:${bucket}`;
}

export function slackNotifiedKey(senderId: string, bucket: string): string {
  return `slack:notified:${senderId}:${bucket}`;
}
