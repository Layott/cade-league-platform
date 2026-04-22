# Plan 44 — YouTube live-chat picker + "Feature on stream" overlay

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Approved
**Depends on:** Plan 12 (overlay bridge), Plan 37 (active_instances + template registry), Plan 42 (broadcast session controls)
**Channel:** https://www.youtube.com/@CadeEsports

---

## 1. Goal

Admin in the broadcast console picks a currently-live YouTube stream from the CADE Esports channel. The platform polls its live chat every 3 s, renders the messages in a scrollable feed. Admin clicks "Feature on stream" next to any message → the message + author + avatar animates in on the OBS browser-source overlay (`/overlay/featured-comment`) for ~10 s, then clears.

---

## 2. Success criteria

1. `/admin/broadcast/<sessionId>` gains a **YouTube chat** panel.
2. Panel lists every currently-live video on `@CadeEsports` (via YouTube Data API v3 `search.list?channelId=<cade>&eventType=live&type=video`). If none → "No live streams right now".
3. Clicking a video binds it to the session (`stream_sessions.youtube_video_id` + `youtube_live_chat_id`) and starts a 3 s client-side poll loop against `/api/youtube/chat?sessionId=...`.
4. Messages stream newest-first in a scrollable feed. Each row: author avatar, author name, message text, timestamp.
5. "Feature on stream" button per message → POST server action that fires an `overlay_events` row with `template_key='featured_comment'` + payload `{ authorName, authorPhotoUrl, message, postedAt }`.
6. Overlay page `/overlay/featured-comment?sessionId=...` subscribes to Plan 37 realtime + renders the message pop-in for ~10 s with a framer-motion enter → linger → exit sequence, then clears.
7. Admin can "Unbind" the current stream to stop polling.

---

## 3. Architecture

### 3.1 Schema

Migration `supabase/migrations/20260510000100_plan44_youtube_bind.sql`:

- `alter table public.stream_sessions add column if not exists youtube_video_id text null;`
- `alter table public.stream_sessions add column if not exists youtube_live_chat_id text null;`
- `alter table public.stream_sessions add column if not exists youtube_bound_at timestamptz null;`
- Extend `public.overlay_templates.template_type` CHECK with `'featured_comment'` + seed one row.

### 3.2 Server

- `apps/web/src/server/youtube/channel.ts`:
  - `resolveChannelId(handle: string)` → cached channel ID. `@CadeEsports` → UC...
  - Uses `https://www.googleapis.com/youtube/v3/channels?forHandle=CadeEsports&part=id` with `key=YOUTUBE_API_KEY`.
- `apps/web/src/server/youtube/live.ts`:
  - `listLiveVideos(channelId)` → `[{ videoId, title, thumbnailUrl, liveChatId }]`.
  - Uses `search.list?channelId=&eventType=live&type=video` + for each `videos.list?id=&part=liveStreamingDetails` to get `activeLiveChatId`.
- `apps/web/src/server/youtube/chat.ts`:
  - `fetchChatMessages(liveChatId, pageToken?)` → `{ messages: [{id, authorName, authorPhotoUrl, text, postedAt}], nextPageToken, pollingIntervalMillis }`.
  - Uses `liveChatMessages.list?liveChatId=&part=snippet,authorDetails&maxResults=50`.
- `apps/web/src/server/youtube/bind.ts`:
  - `bindLiveStream(sb, sessionId, videoId, liveChatId, actor)` writes the columns + audits.
  - `unbindLiveStream(sb, sessionId, actor)` clears them.

### 3.3 API routes

- `GET /api/youtube/live?sessionId=...` — lists currently-live videos on the CADE channel. Cached 30 s.
- `POST /api/youtube/bind` — body `{ sessionId, videoId, liveChatId }`. Perm `broadcast.match_control`.
- `POST /api/youtube/unbind` — body `{ sessionId }`.
- `GET /api/youtube/chat?sessionId=...&pageToken=...` — returns messages from the bound liveChatId. Honors `pollingIntervalMillis`.
- `POST /api/broadcast/feature-comment` — body `{ sessionId, messageId, authorName, authorPhotoUrl, message, postedAt }`. Inserts `overlay_events` row with `template_key='featured_comment'` payload and publishes realtime.

### 3.4 Admin UI

`apps/web/src/app/admin/broadcast/[sessionId]/YouTubeChatPanel.tsx` (`"use client"`):

- Header: "YouTube Chat" + current binding state (`[bound to "Match Day 1 LIVE"]` or `"Not monitoring a stream"`).
- If unbound: list of live videos fetched from `/api/youtube/live` → click to bind.
- If bound: chat feed. `useEffect` poll every `pollingIntervalMillis` (from YouTube's response; typically 3000-5000 ms). Render messages newest-first. "Unbind" button.
- Each row: avatar, name (bold), message, timestamp ("3s ago"), "Feature on stream" button on right.
- On feature: disable button for 2 s to prevent double-click, show toast "Comment featured".

Mounted inside the existing `MatchControlPanel` at the bottom (below score widget + formation controls).

### 3.5 Overlay

`apps/web/src/app/(overlay)/overlay/featured-comment/page.tsx`:

- Subscribes to Plan 37 realtime stream for `overlay_events` keyed by session + template_key='featured_comment'.
- On event received: display message card for 10 s (overrideable via `displaySeconds` payload).
- Card layout: avatar left, name top-right, message body, "YT LIVE CHAT" chip top-left. Brand-coloured accent bar.
- framer-motion: slide-in-from-bottom + linger + fade-out.
- Auto-clears after duration expires (client tick) or on manual clear event.

Schema addition in `server/overlays/schemas.ts`:
```ts
export const featuredCommentSchema = z.object({
  authorName: z.string().trim().min(1).max(80),
  authorPhotoUrl: photoUrlSchema.optional(),
  message: z.string().trim().min(1).max(500),
  postedAt: z.string().datetime(),
  displaySeconds: z.number().int().min(3).max(30).default(10),
  slot: matchSlotSchema.default("primary"),
});
```
Registry entry: `featured_comment` with `group: 'comments'`, `label: 'Featured Comment'`.

### 3.6 Env vars

- `YOUTUBE_API_KEY` — Data API v3 key (quota 10k/day; 5 units per chat poll = 1200 polls/hour safely).

### 3.7 Quota management

- Channel-id lookup cached in memory (resolve once on boot).
- `search.list` for live videos cached 30 s — cheap.
- `liveChatMessages.list` honors the API's `pollingIntervalMillis` — don't poll faster than instructed.
- If quota exceeded → API returns 403 → bind panel shows "YouTube quota exceeded; try again later".

---

## 4. Data model

No changes beyond 3.1. Featured comments are stored implicitly in `overlay_events` (which already captures every trigger for replay + audit).

---

## 5. Testing

### Unit
- `server/youtube/channel.test.ts` — mocked fetch, verifies cache + handle lookup.
- `server/youtube/live.test.ts` — empty + populated responses.
- `server/youtube/chat.test.ts` — pagination + polling interval respect.
- `server/youtube/bind.test.ts` — perm check + session update + audit.

### E2E (optional, mocked)
- `youtube-chat-feature.spec.ts` — admin binds a mock live stream → sees messages → clicks Feature → verifies `overlay_events` row appears.

---

## 6. Rollout + risks

- **Quota burn:** 3 s polling × multiple admins watching × hours = quota exhausted mid-match. Mitigation: server-side poll (single poller per `liveChatId`, fan-out to clients via realtime channel). Initial ship = client-side polling; upgrade if needed.
- **YouTube API downtime:** rare. Panel shows a retry banner.
- **Moderation:** admin is the gate — no automatic filtering. Intentional.
- **Channel-id resolution:** `@CadeEsports` → one call at boot; cached.

---

## 7. Acceptance gate

- Migration applied cloud. CHECK extended. Featured-comment overlay template seeded.
- Unit tests green.
- Manual: go live on `@CadeEsports` (or use a test stream), admin binds it in the panel, sees messages, features one → appears on `/overlay/featured-comment` browser source in ~1 s.
- `YOUTUBE_API_KEY` documented in `docs/ops/youtube-api-key.md`.
