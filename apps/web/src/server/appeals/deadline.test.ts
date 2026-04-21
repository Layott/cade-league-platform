import { describe, it, expect } from "vitest";
import { computeAppealDeadline, APPEAL_DEADLINE_BUSINESS_DAYS } from "./deadline";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE } from "@/lib/time";

describe("computeAppealDeadline", () => {
  it("uses 5 business days", () => {
    expect(APPEAL_DEADLINE_BUSINESS_DAYS).toBe(5);
  });

  it("Friday 2026-05-01 submit → Friday 2026-05-08 deadline (scenario B)", () => {
    const submitted = new Date("2026-05-01T10:00:00+01:00");
    const deadline = computeAppealDeadline(submitted);
    expect(formatInTimeZone(deadline, APP_TIMEZONE, "yyyy-MM-dd HH:mm:ss")).toBe(
      "2026-05-08 23:59:59",
    );
  });

  it("Wednesday submit → following Wednesday deadline", () => {
    const submitted = new Date("2026-05-06T12:00:00+01:00");
    const deadline = computeAppealDeadline(submitted);
    expect(formatInTimeZone(deadline, APP_TIMEZONE, "yyyy-MM-dd")).toBe(
      "2026-05-13",
    );
  });
});
