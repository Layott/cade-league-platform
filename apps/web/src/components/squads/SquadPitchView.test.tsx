import { describe, it, expect } from "vitest";
import { inferFormationFromItems } from "./SquadPitchView";
import type { SquadPitchViewItem } from "./SquadPitchView";

/**
 * Unit tests for the formation-inference logic. The render path is
 * exercised implicitly by the existing PitchLayout + FutCard tests
 * (SquadPitchView is a pure composition over those two). These tests pin
 * the inference behaviour so a future schema tweak to positions or
 * formations can't silently regress the pitch.
 */

function makeItems(positions: string[]): SquadPitchViewItem[] {
  return positions.map((position, i) => ({
    id: `it-${i}`,
    slot_index: i,
    name: `P${i}`,
    rating: 80,
    position,
    item_type: "normal",
    nationality_flag: null,
  }));
}

describe("inferFormationFromItems", () => {
  it("returns 433 for empty item list (safe fallback)", () => {
    expect(inferFormationFromItems([])).toBe("433");
  });

  it("returns 433 when positions exactly match 4-3-3", () => {
    const items = makeItems([
      "GK",
      "LB",
      "CB",
      "CB",
      "RB",
      "CM",
      "CM",
      "CM",
      "LW",
      "ST",
      "RW",
    ]);
    expect(inferFormationFromItems(items)).toBe("433");
  });

  it("returns 442 for 4-4-2 tuple", () => {
    const items = makeItems([
      "GK",
      "LB",
      "CB",
      "CB",
      "RB",
      "LM",
      "CM",
      "CM",
      "RM",
      "ST",
      "ST",
    ]);
    expect(inferFormationFromItems(items)).toBe("442");
  });

  it("returns 352 for 3-5-2 tuple", () => {
    const items = makeItems([
      "GK",
      "CB",
      "CB",
      "CB",
      "LM",
      "CM",
      "CM",
      "CM",
      "RM",
      "ST",
      "ST",
    ]);
    expect(inferFormationFromItems(items)).toBe("352");
  });

  it("returns 4231 for 4-2-3-1 tuple", () => {
    const items = makeItems([
      "GK",
      "LB",
      "CB",
      "CB",
      "RB",
      "CDM",
      "CDM",
      "LM",
      "CAM",
      "RM",
      "ST",
    ]);
    expect(inferFormationFromItems(items)).toBe("4231");
  });

  it("falls back to a def/mid/att signature when positions don't match any formation exactly", () => {
    // 4 defenders / 3 mids / 3 attackers but with oddball labels (CAM
    // instead of CM) -> signature match still picks 4-3-3.
    const items = makeItems([
      "GK",
      "LB",
      "CB",
      "CB",
      "RB",
      "CAM",
      "CAM",
      "CAM",
      "LW",
      "ST",
      "RW",
    ]);
    expect(inferFormationFromItems(items)).toBe("433");
  });

  it("still returns a formation when the tuple is partial (legacy 7-starter row)", () => {
    const items = makeItems(["GK", "CB", "CB", "CB", "LW", "ST", "RW"]);
    // 3 defenders / 0 mids / 3 attackers — signature doesn't match any
    // canonical formation exactly, falls through to the default.
    expect(inferFormationFromItems(items)).toBe("433");
  });
});
