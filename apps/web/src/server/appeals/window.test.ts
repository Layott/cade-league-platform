import { describe, it, expect } from "vitest";
import { isAppealWindowOpen } from "./window";

/**
 * All dates use WAT (+01:00) offset explicitly so the test intent is legible
 * regardless of the host TZ.
 *
 * 2026-05-04 (Mon), 05 (Tue), 06 (Wed), 07 (Thu), 08 (Fri),
 * 2026-05-09 (Sat), 10 (Sun), 11 (Mon).
 */

describe("isAppealWindowOpen", () => {
  it("day 0 (same calendar day) → window closed", () => {
    const issued = new Date("2026-05-04T10:00:00+01:00");
    const now = new Date("2026-05-04T18:00:00+01:00");
    expect(isAppealWindowOpen(issued, now, "warning")).toBe(false);
  });

  it("day 1 (next business day) → window open", () => {
    const issued = new Date("2026-05-04T10:00:00+01:00"); // Mon
    const now = new Date("2026-05-05T10:00:00+01:00"); // Tue
    expect(isAppealWindowOpen(issued, now, "warning")).toBe(true);
  });

  it("day 5 (5 business days later) → window still open", () => {
    // Mon 5/4 → Mon 5/11 = 5 business days (Tue Wed Thu Fri Mon).
    const issued = new Date("2026-05-04T10:00:00+01:00");
    const now = new Date("2026-05-11T10:00:00+01:00");
    expect(isAppealWindowOpen(issued, now, "point_deduction")).toBe(true);
  });

  it("day 6 (6 business days later) → window closed", () => {
    // Mon 5/4 → Tue 5/12 = 6 business days.
    const issued = new Date("2026-05-04T10:00:00+01:00");
    const now = new Date("2026-05-12T10:00:00+01:00");
    expect(isAppealWindowOpen(issued, now, "warning")).toBe(false);
  });

  it("Fri issued, checked Monday → weekend skipped, counts as day 1", () => {
    const issued = new Date("2026-05-08T10:00:00+01:00"); // Fri
    const now = new Date("2026-05-11T10:00:00+01:00"); // Mon
    expect(isAppealWindowOpen(issued, now, "warning")).toBe(true);
  });

  it("auto_forfeit is always non-appealable even inside window", () => {
    const issued = new Date("2026-05-04T10:00:00+01:00");
    const now = new Date("2026-05-05T10:00:00+01:00"); // day 1, would be open
    expect(isAppealWindowOpen(issued, now, "auto_forfeit")).toBe(false);
  });

  it("issuedAt in the future → window closed", () => {
    const issued = new Date("2026-05-10T10:00:00+01:00");
    const now = new Date("2026-05-04T10:00:00+01:00");
    expect(isAppealWindowOpen(issued, now, "warning")).toBe(false);
  });

  it("weekend issue checked next Monday → weekend skipped, counts as day 1 open", () => {
    // Sat 5/9 → Mon 5/11: the only business day crossed is Mon itself, so
    // businessDaysBetween = 1 under the same rule the rest of the library
    // uses. Window open.
    const issued = new Date("2026-05-09T10:00:00+01:00"); // Sat
    const now = new Date("2026-05-11T10:00:00+01:00"); // Mon
    expect(isAppealWindowOpen(issued, now, "warning")).toBe(true);
  });

  it("sanction types other than auto_forfeit inside window are appealable", () => {
    const issued = new Date("2026-05-04T10:00:00+01:00");
    const now = new Date("2026-05-06T10:00:00+01:00"); // day 2
    for (const t of ["warning", "point_deduction", "gd_deduction", "forfeit", "ban"]) {
      expect(isAppealWindowOpen(issued, now, t)).toBe(true);
    }
  });
});
