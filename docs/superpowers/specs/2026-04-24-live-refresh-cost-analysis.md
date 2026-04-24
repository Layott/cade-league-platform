# Live-refresh cost analysis — 2026-04-24

Plain-English answer to: **"Does auto-refresh burn resources? What would it cost?"**

## Short answer

For a 30-user league, live-refresh is essentially free on your current Supabase plan. The expensive case is if the feature-creep path lights up (public broadcast of matches → 10,000 concurrent viewers), not the one you're in today.

## How "live refresh" can work (three patterns)

1. **Path revalidation** (`revalidatePath("/fixtures")`) — server throws away the cached HTML. Next visitor gets fresh data. **Cost ≈ 0**. The client still has to navigate / refresh the tab.

2. **Polling** — the page asks "anything new?" every few seconds. **Cost = N users × queries per minute**. 30 users on `/fixtures` at 5s interval = 360 queries/minute. Cheap but wasteful.

3. **Realtime (WebSocket)** — Supabase pushes changes to subscribed pages the moment they happen. **Cost = 1 persistent connection per open tab + 1 event per change**.

## Supabase Realtime pricing (Feb 2026)

| Tier | Connections | Messages/month | Monthly cost |
|------|-------------|----------------|--------------|
| Free | 200 peak concurrent | 2M | $0 |
| Pro | 500 concurrent | 5M included | $25 |
| Team | 1,000 concurrent | 5M included | $599 |

## What 30 users costs you

Worst-case snapshot: every admin + every player has 3 tabs open, all subscribed.
- 30 users × 3 tabs = 90 concurrent connections.
- Average match day: ~500 DB changes (fixtures created, results entered, standings recomputed, punishments issued). Each change fans out to ~5 subscribers = 2,500 messages/match day.
- 10 match days/month × 2,500 = 25,000 messages/month.

**Well inside the Free tier.** You pay $0.

## What would push you out of free tier

- Concurrent connections >200 at the same moment. You'd need an audience-facing live page (e.g., `/broadcast/live` open to fans) with >200 tabs. Nothing today does that.
- Messages >2M/month. Would require ~800 match days a month. You run ~10.
- The Broadcast mini-preview iframes spawn one connection each (~27 per admin session). At 4 simultaneous broadcast producers that's 108 + the admin's main page = plausibly >200 concurrent. **One thing to watch**.

## Broadcast page — the exception

User spec: **broadcast must update immediately, always**. Score bumps, squad reveals, punishment tickers — all instant. This is non-negotiable and the right call: overlays compositing in OBS/vMix can't tolerate stale data.

Implication: every overlay-facing table (overlay_events, stream_sessions, overlay_active_instances, score_bug) keeps its Realtime subscription. Already wired.

If the concurrent-connection ceiling ever matters, the cheap lever is to scope subscribers per-session: the admin's `/admin/broadcast/[sessionId]` only subscribes to rows with that `session_id`, not all events. Already implemented today.

## Recommendations

| Surface | Pattern | Why |
|---|---|---|
| `/standings` | Realtime (already wired) | Fans refresh constantly; small event volume |
| `/fixtures` | **Realtime — new** | Same audience + behaviour as standings; cheap |
| `/players/[id]` recent stats | `revalidatePath` on confirm | Stats change 1-2×/match day, not minute-by-minute |
| `/profile` sanctions + disputes | `revalidatePath` on rule + small Realtime ping | Player expects to see ruling without reload |
| `/admin/squads` (queue) | Realtime (new) | Admin sits on page; players drip submissions |
| `/player/squad` (after submit) | Realtime (new) | Player watches for admin approve/reject |
| `/admin/match-days/[id]` | `revalidatePath` on result/attendance | Not hot enough for WS |
| Broadcast overlays | Realtime (wired) | Non-negotiable; already done |

**Net new realtime channels recommended: 4** — `/fixtures`, `/admin/squads`, `/player/squad`, `/profile` sanctions + disputes ping.

**Projected additional cost: $0 on current volume.** Stays on the free tier by a comfortable margin.

## When to revisit

Flip to Pro ($25/mo) the month any of these go true:
- First production broadcast attracts >100 simultaneous OBS clients.
- You open `/broadcast/live` or equivalent to public viewers.
- Notifications system (Task #33) fans-out emails to non-player audiences and you cross 2M DB-change events.

Until then, live-refresh is effectively a $0 decision.
