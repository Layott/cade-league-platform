import { describe, it, expect } from "vitest";
import {
  computeLateSanction,
  computeAbsentSanction,
  computeSocialMediaSanction,
  computeDressCodeSanction,
  SEASON_REMAINING,
  type LadderOutcome,
} from "./ladder";

/**
 * Rule 5.4 ladder — AUTHORITATIVE test table.
 *
 * Sources:
 *   - CADE Elite League Rulebook v1.7, §5.4 (late arrival)
 *   - Rulebook §3.4.4.1 + §3.4.4.2 (absence / forfeit escalation)
 *   - Rulebook §5.5 (social media, for coexistence test)
 *   - KNOWLEDGE/extracted/PLAN11-LADDER-GAPS.md (screenshot provenance)
 *
 * These tests lock the rulebook values — if a refactor drops a ladder row or
 * silently changes a magnitude, these fail before anything reaches the DB.
 */

describe("computeLateSanction — Rule 5.4 mixed-GD + point ladder", () => {
  it("offence #1 (priorCount=0): formal written warning only, no sanction beyond log", () => {
    const o: LadderOutcome = computeLateSanction(0);
    expect(o.gdDeduction).toBe(0);
    expect(o.pointDeduction).toBe(0);
    expect(o.createCase).toBe("none");
    expect(o.suspensionMatchDays).toBe(0);
    expect(o.autoForfeit).toBe(false);
    expect(o.rulebookClause).toMatch(/1st/i);
  });

  it("offence #2 (priorCount=1): -3 GD applied to next scheduled match", () => {
    const o = computeLateSanction(1);
    expect(o.gdDeduction).toBe(3);
    expect(o.pointDeduction).toBe(0);
    expect(o.createCase).toBe("warning");
    expect(o.suspensionMatchDays).toBe(0);
    expect(o.autoForfeit).toBe(false);
    expect(o.rulebookClause).toMatch(/-3 Goal Difference/i);
  });

  it("offence #3 (priorCount=2): -3 GD (accumulates to -6)", () => {
    const o = computeLateSanction(2);
    expect(o.gdDeduction).toBe(3);
    expect(o.pointDeduction).toBe(0);
    expect(o.createCase).toBe("warning");
    expect(o.rulebookClause).toMatch(/accumulated/i);
  });

  it("offence #4 (priorCount=3): -1 league point", () => {
    const o = computeLateSanction(3);
    expect(o.gdDeduction).toBe(0);
    expect(o.pointDeduction).toBe(1);
    expect(o.createCase).toBe("disciplinary");
    expect(o.suspensionMatchDays).toBe(0);
    expect(o.rulebookClause).toMatch(/-1 League Point/i);
  });

  it("offence #5 (priorCount=4): -3 league points", () => {
    const o = computeLateSanction(4);
    expect(o.gdDeduction).toBe(0);
    expect(o.pointDeduction).toBe(3);
    expect(o.createCase).toBe("disciplinary");
    expect(o.rulebookClause).toMatch(/-3 League Points/i);
  });

  it("offence #6 (priorCount=5): season ban + IDC, triggers void propagation", () => {
    const o = computeLateSanction(5);
    expect(o.gdDeduction).toBe(0);
    expect(o.pointDeduction).toBe(0);
    expect(o.suspensionMatchDays).toBe(SEASON_REMAINING);
    expect(o.createCase).toBe("disciplinary");
    expect(o.rulebookClause).toMatch(/Season ban/i);
  });

  it("priorCount >= 10 does not crash — returns top tier (season ban)", () => {
    const o = computeLateSanction(10);
    expect(o.suspensionMatchDays).toBe(SEASON_REMAINING);
  });

  it("every ladder outcome carries a non-empty rulebook clause quote", () => {
    for (let n = 0; n < 8; n++) {
      const o = computeLateSanction(n);
      expect(o.rulebookClause.length).toBeGreaterThan(10);
    }
  });
});

describe("computeAbsentSanction — Rule 3.4.4.1/2 unexcused-forfeit ladder", () => {
  it("offence #1 (priorCount=0): auto 3-0 forfeit + formal written warning", () => {
    const o = computeAbsentSanction(0);
    expect(o.autoForfeit).toBe(true);
    expect(o.createCase).toBe("warning");
    expect(o.suspensionMatchDays).toBe(0);
    expect(o.rulebookClause).toMatch(/formal written warning/i);
  });

  it("offence #2 (priorCount=1): auto 3-0 forfeit + season suspension + IDC", () => {
    const o = computeAbsentSanction(1);
    expect(o.autoForfeit).toBe(true);
    expect(o.suspensionMatchDays).toBe(SEASON_REMAINING);
    expect(o.createCase).toBe("disciplinary");
    expect(o.rulebookClause).toMatch(/suspension/i);
  });

  it("priorCount >= 5 does not crash — returns top tier", () => {
    const o = computeAbsentSanction(5);
    expect(o.suspensionMatchDays).toBe(SEASON_REMAINING);
  });
});

describe("computeSocialMediaSanction — Rule 5.5 ladder (for coexistence)", () => {
  it("1st week: formal warning, no deduction", () => {
    const o = computeSocialMediaSanction(0);
    expect(o.pointDeduction).toBe(0);
    expect(o.createCase).toBe("warning");
  });

  it("2nd consecutive week: -1 point", () => {
    const o = computeSocialMediaSanction(1);
    expect(o.pointDeduction).toBe(1);
    expect(o.createCase).toBe("disciplinary");
  });

  it("3rd consecutive week: -3 points + IDC", () => {
    const o = computeSocialMediaSanction(2);
    expect(o.pointDeduction).toBe(3);
    expect(o.createCase).toBe("disciplinary");
  });
});

describe("computeDressCodeSanction — §5 Dress Code ladder", () => {
  it("1st: formal warning", () => {
    const o = computeDressCodeSanction(0);
    expect(o.createCase).toBe("warning");
    expect(o.autoForfeit).toBe(false);
  });

  it("2nd: refused entry, potential match forfeit", () => {
    const o = computeDressCodeSanction(1);
    expect(o.createCase).toBe("disciplinary");
  });

  it("3rd: IDC review, possible deduction", () => {
    const o = computeDressCodeSanction(2);
    expect(o.createCase).toBe("disciplinary");
  });
});
