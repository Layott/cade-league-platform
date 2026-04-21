import { describe, it, expect } from "vitest";
import { currentWeekStart, isMonday } from "./week";

describe("currentWeekStart", () => {
  it("returns the Monday when called on a Monday (WAT)", () => {
    const monday = new Date("2026-05-04T10:00:00+01:00");
    expect(currentWeekStart(monday)).toBe("2026-05-04");
  });

  it("returns the previous Monday when called on a Wednesday (WAT)", () => {
    const wed = new Date("2026-05-06T15:00:00+01:00");
    expect(currentWeekStart(wed)).toBe("2026-05-04");
  });

  it("returns the previous Monday when called on a Sunday (WAT)", () => {
    const sun = new Date("2026-05-10T23:30:00+01:00");
    expect(currentWeekStart(sun)).toBe("2026-05-04");
  });

  it("handles early-morning UTC that is still previous day WAT", () => {
    // 2026-05-05 00:30 UTC is 2026-05-05 01:30 WAT → Tuesday → Mon = 2026-05-04
    const earlyUtc = new Date("2026-05-05T00:30:00Z");
    expect(currentWeekStart(earlyUtc)).toBe("2026-05-04");
  });
});

describe("isMonday", () => {
  it("2026-05-04 is Monday", () => {
    expect(isMonday("2026-05-04")).toBe(true);
  });

  it("2026-05-05 is not Monday", () => {
    expect(isMonday("2026-05-05")).toBe(false);
  });
});
