# YouTube Data API v3 — Runbook

Plan 44 (YouTube live-chat picker + Feature-on-stream overlay) needs a Google
Cloud API key scoped to the YouTube Data API v3. This runbook covers how to
provision one, restrict it, add it to local + Vercel envs, and manage quota.

## 1. Enable the API + create a key

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or reuse one, e.g. `cade-league`).
3. Go to **APIs & Services → Library**, search for **YouTube Data API v3**,
   click **Enable**.
4. Go to **APIs & Services → Credentials**, click **+ Create credentials →
   API key**.
5. A new key appears. Copy it. We will restrict it next.

## 2. Restrict the key

1. Click the new key's row to open its settings.
2. **Application restrictions:** leave **None** for server-side use. (The key
   is only called from Next.js server routes — never from the browser.)
3. **API restrictions:** select **Restrict key**, tick only **YouTube Data
   API v3**, Save.
4. Optional: rename the key to `cade-league-yt-data-api` so it is obvious
   when auditing keys later.

## 3. Add to local env

Add to `apps/web/.env.local`:

```
YOUTUBE_API_KEY=AIzaSy...your-key...
```

Restart `npm run dev -w apps/web` so Next.js picks it up.

## 4. Add to Vercel

1. Vercel dashboard → project → **Settings → Environment Variables**.
2. Add `YOUTUBE_API_KEY` with your key. Scope to **Production**, **Preview**,
   **Development** as appropriate.
3. Re-deploy (or it kicks in on next deploy).

## 5. Quota

Free-tier quota: **10,000 units / day** across the project.

Plan 44 API usage per admin-bound session:

| Operation              | Units | Freq.                              |
| ---------------------- | ----- | ---------------------------------- |
| `channels.list`        | 1     | once per server boot (cached)      |
| `search.list` (live)   | 100   | per "Pick a live stream" click     |
| `videos.list`          | 1     | paired with `search.list`          |
| `liveChatMessages.list`| 5     | every ~3 s while admin is polling  |

A 2-hour broadcast with one admin panel open ≈ 5 × (3600 × 2 / 3) = 12,000
units, which can exceed the daily cap. Mitigations:

- **Tab backgrounding:** the panel's poll loop skips fetches while the admin
  tab is hidden (already in `YouTubeChatPanel`).
- **Request a quota increase:** Google Cloud Console → APIs & Services →
  YouTube Data API v3 → Quotas → "Queries per day" → Edit → request more.
  Typical approvals are 1 M units/day for legitimate uses.

When quota is exhausted, API calls return 403. The admin panel surfaces this
as the string `YouTube API quota exceeded or invalid key` in its error
banner.

## 6. Failure modes

- **Key missing** → Panel shows `YOUTUBE_API_KEY is not configured` after
  the first poll; overlay triggers still work via the textarea-based
  Featured Comment starter in the admin broadcast page.
- **Handle unknown** → `resolveChannelId` throws `YouTube channel not
  found for handle: <h>`. Confirm the handle in `/api/youtube/live/route.ts`
  matches the real channel.
- **Live chat ended mid-session** → `liveChatMessages.list` returns 404
  (`liveChatId no longer active`). Admin unbinds + re-binds the next stream.

## 7. Rotation

1. Create a second API key (steps 1-2 above).
2. Swap `YOUTUBE_API_KEY` in Vercel + redeploy.
3. Delete the old key from the Credentials page after a grace period.
