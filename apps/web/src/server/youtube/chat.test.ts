import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchChatMessages } from "./chat";

/**
 * Plan 44 — chat.test.ts. Mocks globalThis.fetch to assert:
 *   1. happy: messages decoded with author info + polling interval.
 *   2. pageToken forwarded; skipped when absent.
 *   3. 404 → "liveChatId no longer active".
 *   4. default pollingIntervalMillis = 3000 when server omits it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchChatMessages", () => {
  it("parses messages and returns the server's polling interval", async () => {
    const body = {
      pollingIntervalMillis: 5000,
      nextPageToken: "tok-2",
      items: [
        {
          id: "m1",
          snippet: {
            displayMessage: "Great goal!",
            publishedAt: "2026-04-22T10:01:00.000Z",
          },
          authorDetails: {
            displayName: "Fan One",
            profileImageUrl: "https://img/fan1.png",
          },
        },
        {
          id: "m2",
          snippet: { displayMessage: "  ", publishedAt: "bad" },
          authorDetails: { displayName: "Empty", profileImageUrl: "" },
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchChatMessages("chat-1", null, { apiKey: "k" });
    expect(res.messages.length).toBe(1); // blank message filtered
    expect(res.messages[0]).toEqual({
      id: "m1",
      authorName: "Fan One",
      authorPhotoUrl: "https://img/fan1.png",
      text: "Great goal!",
      postedAt: "2026-04-22T10:01:00.000Z",
    });
    expect(res.pollingIntervalMillis).toBe(5000);
    expect(res.nextPageToken).toBe("tok-2");
  });

  it("forwards pageToken on the query string", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
    await fetchChatMessages("chat-1", "pg-42", { apiKey: "k" });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("pageToken")).toBe("pg-42");
    expect(url.searchParams.get("liveChatId")).toBe("chat-1");
    expect(url.searchParams.get("maxResults")).toBe("50");
  });

  it("maps 404 to a descriptive error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("missing", { status: 404 }),
    );
    await expect(
      fetchChatMessages("dead-chat", null, { apiKey: "k" }),
    ).rejects.toThrow(/no longer active/i);
  });

  it("defaults pollingIntervalMillis to 3000 when omitted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    const res = await fetchChatMessages("chat-x", null, { apiKey: "k" });
    expect(res.pollingIntervalMillis).toBe(3000);
    expect(res.nextPageToken).toBeNull();
  });
});
