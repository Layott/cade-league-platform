/**
 * Plan 44 — YouTube Data API v3 channel-id resolution.
 *
 * Exposes `resolveChannelId(handle)` which performs a single `channels.list?
 * forHandle=` call and caches the result in a process-local Map for the
 * lifetime of the server process. One call per boot for the CADE handle.
 *
 * Quota: `channels.list?part=id` costs 1 unit. Negligible.
 *
 * Errors:
 *   - missing YOUTUBE_API_KEY → throws (caller surfaces to admin).
 *   - 403 (quota exceeded)    → throws with message the caller displays.
 *   - unknown handle          → throws "channel not found".
 */

const CACHE: Map<string, string> = new Map();

/** Test-only: reset the cache between test cases. Not exported from
 *  `index.ts`; tests import directly from this module. */
export function __resetChannelCacheForTests(): void {
  CACHE.clear();
}

type ChannelsListResponse = {
  items?: Array<{ id?: string }>;
};

/**
 * Normalises a leading `@` off a handle (callers pass `@CadeEsports` or
 * `CadeEsports` interchangeably).
 */
function normalizeHandle(handle: string): string {
  return handle.startsWith("@") ? handle.slice(1) : handle;
}

export async function resolveChannelId(
  handle: string,
  opts: { apiKey?: string } = {},
): Promise<string> {
  const h = normalizeHandle(handle.trim());
  if (!h) throw new Error("handle is required");

  const cached = CACHE.get(h);
  if (cached) return cached;

  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id");
  url.searchParams.set("forHandle", h);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("YouTube API quota exceeded or invalid key");
    }
    throw new Error(`YouTube channels.list failed: ${res.status}`);
  }
  const body = (await res.json()) as ChannelsListResponse;
  const first = body.items?.[0]?.id;
  if (!first) {
    throw new Error(`YouTube channel not found for handle: ${h}`);
  }
  CACHE.set(h, first);
  return first;
}
