import { describe, it, expect, vi } from "vitest";
import { findPlayer } from "./lookup";
import type { FCPlayer } from "./types";

/**
 * Plan 21 — lookup.test
 *
 * Mocks the SupabaseClient surface used by `findPlayer`:
 *   - `from('fc26_players').select(...).eq('slug', ...).is('deleted_at', null)`
 *     → returns `{ data, error }`
 *   - `rpc('fc26_players_fuzzy', { ... })` → returns `{ data, error }`
 */

function mkPlayer(over: Partial<FCPlayer> = {}): FCPlayer {
  return {
    id: "id-" + Math.random().toString(36).slice(2, 8),
    source_dataset: "kaggle",
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
    attributes: { pace: 80, shooting: 89, passing: 91 },
    item_type: "normal",
    value_coins_estimate: null,
    imported_at: "2026-04-22T00:00:00Z",
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

type ExactResult = { data: FCPlayer[] | null; error: { message: string } | null };
type RpcResult = {
  data: Array<FCPlayer & { sim: number }> | null;
  error: { message: string; code?: string } | null;
};

function mkSb(opts: { exact?: ExactResult; rpc?: RpcResult }) {
  const exactSpy = vi.fn();
  const rpcSpy = vi.fn();
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: vi.fn().mockImplementation(async () => {
            exactSpy();
            return opts.exact ?? { data: [], error: null };
          }),
        }),
      }),
    }),
    rpc: vi.fn().mockImplementation(async () => {
      rpcSpy();
      return opts.rpc ?? { data: [], error: null };
    }),
  };
  return { sb, exactSpy, rpcSpy };
}

describe("findPlayer", () => {
  it("returns the single exact-slug candidate", async () => {
    const messi = mkPlayer();
    const { sb, rpcSpy } = mkSb({ exact: { data: [messi], error: null } });
    const out = await findPlayer(sb as never, { name: "Lionel Messi" });
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe("lionel_messi");
    // Should NOT have hit the fuzzy fallback.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("filters exact-slug candidates by rating ±1", async () => {
    const rows = [
      mkPlayer({ id: "a", rating: 89 }),
      mkPlayer({ id: "b", rating: 90 }),
      mkPlayer({ id: "c", rating: 91 }),
      mkPlayer({ id: "d", rating: 95 }),
    ];
    const { sb } = mkSb({ exact: { data: rows, error: null } });
    const out = await findPlayer(sb as never, {
      name: "Lionel Messi",
      rating: 90,
    });
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns up to 5 exact-slug hits sorted by rating desc on score tie", async () => {
    const ratings = [80, 85, 87, 89, 91, 93, 95];
    const rows = ratings.map((r, i) =>
      mkPlayer({ id: `r-${i}`, rating: r, slug: "lionel_messi" }),
    );
    const { sb } = mkSb({ exact: { data: rows, error: null } });
    const out = await findPlayer(sb as never, { name: "Lionel Messi" });
    // No rating filter → all in. Sorted desc, capped at TOP_N=5.
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.rating)).toEqual([95, 93, 91, 89, 87]);
  });

  it("falls back to fuzzy RPC when exact returns 0 rows", async () => {
    const fuzzy = mkPlayer({ name: "Lionnel Messi", slug: "lionnel_messi" });
    const { sb, rpcSpy } = mkSb({
      exact: { data: [], error: null },
      rpc: { data: [{ ...fuzzy, sim: 0.85 }], error: null },
    });
    const out = await findPlayer(sb as never, { name: "Lionel Messi" });
    expect(rpcSpy).toHaveBeenCalledOnce();
    expect(out).toHaveLength(1);
    expect(out[0].sim).toBe(0.85);
  });

  it("returns empty when fuzzy RPC also yields 0 rows", async () => {
    const { sb } = mkSb({
      exact: { data: [], error: null },
      rpc: { data: [], error: null },
    });
    const out = await findPlayer(sb as never, { name: "Nobody Real" });
    expect(out).toEqual([]);
  });

  it("position match boosts score above non-position match", async () => {
    const stMatch = mkPlayer({ id: "st", position: "ST", rating: 88 });
    const cmNoMatch = mkPlayer({ id: "cm", position: "CM", rating: 90 });
    const { sb } = mkSb({ exact: { data: [cmNoMatch, stMatch], error: null } });
    const out = await findPlayer(sb as never, {
      name: "Lionel Messi",
      position: "ST",
    });
    expect(out[0].id).toBe("st");
  });

  it("club match boosts score", async () => {
    const miami = mkPlayer({ id: "miami", club: "Inter Miami", rating: 88 });
    const psg = mkPlayer({ id: "psg", club: "PSG", rating: 90 });
    const { sb } = mkSb({ exact: { data: [psg, miami], error: null } });
    const out = await findPlayer(sb as never, {
      name: "Lionel Messi",
      club: "Inter Miami",
    });
    expect(out[0].id).toBe("miami");
  });

  it("alt_positions match also satisfies position boost", async () => {
    const altCam = mkPlayer({ id: "alt", position: "RW", alt_positions: ["CAM"] });
    const noAlt = mkPlayer({ id: "noalt", position: "ST", alt_positions: null, rating: 91 });
    const { sb } = mkSb({ exact: { data: [noAlt, altCam], error: null } });
    const out = await findPlayer(sb as never, {
      name: "Lionel Messi",
      position: "CAM",
    });
    expect(out[0].id).toBe("alt");
  });

  it("returns empty when name yields empty slug", async () => {
    const { sb, rpcSpy } = mkSb({});
    const out = await findPlayer(sb as never, { name: "    " });
    expect(out).toEqual([]);
    // Don't waste a query on an empty slug.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("treats RPC missing-function error as empty (graceful degrade)", async () => {
    const { sb } = mkSb({
      exact: { data: [], error: null },
      rpc: {
        data: null,
        error: { message: "function does not exist", code: "42883" },
      },
    });
    const out = await findPlayer(sb as never, { name: "Lionel Messi" });
    expect(out).toEqual([]);
  });

  it("propagates non-missing-function RPC errors", async () => {
    const { sb } = mkSb({
      exact: { data: [], error: null },
      rpc: { data: null, error: { message: "permission denied", code: "42501" } },
    });
    await expect(
      findPlayer(sb as never, { name: "Lionel Messi" }),
    ).rejects.toThrow(/permission denied/);
  });

  it("propagates exact-select errors", async () => {
    const { sb } = mkSb({
      exact: { data: null, error: { message: "boom" } },
    });
    await expect(
      findPlayer(sb as never, { name: "Lionel Messi" }),
    ).rejects.toThrow(/boom/);
  });
});
