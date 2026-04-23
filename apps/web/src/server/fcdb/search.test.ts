import { describe, it, expect, vi } from "vitest";
import { searchCards } from "./search";
import type { FCPlayer } from "./types";

function mkPlayer(over: Partial<FCPlayer> = {}): FCPlayer {
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
    attributes: { pace: 80 },
    item_type: "normal",
    value_coins_estimate: 125_000,
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
  const rpcSpy = vi.fn();
  const sb = {
    from: () => ({
      select: () => ({
        // .eq('slug').eq('source_dataset').is('deleted_at').limit()
        eq: () => ({
          eq: () => ({
            is: () => ({
              limit: vi.fn().mockResolvedValue(opts.exact ?? { data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
    rpc: vi.fn().mockImplementation(async () => {
      rpcSpy();
      return opts.rpc ?? { data: [], error: null };
    }),
  };
  return { sb, rpcSpy };
}

describe("searchCards", () => {
  it("returns exact-slug hits projected to the picker shape", async () => {
    const row = mkPlayer();
    const { sb, rpcSpy } = mkSb({ exact: { data: [row], error: null } });
    const out = await searchCards(sb as never, { q: "Lionel Messi", limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(row.id);
    expect(out[0].priceCoins).toBe(125_000);
    expect(out[0].positionsAlt).toEqual(["CAM"]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("ranks exact hits with position filter as a soft boost", async () => {
    const rb = mkPlayer({ id: "rb", position: "RB", rating: 82, slug: "generic_back" });
    const cb = mkPlayer({ id: "cb", position: "CB", rating: 90, slug: "generic_back" });
    const { sb } = mkSb({ exact: { data: [cb, rb], error: null } });
    const out = await searchCards(sb as never, {
      q: "Generic Back",
      position: "RB",
      limit: 10,
    });
    expect(out[0].id).toBe("rb"); // position match wins over higher rating
  });

  it("falls back to fuzzy RPC when slug misses", async () => {
    const fuzzy = mkPlayer({ slug: "ronaldinho", name: "Ronaldinho" });
    const { sb, rpcSpy } = mkSb({
      exact: { data: [], error: null },
      rpc: { data: [{ ...fuzzy, sim: 0.7 }], error: null },
    });
    const out = await searchCards(sb as never, { q: "Ronaldinio", limit: 10 });
    expect(rpcSpy).toHaveBeenCalledOnce();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Ronaldinho");
  });

  it("returns [] when both paths are empty (empty catalogue graceful)", async () => {
    const { sb } = mkSb({
      exact: { data: [], error: null },
      rpc: { data: [], error: null },
    });
    const out = await searchCards(sb as never, { q: "Nobody", limit: 10 });
    expect(out).toEqual([]);
  });

  it("returns [] when fuzzy RPC is missing (pre-migration state)", async () => {
    const { sb } = mkSb({
      exact: { data: [], error: null },
      rpc: {
        data: null,
        error: { message: "function does not exist", code: "42883" },
      },
    });
    const out = await searchCards(sb as never, { q: "Someone", limit: 10 });
    expect(out).toEqual([]);
  });

  it("rejects queries shorter than 2 characters", async () => {
    const { sb } = mkSb({});
    await expect(
      searchCards(sb as never, { q: "a", limit: 10 }),
    ).rejects.toThrow();
  });

  it("surfaces card_image_url + futgg_variant from attributes", async () => {
    const row = mkPlayer({
      attributes: {
        card_image_url: "https://game-assets.fut.gg/cdn-cgi/image/quality=85,format=auto,width=300/2026/futgg-player-item-card/26-42.abc.webp",
        futgg_variant: "Trophy Titans Hero",
      },
      item_type: "hero",
    });
    const { sb } = mkSb({ exact: { data: [row], error: null } });
    const [hit] = await searchCards(sb as never, { q: "Lionel Messi", limit: 10 });
    expect(hit.cardImageUrl).toContain("26-42.abc.webp");
    expect(hit.variant).toBe("Trophy Titans Hero");
  });

  it("falls back variant to item_type when futgg_variant is absent", async () => {
    const row = mkPlayer({ attributes: {}, item_type: "icon" });
    const { sb } = mkSb({ exact: { data: [row], error: null } });
    const [hit] = await searchCards(sb as never, { q: "Lionel Messi", limit: 10 });
    expect(hit.cardImageUrl).toBeNull();
    expect(hit.variant).toBe("icon");
  });

  it("returns null variant for base (normal) cards without fut.gg data", async () => {
    const row = mkPlayer({ attributes: {}, item_type: "normal" });
    const { sb } = mkSb({ exact: { data: [row], error: null } });
    const [hit] = await searchCards(sb as never, { q: "Lionel Messi", limit: 10 });
    expect(hit.variant).toBeNull();
  });
});
