import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateSubmittedSquadAgainstFCDB } from "./validate";
import type { FCPlayerCandidate } from "./types";

vi.mock("./lookup", () => ({
  findPlayer: vi.fn(),
}));

import { findPlayer } from "./lookup";
const mockedFindPlayer = vi.mocked(findPlayer);

function mkCand(over: Partial<FCPlayerCandidate> = {}): FCPlayerCandidate {
  return {
    id: "id-" + Math.random().toString(36).slice(2, 8),
    source_dataset: "futbin.com",
    source_row_id: "1",
    name: "Lionel Messi",
    short_name: "L. Messi",
    slug: "lionel_messi",
    rating: 90,
    position: "RW",
    alt_positions: ["CAM"],
    club: "Inter Miami",
    league: "MLS",
    nation: "Argentina",
    nation_iso: "AR",
    age: 38,
    height_cm: 169,
    weight_kg: 67,
    preferred_foot: "Left",
    weak_foot: 4,
    skill_moves: 4,
    body_type: "Lean",
    work_rate_atk: "Medium",
    work_rate_def: "Low",
    attributes: {},
    item_type: "normal",
    value_coins_estimate: null,
    imported_at: "2026-04-22T00:00:00Z",
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
    deleted_at: null,
    score: 0,
    ...over,
  };
}

describe("validateSubmittedSquadAgainstFCDB", () => {
  beforeEach(() => {
    mockedFindPlayer.mockReset();
  });

  it("tags single exact-slug hit with matching rating as resolved", async () => {
    mockedFindPlayer.mockResolvedValueOnce([mkCand({ rating: 90 })]);
    const out = await validateSubmittedSquadAgainstFCDB(
      [{ slotIndex: 0, name: "Lionel Messi", rating: 90 }],
      {} as never,
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("resolved");
    expect(out[0].candidate?.slug).toBe("lionel_messi");
    expect(out[0].alternatives).toEqual([]);
  });

  it("tags multi-hit exact-slug as fuzzy (ref picks)", async () => {
    mockedFindPlayer.mockResolvedValueOnce([
      mkCand({ id: "a", rating: 90 }),
      mkCand({ id: "b", rating: 91 }),
    ]);
    const out = await validateSubmittedSquadAgainstFCDB(
      [{ slotIndex: 0, name: "Lionel Messi" }],
      {} as never,
    );
    expect(out[0].status).toBe("fuzzy");
    expect(out[0].alternatives).toHaveLength(1);
  });

  it("tags trigram-only hits as fuzzy (sim defined)", async () => {
    mockedFindPlayer.mockResolvedValueOnce([
      mkCand({ name: "Lionnel Messi", slug: "lionnel_messi", sim: 0.85 }),
    ]);
    const out = await validateSubmittedSquadAgainstFCDB(
      [{ slotIndex: 0, name: "Lionel Messi" }],
      {} as never,
    );
    expect(out[0].status).toBe("fuzzy");
  });

  it("tags 0 candidates as unknown with no candidate field", async () => {
    mockedFindPlayer.mockResolvedValueOnce([]);
    const out = await validateSubmittedSquadAgainstFCDB(
      [{ slotIndex: 5, name: "Nobody Real" }],
      {} as never,
    );
    expect(out[0].status).toBe("unknown");
    expect(out[0].candidate).toBeUndefined();
    expect(out[0].alternatives).toEqual([]);
  });

  it("flags rating mismatch as fuzzy even with single exact-slug hit", async () => {
    mockedFindPlayer.mockResolvedValueOnce([mkCand({ rating: 89 })]);
    const out = await validateSubmittedSquadAgainstFCDB(
      [{ slotIndex: 0, name: "Lionel Messi", rating: 90 }],
      {} as never,
    );
    // Note: findPlayer's ±1 filter would let 89 through; classify still
    // demotes from 'resolved' because the ratings differ.
    expect(out[0].status).toBe("fuzzy");
  });

  it("treats names shorter than threshold as fuzzy even on single hit", async () => {
    mockedFindPlayer.mockResolvedValueOnce([
      mkCand({ name: "Bo", slug: "bo", rating: 80 }),
    ]);
    const out = await validateSubmittedSquadAgainstFCDB(
      [{ slotIndex: 0, name: "Bo" }],
      {} as never,
    );
    expect(out[0].status).toBe("fuzzy");
  });

  it("processes a mixed squad and preserves slot ordering", async () => {
    mockedFindPlayer
      .mockResolvedValueOnce([mkCand({ rating: 88 })])
      .mockResolvedValueOnce([
        mkCand({ id: "x", rating: 84, sim: 0.6, name: "Hally" }),
      ])
      .mockResolvedValueOnce([]);
    const out = await validateSubmittedSquadAgainstFCDB(
      [
        { slotIndex: 0, name: "Some Goalkeeper" },
        { slotIndex: 1, name: "Halland", rating: 84 },
        { slotIndex: 2, name: "Madeup Person" },
      ],
      {} as never,
    );
    expect(out.map((r) => r.status)).toEqual(["resolved", "fuzzy", "unknown"]);
    expect(out.map((r) => r.slotIndex)).toEqual([0, 1, 2]);
  });

  it("forwards rating + position + club to findPlayer", async () => {
    mockedFindPlayer.mockResolvedValueOnce([]);
    await validateSubmittedSquadAgainstFCDB(
      [
        {
          slotIndex: 0,
          name: "Some Player",
          rating: 90,
          position: "ST",
          club: "PSG",
        },
      ],
      {} as never,
    );
    expect(mockedFindPlayer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "Some Player",
        rating: 90,
        position: "ST",
        club: "PSG",
      }),
    );
  });
});
