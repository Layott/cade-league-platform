import { describe, it, expect, vi, afterEach } from "vitest";
import { listLiveVideos } from "./live";

/**
 * Plan 44 — live.test.ts. Mocks globalThis.fetch to assert:
 *   1. empty search: returns [] + does NOT call videos.list.
 *   2. happy: search + videos chained, filters items without
 *      activeLiveChatId.
 *   3. 403 anywhere: throws quota-exceeded error.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listLiveVideos", () => {
  it("returns [] when no live videos exist and skips videos.list call", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
    const out = await listLiveVideos("UC-abc", { apiKey: "k" });
    expect(out).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/search");
  });

  it("fetches search + videos and returns normalised rows", async () => {
    const searchBody = {
      items: [
        {
          id: { videoId: "v1" },
          snippet: {
            title: "LIVE Match Day",
            thumbnails: { medium: { url: "https://img/v1.jpg" } },
          },
        },
        {
          id: { videoId: "v2" },
          snippet: {
            title: "Second stream",
            thumbnails: { default: { url: "https://img/v2.jpg" } },
          },
        },
      ],
    };
    const videosBody = {
      items: [
        {
          id: "v1",
          liveStreamingDetails: {
            activeLiveChatId: "chat-1",
            actualStartTime: "2026-04-22T10:00:00Z",
          },
        },
        // v2 omitted → filtered out
      ],
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(searchBody), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(videosBody), { status: 200 }),
      );

    const out = await listLiveVideos("UC-abc", { apiKey: "k" });
    expect(out).toEqual([
      {
        videoId: "v1",
        title: "LIVE Match Day",
        thumbnailUrl: "https://img/v1.jpg",
        liveChatId: "chat-1",
        startedAt: "2026-04-22T10:00:00Z",
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Confirm videos.list was called with the csv of ids.
    const vUrl = new URL(String(fetchSpy.mock.calls[1][0]));
    expect(vUrl.searchParams.get("id")).toBe("v1,v2");
  });

  it("surfaces a 403 as a quota error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );
    await expect(
      listLiveVideos("UC-abc", { apiKey: "k" }),
    ).rejects.toThrow(/quota exceeded|invalid key/i);
  });

  it("throws when channelId is empty", async () => {
    await expect(listLiveVideos("", { apiKey: "k" })).rejects.toThrow(
      /channelId/,
    );
  });
});
