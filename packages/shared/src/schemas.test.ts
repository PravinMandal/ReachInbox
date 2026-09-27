import { describe, expect, it } from "vitest";
import { extractEmails, hourBucketUTC, msUntilNextHourEnd } from "./schemas.js";

describe("extractEmails", () => {
  it("finds addresses in csv/txt soup", () => {
    expect(extractEmails("name,email\na,A@x.io\nb,B@x.io")).toEqual(["a@x.io", "b@x.io"]);
  });
  it("lowercases + dedupes + drops junk", () => {
    expect(extractEmails("A@X.IO, a@x.io, nope, b@y.co")).toEqual(["a@x.io", "b@y.co"]);
  });
  it("returns [] for empty input", () => {
    expect(extractEmails("")).toEqual([]);
    expect(extractEmails(undefined)).toEqual([]);
  });
});

describe("hourBucketUTC", () => {
  it("formats YYYYMMDDHH in UTC", () => {
    expect(hourBucketUTC(new Date(Date.UTC(2026, 0, 2, 3, 4)))).toBe("2026010203");
  });
});

describe("msUntilNextHourEnd", () => {
  it("lands within the hour", () => {
    const ms = msUntilNextHourEnd(new Date(Date.UTC(2026, 0, 2, 3, 30)));
    expect(ms).toBe(30 * 60 * 1000);
  });
});
