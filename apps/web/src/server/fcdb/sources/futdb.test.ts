import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFutdb,
  fetchFutdbPage,
  normalizeFutdbItem,
} from "./futdb";

function mkResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("normalizeFutdbItem", () => {
  it("maps a full item into NormalizedFCRow shape", () => {
    const row = normalizeFutdbItem({
      id: 12345,
      commonName: "L. Messi",
      firstName: "Lionel",
      lastName: "Messi",
      rating: 94,
      position: "cam",
      playerPositions: ["CAM", "RW", "CF"],
      club: { name: "Inter Miami" },
      league: { name: "MLS" },
      nation: { name: "Argentina" },
      rarity: { name: "Gold - Rare" },
      price: 27500,
      attributes: { pac: 80, sho: 89, pas: 91, dri: 94, def: 33, phy: 63 },
    });
    expect(row).toMatchObject({
      source_dataset: "futdb.co",
      source_row_id: "12345",
      name: "L. Messi",
      slug: "l_messi",
      rating: 94,
      position: "CAM",
      alt_positions: ["RW", "CF"],
      club: "Inter Miami",
      league: "MLS",
      nation: "Argentina",
      item_type: "normal",
      value_coins_estimate: 27500,
    });
    expect(row?.attributes).toMatchObject({
      pace: 80,
      shooting: 89,
      passing: 91,
      dribbling: 94,
      defending: 33,
      physical: 63,
    });
  });

  it("maps icon rarity to item_type 'icon'", () => {
    const row = normalizeFutdbItem({
      id: "1",
      firstName: "Pele",
      lastName: "",
      rating: 98,
      position: "CF",
      rarity: { name: "Icon Moments" },
    });
    expect(row?.item_type).toBe("icon");
  });

  it("falls back to firstName + lastName when commonName is empty", () => {
    const row = normalizeFutdbItem({
      id: 7,
      firstName: "Cristiano",
      lastName: "Ronaldo",
      rating: 88,
      position: "ST",
    });
    expect(row?.name).toBe("Cristiano Ronaldo");
    expect(row?.slug).toBe("cristiano_ronaldo");
  });

  it("rejects rows with missing name or out-of-range rating", () => {
    expect(
      normalizeFutdbItem({ id: 1, commonName: "", firstName: "", lastName: "", rating: 90 }),
    ).toBeNull();
    expect(normalizeFutdbItem({ id: 2, commonName: "X", rating: 120 })).toBeNull();
    expect(normalizeFutdbItem({ id: "", commonName: "X", rating: 80 })).toBeNull();
  });
});

describe("fetchFutdbPage", () => {
  it("sends X-AUTH-TOKEN and parses JSON body", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        mkResponse({
          items: [{ id: 1, commonName: "A", rating: 80 }],
          pagination: { currentPage: 1, totalPages: 5 },
        }),
    );
    const page = await fetchFutdbPage(1, "my-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => {},
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("https://futdb.co/api/players?page=1");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-AUTH-TOKEN"]).toBe("my-key");
    expect(page.items?.length).toBe(1);
  });

  it("retries once on 429 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      n += 1;
      if (n === 1) return new Response("too many", { status: 429 });
      return mkResponse({ items: [{ id: 1, commonName: "A", rating: 80 }] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const page = await fetchFutdbPage(1, "k", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalled();
    expect(page.items?.length).toBe(1);
  });

  it("throws with HTTP status on non-2xx, non-429", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("oops", { status: 500 }),
    );
    await expect(
      fetchFutdbPage(3, "k", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => {},
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("fetchFutdb (top-level)", () => {
  const origKey = process.env.FUTDB_API_KEY;
  beforeEach(() => {
    delete process.env.FUTDB_API_KEY;
  });
  afterEach(() => {
    if (origKey) process.env.FUTDB_API_KEY = origKey;
    else delete process.env.FUTDB_API_KEY;
  });

  it("returns skipped when FUTDB_API_KEY is not set", async () => {
    const out = await fetchFutdb({ fetchImpl: (async () => mkResponse({})) as unknown as typeof fetch });
    expect(out).toEqual({
      skipped: true,
      source: "futdb",
      reason: expect.stringContaining("FUTDB_API_KEY"),
    });
  });

  it("paginates and rate-limits between pages", async () => {
    process.env.FUTDB_API_KEY = "k";
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      calls.push(url);
      const n = Number(url.split("page=")[1]);
      return mkResponse({
        items: [{ id: n * 10, commonName: `P${n}`, rating: 80 }],
        pagination: { currentPage: n, totalPages: 10 },
      });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const out = await fetchFutdb({
      pages: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
    });
    expect(out.skipped).toBeUndefined();
    if (!out.skipped) {
      expect(out.rows).toHaveLength(3);
      // 3 pages = 2 inter-page sleeps.
      expect(sleepImpl).toHaveBeenCalledTimes(2);
      expect(calls[0]).toContain("page=1");
      expect(calls[2]).toContain("page=3");
    }
  });

  it("stops early when pagination.totalPages says we're at the end", async () => {
    process.env.FUTDB_API_KEY = "k";
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      const n = Number(url.split("page=")[1]);
      return mkResponse({
        items: [{ id: n, commonName: `P${n}`, rating: 80 }],
        pagination: { currentPage: n, totalPages: 2 },
      });
    });
    const out = await fetchFutdb({
      pages: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => {},
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // stopped at end
    if (!out.skipped) expect(out.rows).toHaveLength(2);
  });
});
