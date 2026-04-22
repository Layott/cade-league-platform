/**
 * Plan 44 — YouTube live-video listing.
 *
 * `listLiveVideos(channelId)` performs two API calls:
 *   1. `search.list?eventType=live&type=video&channelId=` — gets the set of
 *      currently-live videoIds + title + thumbnail.
 *   2. `videos.list?id=<csv>&part=liveStreamingDetails` — resolves each
 *      video's `activeLiveChatId` so the caller can bind it directly.
 *
 * When step 1 returns no items the function returns `[]` without touching
 * step 2 (avoids an empty-id query). Items without an `activeLiveChatId`
 * (stream not yet started / already ended) are filtered out.
 *
 * Quota:
 *   - `search.list` = 100 units
 *   - `videos.list` = 1 unit
 * So one fresh listing costs 101 units. Callers are expected to cache 30s
 * (handled at the route layer) to keep daily quota well inside 10k.
 */

export type LiveVideo = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  liveChatId: string;
  startedAt: string | null;
};

type SearchListResponse = {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
    };
  }>;
};

type VideosListResponse = {
  items?: Array<{
    id?: string;
    liveStreamingDetails?: {
      activeLiveChatId?: string;
      actualStartTime?: string;
      scheduledStartTime?: string;
    };
  }>;
};

export async function listLiveVideos(
  channelId: string,
  opts: { apiKey?: string } = {},
): Promise<LiveVideo[]> {
  if (!channelId.trim()) throw new Error("channelId required");
  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured");

  // 1. search.list — which videos are LIVE right now.
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("channelId", channelId);
  searchUrl.searchParams.set("eventType", "live");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("key", apiKey);

  const sRes = await fetch(searchUrl.toString(), { cache: "no-store" });
  if (!sRes.ok) {
    if (sRes.status === 403) {
      throw new Error("YouTube API quota exceeded or invalid key");
    }
    throw new Error(`YouTube search.list failed: ${sRes.status}`);
  }
  const sBody = (await sRes.json()) as SearchListResponse;

  const previews: Array<{
    videoId: string;
    title: string;
    thumbnailUrl: string | null;
  }> = [];
  for (const it of sBody.items ?? []) {
    const videoId = it.id?.videoId;
    if (!videoId) continue;
    const title = it.snippet?.title ?? "(untitled live)";
    const thumbnailUrl =
      it.snippet?.thumbnails?.medium?.url ??
      it.snippet?.thumbnails?.default?.url ??
      null;
    previews.push({ videoId, title, thumbnailUrl });
  }
  if (previews.length === 0) return [];

  // 2. videos.list — resolve activeLiveChatId for each.
  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "liveStreamingDetails");
  videosUrl.searchParams.set("id", previews.map((p) => p.videoId).join(","));
  videosUrl.searchParams.set("key", apiKey);

  const vRes = await fetch(videosUrl.toString(), { cache: "no-store" });
  if (!vRes.ok) {
    if (vRes.status === 403) {
      throw new Error("YouTube API quota exceeded or invalid key");
    }
    throw new Error(`YouTube videos.list failed: ${vRes.status}`);
  }
  const vBody = (await vRes.json()) as VideosListResponse;
  const detailsById = new Map<
    string,
    { liveChatId: string; startedAt: string | null }
  >();
  for (const v of vBody.items ?? []) {
    const id = v.id;
    const chatId = v.liveStreamingDetails?.activeLiveChatId;
    if (!id || !chatId) continue;
    detailsById.set(id, {
      liveChatId: chatId,
      startedAt:
        v.liveStreamingDetails?.actualStartTime ??
        v.liveStreamingDetails?.scheduledStartTime ??
        null,
    });
  }

  const out: LiveVideo[] = [];
  for (const p of previews) {
    const d = detailsById.get(p.videoId);
    if (!d) continue;
    out.push({
      videoId: p.videoId,
      title: p.title,
      thumbnailUrl: p.thumbnailUrl,
      liveChatId: d.liveChatId,
      startedAt: d.startedAt,
    });
  }
  return out;
}
