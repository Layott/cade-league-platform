import { describe, it, expect } from "vitest";
import { pickLadderRung, LADDERS } from "./ladder";

describe("pickLadderRung — Rule 5.4 / §6.3 sanction ladder", () => {
  it("late_arrival 1st offense → written warning", () => {
    const r = pickLadderRung("late_arrival", 1);
    expect(r.sanctionType).toBe("warning");
    expect(r.magnitude).toBe(0);
    expect(r.requiresWindow).toBe(false);
  });

  it("late_arrival 2nd offense → GD -3", () => {
    const r = pickLadderRung("late_arrival", 2);
    expect(r.sanctionType).toBe("gd_deduction");
    expect(r.magnitude).toBe(3);
  });

  it("late_arrival 4th offense → -1 league point", () => {
    const r = pickLadderRung("late_arrival", 4);
    expect(r.sanctionType).toBe("point_deduction");
    expect(r.magnitude).toBe(1);
  });

  it("late_arrival 5th offense → -3 league points", () => {
    const r = pickLadderRung("late_arrival", 5);
    expect(r.sanctionType).toBe("point_deduction");
    expect(r.magnitude).toBe(3);
  });

  it("late_arrival 6th offense → season ban with window required", () => {
    const r = pickLadderRung("late_arrival", 6);
    expect(r.sanctionType).toBe("ban");
    expect(r.requiresWindow).toBe(true);
  });

  it("late_arrival 99th offense → clamps to ceiling (season ban)", () => {
    const r = pickLadderRung("late_arrival", 99);
    expect(r.sanctionType).toBe("ban");
  });

  it("forfeit 2nd offense → season ban (Rule §3.4.4.2)", () => {
    const r = pickLadderRung("forfeit", 2);
    expect(r.sanctionType).toBe("ban");
    expect(r.requiresWindow).toBe(true);
  });

  it("social_media 2nd week → -1 league point", () => {
    const r = pickLadderRung("social_media", 2);
    expect(r.sanctionType).toBe("point_deduction");
    expect(r.magnitude).toBe(1);
  });

  it("every defined incident has at least one rung", () => {
    for (const [incident, ladder] of Object.entries(LADDERS)) {
      expect(ladder.rungs.length, `ladder for ${incident}`).toBeGreaterThan(0);
    }
  });

  it("offense count of 0 floors to 1st rung", () => {
    const r = pickLadderRung("late_arrival", 0);
    expect(r.sanctionType).toBe("warning");
  });
});
