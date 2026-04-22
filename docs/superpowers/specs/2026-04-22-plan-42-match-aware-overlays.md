# Plan 42 — Match-aware overlays (auto-trigger + auto-fill)

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Approved, ready for implementation
**Origin HEAD:** `bb51bd0`
**Depends on:** Plan 37 (active_instances + match_clock), Plan 12 (overlay bridge), Plan 2 (players)

---

## 1. Goal

Every overlay that renders player identity MUST, by default, pull names + photos + jersey numbers + gamer tags from the **current match** selected on the broadcast session. Generic "Home" / "Away" labels are banned.

Admin presses **Select match → Start match**. Outcome: the selected match becomes the session's current match, active_instances for score_bug + match_clock auto-spawn, realtime `match.started` fires, relevant overlays render with real player data. Admin still controls score via +1/+1/reset buttons on the broadcast panel. "End match" finalizes + clears.

---

## 2. Success criteria

1. `/admin/broadcast/<sessionId>` shows a **Current match** select listing today's scheduled matches + "[search all]" option for any active-season match.
2. Admin selects a match, presses **Start match**:
   - `stream_sessions.current_match_id` set; `match_started_at` set (UTC).
   - `matches.status` flips `scheduled → in_progress`.
   - An `active_instances` row for `score_bug` is created (or updated) with payload auto-filled: `{ home: { displayName, gamerTag, photoUrl, score: 0 }, away: { ... }, matchId }`.
   - An `active_instances` row for `match_clock` is created (mode='stopped', secondsRemaining=0).
   - Realtime `match.started` event broadcast on the session channel.
3. Score controls on the panel (+1 home / +1 away / −1 home / −1 away / reset) update the score_bug instance payload + broadcast live. No re-trigger required — overlay subscribes to payload changes (Plan 37 contract).
4. Any overlay triggered AFTER match start (goal stinger, lower-third, h2h cards) pre-fills from the current match. Admin can override individual fields in the trigger form; override wins.
5. **End match** button sets `matches.status='completed'`, writes final `match_results` row, clears session `current_match_id`, broadcasts `match.ended`.
6. **No overlay** renders "Home" / "Away" generic labels once a current_match is set. If no match is set, existing stub labels remain (backwards compat for a session that hasn't selected a match).

---

## 3. Architecture

### 3.1 Data model
Migration `20260509000100_plan42_session_current_match.sql`:
- `alter table public.stream_sessions add column if not exists current_match_id uuid null references public.matches(id);`
- `alter table public.stream_sessions add column if not exists match_started_at timestamptz null;`
- `create index if not exists stream_sessions_current_match_idx on public.stream_sessions (current_match_id) where current_match_id is not null;`
- No change to `active_instances` / `match_clock` — both already keyed on session_id.

### 3.2 Server modules

`apps/web/src/server/broadcast/match_flow.ts` (new):
- `listSelectableMatches(sb, sessionId, { scope: 'today' | 'all' })` → matches for the dropdown.
- `startMatch(sb, sessionId, matchId, actor)` → transaction-like sequence:
  1. Update `stream_sessions` SET current_match_id + match_started_at = now.
  2. Update `matches.status = 'in_progress'` when currently `scheduled`.
  3. Upsert `active_instances` for `score_bug` with payload from `buildScoreBugFromMatch`.
  4. Upsert `active_instances` for `match_clock`.
  5. Publish realtime `match.started` with `{ matchId, home, away, startedAt }`.
  6. Audit row via trigger.
- `endMatch(sb, sessionId, { homeScore, awayScore, notes }, actor)` → writes `match_results` + sets match `status='completed'` + clears `current_match_id` + publishes `match.ended`.
- `updateScoreBug(sb, sessionId, { homeDelta?, awayDelta?, reset?: true }, actor)` → mutates active_instance payload.score + publishes `instance.triggered`.

`apps/web/src/server/overlays/autofill.ts` (extend):
- `buildScoreBugFromMatch(match, home, away)` → strict payload for `score_bug` (player names + photos + starting 0-0).
- `buildLowerThirdFromPlayer(player)` → `{ playerId, displayName, gamerTag, jerseyNumber, photoUrl }`.
- `buildH2HFromMatch(sb, match)` → loads both players' season stats + builds `h2h_2` payload.
- `buildUpNextFromNextMatch(sb, sessionId)` → next scheduled match in same match_day.

### 3.3 Admin UI

`apps/web/src/app/admin/broadcast/[sessionId]/page.tsx`:
- New panel component `<MatchControlPanel />` above the existing template triggers.
- Contents:
  - Match select (dropdown, default = session's current_match_id, options loaded via server component using `listSelectableMatches`).
  - **Start match** button → binds `startMatchAction`. Disabled when a match is already in-progress on this session.
  - Score widget (when current_match_id set): `[home_name] [score] +1 −1 | [away_name] [score] +1 −1 | Reset`. Binds `scoreBugDeltaAction`.
  - **End match** button → binds `endMatchAction`. Opens confirm modal asking for final-score confirmation + optional notes.
- Existing template triggers below continue to work. When the admin opens (e.g.) the `stinger_goal` trigger form, fields are pre-filled from `current_match_id` (scorer defaults to home player; admin can pick away or custom).

### 3.4 Overlay pages

- `/overlay/score-bug` (already Plan 37) — uses `useOverlayInstances` to read the live instance payload. No change to page; payload now provided by `buildScoreBugFromMatch`.
- `/overlay/lower-third` — if instance is triggered without explicit displayName/gamerTag, fall back to current_match home player (server-side lookup). Acceptable because the instance payload already resolves server-side.
- `/overlay/h2h-2` etc — same fallback via `buildH2HFromMatch`.
- Overlays that deliberately show generic chrome (e.g. `starting-soon-basic`) — no change.

### 3.5 Permissions

New perm `broadcast.match_control` (admin + production roles). Governs the start/end/score actions. Seeded by migration `20260509000101_plan42_broadcast_perms_seed.sql`.

### 3.6 Realtime

New event names on the session channel:
- `match.started` — `{ matchId, home, away, startedAt }`
- `match.ended` — `{ matchId, endedAt, result }`
- `score.changed` — `{ homeScore, awayScore, matchId }` (emitted alongside `instance.triggered` for `score_bug`)

Add to `REALTIME` constants in `apps/web/src/server/overlays/registry.ts`.

---

## 4. Testing

### Unit
- `match_flow.test.ts` — 8 cases: start match happy-path, start when already in-progress (reject), end match happy-path + row-written, score delta clamps ≥0, autofill from player row, perm denial bubbles, realtime publish called, `current_match_id` cleared on end.
- `autofill.test.ts` — extends existing file: builders produce valid schemas.

### E2E
- `match-aware-broadcast.spec.ts`:
  1. Admin logs in → broadcast session.
  2. Selects "ADEFOLA vs FARUK" → Start match.
  3. Visits `/overlay/score-bug?sessionId=...` → sees `ADEFOLA 0 - 0 FARUK` with photos.
  4. Admin presses `+1 home` twice → overlay shows `2 - 0`.
  5. End match with final `2-1` → match_results row inserted → overlay clears.

---

## 5. Rollout + risks

- Concurrent score updates: `updateScoreBug` uses optimistic concurrency (version column on active_instances if exists; else read-modify-write is acceptable at single-admin ops).
- Match row transitions must be idempotent; "start match" twice = no-op the second time.
- Overlay pages currently rendering `Home/Away` need audit to ensure they gracefully fallback. Non-critical routes can keep their stub.
- Player photo URLs must be public-readable (player-photos bucket). Already is.

---

## 6. Acceptance gate

- `npm run test` + `npm run lint` + `npm run build` clean.
- E2E green.
- Manual: admin selects Faruk vs Anife → sees their photos on the score-bug browser source + live score updates.
- No "Home" / "Away" generic text renders on any overlay when a current_match is set.
