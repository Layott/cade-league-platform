# Ambient Session — Stable OBS URLs (2026-04-26)

## TL;DR

OBS / vMix / Streamlabs browser-source URLs are now **permanent**. Paste
once, never re-paste across broadcast sessions or redeploys.

```
https://cade-league.vercel.app/overlay/v2/01-brb
https://cade-league.vercel.app/overlay/v2/02-timer
https://cade-league.vercel.app/overlay/v2/07-leaderboard
https://cade-league.vercel.app/overlay/v2/08-lower-third?slot=1
https://cade-league.vercel.app/overlay/v2/08-lower-third?slot=2
https://cade-league.vercel.app/overlay/v2/08-lower-third?slot=3
... (all 16 v2 keys, see `apps/web/src/components/broadcast/v2/overlay-keys.ts`)
```

No `?session=`, no `?token=` — the server resolves the live broadcast
session automatically.

## Why

Before this change every broadcast started with the operator copying 16+
URLs (one per overlay key) out of the admin control room and pasting
each into OBS as a browser-source — including a freshly-minted session
UUID + view token. New session next week → re-paste all 16. Mid-event
panic.

## How it works

### 1. Server resolves at request time

When you hit `/overlay/v2/<key>` with no `session` param the page calls
`getActiveSession(getServiceRoleSupabase())` which returns the most
recent `stream_sessions` row where `ended_at IS NULL AND deleted_at IS
NULL`, ordered by `started_at DESC`. That session id + its season id
flow into the overlay shell on the SSR pass.

If no live session exists the page still renders — the overlay frame
sits idle in default-OFF state. No crash, no redirect.

### 2. Browser polls for session changes

`OverlayDataInjector` ticks every 30s against
`/api/broadcast/active-session` (public, no auth, `Cache-Control:
no-store`). When the active session id changes mid-stream — one ends,
another starts — the injector swaps its internal session id, which
forces the Realtime channel-subscribe effect to tear down + re-subscribe
to the new `overlay:<sessionId>` channel. The OBS browser source repaints
without any operator action.

Polling is gated behind `ambient={true}`. Live OBS routes have it on;
mini-preview iframes inside the broadcast control room leave it off so
they stay pinned to the operator-picked session.

### 3. Lower-third slots stay distinct

Each lower-third anchor (slot 1, 2, 3) needs its own browser source so
operators can show three names at once. The slot param survives onto
ambient URLs:

```
/overlay/v2/08-lower-third?slot=1
/overlay/v2/08-lower-third?slot=2
/overlay/v2/08-lower-third?slot=3
```

## Backwards compatibility

URLs that explicitly carry `?session=<uuid>` still work. The page-side
resolver only kicks in when the param is missing or set to the literal
string `current`. E2E specs from before this change continue to pass.

The control-room "Copy URL" button now produces the stable form by
default — operators get the new behaviour automatically. Older copies
still work, they just won't auto-swap when the session flips.

## Files

- `apps/web/src/server/broadcast/active_session.ts` —
  `getActiveSessionId()` + `getActiveSession()` resolver helpers.
- `apps/web/src/app/api/broadcast/active-session/route.ts` —
  GET endpoint polled by the injector.
- `apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx` —
  resolves session SSR-side when missing.
- `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx` —
  `ambient` prop + 30s poll + session-change re-subscribe.
- `apps/web/src/components/broadcast/v2/overlay-keys.ts` —
  `v2OverlayUrl()` emits stable form when `preview=false`.

## Verification

1. Open `https://cade-league.vercel.app/overlay/v2/01-brb` (no params).
   The overlay frame renders; the browser fetches
   `/api/broadcast/active-session`.
2. Hit `https://cade-league.vercel.app/api/broadcast/active-session`
   directly — JSON `{sessionId, matchDayId, seasonId}` (each may be
   null between events).
3. Trigger an overlay from the broadcast control panel — within 30s the
   stable URL repaints with the live state.
4. End the session, start a new one — the stable URL auto-resubscribes
   to the new channel within the next poll tick.

## Known limitations

- A 30s upper bound on session-flip latency is acceptable for inter-day
  transitions but not for live mid-broadcast hot-swap. Tunable via
  `AMBIENT_POLL_MS` exported from `OverlayDataInjector`.
- If two `stream_sessions` rows briefly share `ended_at IS NULL` (race
  during `endSession()` + `startSession()`) the resolver picks the most
  recent `started_at`. The `endSession` path always sets `ended_at`
  before `startSession` runs, so the window is sub-millisecond.
