import { describe, expect, it } from "vitest";
import {
  globalQuotaKey,
  hourBucketUTC,
  msUntilNextHourEnd,
  senderQuotaKey,
  slackNotifiedKey,
} from "../src/time.js";

describe("api time helpers", () => {
  it("buckets in UTC", () => {
    expect(hourBucketUTC(new Date(Date.UTC(2026, 5, 1, 0, 0)))).toBe("2026060100");
  });
  it("ms until hour end", () => {
    expect(msUntilNextHourEnd(new Date(Date.UTC(2026, 5, 1, 0, 45)))).toBe(15 * 60 * 1000);
  });
  it("builds stable redis keys", () => {
    expect(globalQuotaKey("2026060100")).toBe("ratelimit:global:2026060100");
    expect(senderQuotaKey("s1", "2026060100")).toBe("ratelimit:sender:s1:2026060100");
    expect(slackNotifiedKey("s1", "2026060100")).toBe("slack:notified:s1:2026060100");
  });
});
