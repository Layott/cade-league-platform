/**
 * Plan 44 — YouTube live-chat message polling.
 *
 * `fetchChatMessages(liveChatId, pageToken?)` calls
 * `liveChatMessages.list?part=snippet,authorDetails` and returns a slim
 * shape suitable for direct use by the admin YouTubeChatPanel + the
 * Feature-on-stream overlay payload.
 *
 * The response carries a `pollingIntervalMillis` the API wants callers to
 * honour — UI callers should use this instead of hard-coding 3000. We
 * default to 3000 ms when the server omits it.
 *
 * Quota: `liveChatMessages.list` costs 5 units. 1 request per 3 s ≈ 100
 * units/minute = 6000/hour = 72000/24h. The API key's 10k/day cap means
 * a single session can burn the quota in ~100 minutes. Prod usage is
 * expected to be only during active broadcasts so this is tolerable.
 */

export type ChatMessage = {
  id: string;
  authorName: string;
  authorPhotoUrl: string | null;
  text: string;
  postedAt: string;
};

export type ChatMessagesResult = {
  messages: ChatMessage[];
  nextPageToken: string | null;
  pollingIntervalMillis: number;
};

type LiveChatMessagesResponse = {
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  items?: Array<{
    id?: string;
    snippet?: {
      displayMessage?: string;
      publishedAt?: string;
    };
    authorDetails?: {
      displayName?: string;
      profileImageUrl?: string;
    };
  }>;
};

const DEFAULT_POLL_MS = 3000;

export async function fetchChatMessages(
  liveChatId: string,
  pageToken?: string | null,
  opts: { apiKey?: string } = {},
): Promise<ChatMessagesResult> {
  if (!liveChatId.trim()) throw new Error("liveChatId required");
  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured");

  const url = new URL(
    "https://www.googleapis.com/youtube/v3/liveChat/messages",
  );
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("YouTube API quota exceeded or invalid key");
    }
    if (res.status === 404) {
      throw new Error("liveChatId no longer active");
    }
    throw new Error(`YouTube liveChatMessages.list failed: ${res.status}`);
  }

  const body = (await res.json()) as LiveChatMessagesResponse;
  const messages: ChatMessage[] = [];
  for (const it of body.items ?? []) {
    if (!it.id) continue;
    const text = it.snippet?.displayMessage?.trim();
    if (!text) continue;
    const postedAt =
      it.snippet?.publishedAt && Number.isFinite(Date.parse(it.snippet.publishedAt))
        ? it.snippet.publishedAt
        : new Date().toISOString();
    messages.push({
      id: it.id,
      authorName: it.authorDetails?.displayName ?? "(anonymous)",
      authorPhotoUrl: it.authorDetails?.profileImageUrl ?? null,
      text,
      postedAt,
    });
  }

  const pollingIntervalMillis =
    typeof body.pollingIntervalMillis === "number" &&
    body.pollingIntervalMillis > 0
      ? body.pollingIntervalMillis
      : DEFAULT_POLL_MS;

  return {
    messages,
    nextPageToken: body.nextPageToken ?? null,
    pollingIntervalMillis,
  };
}
