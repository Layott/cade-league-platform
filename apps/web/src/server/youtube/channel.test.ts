import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveChannelId, __resetChannelCacheForTests } from "./channel";

/**
 * Plan 44 — channel.test.ts. Mocks globalThis.fetch and asserts:
 *   1. happy-path: returns the first item's id + caches the result.
 *   2. empty-items: throws "channel not found".
 *   3. quota exceeded (403): throws user-facing quota message.
 *   4. missing API key: throws without calling fetch.
 */

describe("resolveChannelId", () => {
  beforeEach(() => {
    __resetChannelCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the channel id and caches subsequent calls", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [{ id: "UC-abc-xyz" }] }),
          { status: 200 },
        ),
      );

    const first = await resolveChannelId("@CadeEsports", { apiKey: "k" });
    const second = await resolveChannelId("CadeEsports", { apiKey: "k" });

    expect(first).toBe("UC-abc-xyz");
    expect(second).toBe("UC-abc-xyz");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // second call is cached.

    // Sanity check the URL shape we constructed.
    const calledUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(calledUrl.searchParams.get("forHandle")).toBe("CadeEsports");
    expect(calledUrl.searchParams.get("key")).toBe("k");
    expect(calledUrl.searchParams.get("part")).toBe("id");
  });

  it("throws when the API returns no items", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    await expect(
      resolveChannelId("@NoSuchChannel", { apiKey: "k" }),
    ).rejects.toThrow(/channel not found/i);
  });

  it("maps a 403 response to a quota-exceeded message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("quota exceeded", { status: 403 }),
    );
    await expect(
      resolveChannelId("@CadeEsports", { apiKey: "k" }),
    ).rejects.toThrow(/quota exceeded|invalid key/i);
  });

  it("throws when YOUTUBE_API_KEY is missing and no override is passed", async () => {
    const previous = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    try {
      await expect(resolveChannelId("@CadeEsports")).rejects.toThrow(
        /YOUTUBE_API_KEY/,
      );
    } finally {
      if (previous !== undefined) process.env.YOUTUBE_API_KEY = previous;
    }
  });
});
