import { describe, it, expect } from "vitest";
import {
  formatWat,
  toWatIso,
  APP_TIMEZONE,
  weekStartThursday,
  thursdayDeadline,
  fridayWindowBounds,
  isWithinFridayWindow,
} from "./time";

describe("time utilities", () => {
  it("APP_TIMEZONE is Africa/Lagos", () => {
    expect(APP_TIMEZONE).toBe("Africa/Lagos");
  });

  it("formatWat formats UTC to WAT (UTC+1, no DST)", () => {
    const d = new Date("2026-04-20T15:00:00Z");
    expect(formatWat(d, "yyyy-MM-dd HH:mm")).toBe("2026-04-20 16:00");
  });

  it("toWatIso returns WAT offset", () => {
    const d = new Date("2026-04-20T15:00:00Z");
    expect(toWatIso(d)).toMatch(/^2026-04-20T16:00:00\+01:00$/);
  });
});

describe("weekStartThursday", () => {
  // 2026-04-20 is a Monday in WAT. Most-recent Thursday: 2026-04-16.
  it("rolls Monday back to previous Thursday", () => {
    const d = new Date("2026-04-20T09:00:00+01:00");
    expect(weekStartThursday(d)).toBe("2026-04-16");
  });

  // 2026-04-16 is Thursday itself → returns same day.
  it("returns the Thursday itself when given a Thursday", () => {
    const d = new Date("2026-04-16T08:00:00+01:00");
    expect(weekStartThursday(d)).toBe("2026-04-16");
  });

  // UTC instant that falls on Wed 23:30 UTC == Thu 00:30 WAT → Thu anchor.
  it("respects WAT timezone at midnight boundary", () => {
    // 2026-04-15T23:30:00Z → 2026-04-16T00:30+01:00 (Thursday)
    const d = new Date("2026-04-15T23:30:00Z");
    expect(weekStartThursday(d)).toBe("2026-04-16");
  });

  // Saturday rolls back to Thursday of the same calendar week.
  it("rolls Saturday back to preceding Thursday", () => {
    const d = new Date("2026-04-18T10:00:00+01:00");
    expect(weekStartThursday(d)).toBe("2026-04-16");
  });
});

describe("thursdayDeadline", () => {
  it("returns 10:00 WAT on the given Thursday as a UTC Date", () => {
    const d = thursdayDeadline("2026-04-16");
    expect(d.toISOString()).toBe("2026-04-16T09:00:00.000Z");
  });
});

describe("fridayWindowBounds", () => {
  it("opens at 21:00 WAT Friday, closes at 22:00 WAT Friday", () => {
    const { openAt, closeAt } = fridayWindowBounds("2026-04-16");
    expect(openAt.toISOString()).toBe("2026-04-17T20:00:00.000Z");
    expect(closeAt.toISOString()).toBe("2026-04-17T21:00:00.000Z");
  });
});

describe("isWithinFridayWindow", () => {
  const weekStart = "2026-04-16"; // Thursday; Friday is 2026-04-17.

  it("20:59 WAT → false", () => {
    const now = new Date("2026-04-17T20:59:00+01:00");
    expect(isWithinFridayWindow(now, weekStart)).toBe(false);
  });

  it("21:00 WAT → true (inclusive start)", () => {
    const now = new Date("2026-04-17T21:00:00+01:00");
    expect(isWithinFridayWindow(now, weekStart)).toBe(true);
  });

  it("21:59 WAT → true", () => {
    const now = new Date("2026-04-17T21:59:00+01:00");
    expect(isWithinFridayWindow(now, weekStart)).toBe(true);
  });

  it("22:00 WAT → false (exclusive end)", () => {
    const now = new Date("2026-04-17T22:00:00+01:00");
    expect(isWithinFridayWindow(now, weekStart)).toBe(false);
  });
});
