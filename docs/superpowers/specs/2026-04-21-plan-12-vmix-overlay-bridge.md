# Plan 12 — Phase 2 prep: browser-source overlay bridge + broadcast entities

**IMPORTANT (2026-04-21 clarification):** overlay pages are **plain browser URLs**. They work in ANY streaming tool that supports Browser Sources — OBS Studio, vMix, Streamlabs Desktop, Ecamm Live, XSplit, Restream Studio, etc. There is nothing vMix-specific in the implementation. All column names, UI labels, env vars, and docs use tool-agnostic terms ("browser source", "stream session", "overlay URL") — never "vMix" as a required prefix. vMix is mentioned only as one example operator tool in the README.

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Status:** Draft — Phase 2 preparation (schema + bridge scaffold, not full production integration)
**Supersedes:** Phase 2 bullets in `ESOCCER LEAGUE/PRODUCT_STRUCTURE.md` §3 (Broadcast), §4.10 (Broadcast entities), §6.1 (Stream integration)

---

## 1. Goal + Success Criteria

**Goal:** Land the data model, realtime bridge, admin control panel, and browser-source overlay route group required to push data-wired graphics into ANY stream tool (OBS Studio, vMix, Streamlabs, Ecamm, XSplit, Restream, etc.). Visual polish and the actual production workstation setup stay out. After this plan, a production operator can add a Browser Source in their tool pointing at `/overlay/<template_key>?session=<id>` and see overlays animate in when an admin clicks Trigger.

**Success criteria (each demonstrable end-to-end before plan is complete):**

1. Admin starts a stream session from `/admin/broadcast` against an existing `match_day`. The session row appears in `stream_sessions` with `ended_at IS NULL`.
2. Admin triggers Scorebar with home=3 away=1 against a live match. An open `/overlay/scorebar?session=<id>` tab updates within **1 second**, rendering `3 – 1` with home/away display names.
3. Every trigger writes a row to `overlay_events` with `payload JSONB` matching template's Zod schema and `triggered_by_user_id` set.
4. Admin clicks "Clear" on an active scorebar. The overlay page animates out. `overlay_events.cleared_at` is set.
5. Admin ends the stream session. `ended_at` populates (WAT). Any still-active overlays are auto-cleared.
6. A user without `broadcast.trigger` permission gets 403 when attempting to trigger.
7. Every trigger/clear is in `audit_events` via the existing `audit_row_change()` trigger.
8. Overlay route group renders transparent, no site chrome, no nav, no auth wall (overlays are unlisted-URL-secret, not auth-gated).

**Pre-flight (human action):** confirm Supabase Realtime is enabled on the target project (Dashboard → Project Settings → API → Realtime). Note in README that vMix and overlay server must share network access to Supabase's WebSocket endpoint.

---

## 2. Scope Discipline

**In scope:**
- `overlay_templates`, `stream_sessions`, `overlay_events` tables + migrations
- `server/broadcast/` and `server/overlays/` modules
- Zod payload schemas for the 7 seed templates
- `/admin/broadcast` control panel
- `(overlay)` route group with one page per template_key (visual stubs, not polished)
- Supabase Realtime channel wiring (publisher + subscriber)
- Permissions: `broadcast.trigger`, `broadcast.manage`
- Audit coverage
- ≥10 new unit tests, 1 E2E

**Out of scope (deferred to Phase 2 proper or beyond):**
- Actual vMix production workstation setup, Web Controller licensing, NDI config
- Overlay visual design polish (final motion graphics, brand fonts, animations beyond stub fade)
- vMix Web Controller API integration
- Intro/Outro media hosting (templates exist but render text stubs)
- Multi-session concurrency (assume one active session per match_day)
- Replay/scrub of overlay_events for post-show review UI
- **NO Paystack. NO payment integration. Anywhere.**

---

## 3. Data Model

All tables inherit Phase 1A conventions: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`, `deleted_at TIMESTAMPTZ NULL`. Audit trigger attached. WAT for display; UTC in storage.

### 3.1 `overlay_templates`

Seeded, not user-created in Phase 2 prep.

```sql
CREATE TABLE overlay_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key   TEXT NOT NULL UNIQUE,
  template_type  TEXT NOT NULL CHECK (template_type IN (
    'lower_third','scorebar','standings_widget',
    'player_card','punishment_ticker','intro','outro'
  )),
  name           TEXT NOT NULL,
  html_route     TEXT NOT NULL,   -- e.g., '/overlay/scorebar'
  default_payload_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_bool    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ NULL
);
CREATE INDEX overlay_templates_active_idx ON overlay_templates (active_bool) WHERE deleted_at IS NULL;
```

### 3.2 `stream_sessions`

```sql
CREATE TABLE stream_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_day_id         UUID NOT NULL REFERENCES match_days(id),
  session_tag     TEXT NULL,        -- free-form label the operator chooses
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ NULL,
  started_by_user_id   UUID NOT NULL REFERENCES users(id),
  notes                TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ NULL
);
-- Only one active session per match_day
CREATE UNIQUE INDEX stream_sessions_one_active_per_day
  ON stream_sessions (match_day_id)
  WHERE ended_at IS NULL AND deleted_at IS NULL;
CREATE INDEX stream_sessions_match_day_idx ON stream_sessions (match_day_id);
```

### 3.3 `overlay_events`

```sql
CREATE TABLE overlay_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_session_id       UUID NOT NULL REFERENCES stream_sessions(id),
  template_id             UUID NOT NULL REFERENCES overlay_templates(id),
  triggered_by_user_id    UUID NOT NULL REFERENCES users(id),
  triggered_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload                 JSONB NOT NULL,
  cleared_at              TIMESTAMPTZ NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ NULL
);
CREATE INDEX overlay_events_session_active_idx
  ON overlay_events (stream_session_id)
  WHERE cleared_at IS NULL AND deleted_at IS NULL;
CREATE INDEX overlay_events_template_idx ON overlay_events (template_id);
```

### 3.4 Audit trigger attachment

All three tables get `audit_row_change()` via the same pattern from Phase 1A §4.

### 3.5 RLS

Per CLAUDE.md: RLS only on PII tables. Broadcast tables are admin/production-only and gated in the API layer via `hasPerm()`. Service-role key bypasses RLS. No RLS policies on broadcast tables.

### 3.6 Seed

Insert one row per template_key: `scorebar`, `lower_third`, `standings_widget`, `player_card`, `punishment_ticker`, `intro`, `outro`. `html_route` matches `/overlay/<key>`.

---

## 4. Realtime Bridge Architecture

**Decision:** publish directly from the triggering route via `supabase.channel(...).send()` after DB insert succeeds. No pg_notify, no edge function. Simpler, fewer moving parts, latency well under 1s. DB row is durable record; broadcast is fire-and-forget notification. On subscriber reconnect, overlay page hydrates from most recent active `overlay_events` row via REST fetch.

```
+---------------------+          HTTP POST          +-----------------------+
| /admin/broadcast    |  -------------------------> | /api/broadcast/trigger|
| (admin UI)          |                             |  (route handler)      |
+---------------------+                             +-----------+-----------+
                                                                |
                                                    1. requirePerm
                                                    2. validate payload (Zod)
                                                    3. INSERT overlay_events
                                                                |
                                                                v
                                                     +----------+----------+
                                                     |  Postgres           |
                                                     |  (audit trigger     |
                                                     |   fires → audit_evs)|
                                                     +----------+----------+
                                                                |
                                                    4. supabase.channel(
                                                         "overlay:{sessionId}"
                                                       ).send({
                                                         type: 'broadcast',
                                                         event: 'overlay.triggered',
                                                         payload: { eventId, templateKey, payload }
                                                       })
                                                                |
                                                                v
                      +-----------------+   Supabase Realtime   +-----------------+
                      | /overlay/       | <-------------------  |   WebSocket     |
                      | scorebar?session|     broadcast         |   (Supabase)    |
                      | =<id> (vMix BS) |                       +-----------------+
                      +--------+--------+
                               |
                               | render payload, animate in
                               v
                      +-----------------+
                      | vMix Browser    |
                      | Source → Output |
                      +-----------------+
```

**Channel naming:** `overlay:{stream_session_id}`. One channel per session. Clear events use same channel, `event: 'overlay.cleared'`.

**Hydration on subscriber mount:**
1. Overlay page mounts, reads `session` query param.
2. Fetches `GET /api/broadcast/sessions/<id>/active?template_key=<key>` → most recent non-cleared `overlay_events` row for that template in that session, or null.
3. If present, render without in-animation.
4. Then subscribe to channel for future events.

Handles "vMix browser source reloaded mid-show" without operator intervention.

---

## 5. Server Modules

### 5.1 `apps/web/src/server/broadcast/`

- `sessions.ts` — `startSession({ matchDayId, userId, tag?, notes? })`, `endSession(sessionId, userId)`, `getActiveSession(matchDayId)`, `listSessions(matchDayId)`. `endSession` sets `cleared_at=now()` on still-active overlay events before setting `ended_at`.
- `events.ts` — `triggerOverlay({ sessionId, templateKey, payload, userId })`, `clearOverlay({ eventId, userId })`, `listActiveOverlays(sessionId)`, `getActiveForTemplate(sessionId, templateKey)`. `triggerOverlay` validates via template Zod schema, inserts, then publishes on channel.
- `realtime.ts` — thin wrapper exporting `publish(sessionId, event, payload)`. Uses service-role client. Isolated so unit tests can mock.
- `permissions.ts` — re-exports two new perm strings for grep-ability.

### 5.2 `apps/web/src/server/overlays/`

- `schemas.ts` — Zod schema per template_key:
  - `scorebar`: `{ homeName, awayName, homeScore, awayScore, matchId? }`
  - `lower_third`: `{ playerId, displayName, gamerTag, jerseyNumber, stats?: { gp, w, d, l, pts } }`
  - `standings_widget`: `{ topN: number, rows: Array<{ rank, displayName, pts, gd }> }`
  - `player_card`: `{ playerId, displayName, photoUrl?, gamerTag, seasonStats: { gp, w, d, l, gf, ga, pts } }`
  - `punishment_ticker`: `{ items: Array<{ playerName, sanction, magnitude, issuedAt }> }` (only `public_visible=true`, last N)
  - `intro`: `{ matchDayLabel, seasonLabel }`
  - `outro`: `{ matchDayLabel, footer?: string }`
- `autofill.ts` — helpers building payloads from current DB state so UI can offer "Auto-fill from live match" buttons.
- `registry.ts` — const map `TEMPLATE_KEY → { schema, route }`. Single source of truth for UI + API.

### 5.3 API routes

All in `apps/web/src/app/api/broadcast/`:

- `POST /api/broadcast/sessions` — start session. Requires `broadcast.manage`.
- `POST /api/broadcast/sessions/:id/end` — end session. Requires `broadcast.manage`.
- `GET  /api/broadcast/sessions/:id/active` — list active overlays for subscribers + admin UI polling fallback. No auth (overlays run in headless browser sources).
- `POST /api/broadcast/events` — trigger. Requires `broadcast.trigger`. Body `{ sessionId, templateKey, payload }`.
- `POST /api/broadcast/events/:id/clear` — clear one. Requires `broadcast.trigger`.
- `GET  /api/broadcast/sessions/:id/events` — audit list for control panel.

### 5.4 Permissions map update

Append to `src/perms.ts`:

```ts
admin:     [..., 'broadcast.trigger', 'broadcast.manage']
moderator: [...]                 // unchanged
production: ['broadcast.trigger']
```

`production` role row added to `user_roles.role` check constraint; no seed users get it in Phase 2 prep.

---

## 6. UI Routes + Layout Tree

### 6.1 New route group `(overlay)`

Sibling to `(public)`, `(admin)`, `(auth)`. Its own `layout.tsx`:
- Renders ONLY `{children}`. No `<SiteChrome/>`, no nav, no footer, no auth gate.
- Sets `<body>` background to `transparent`.
- Disables global CSS that adds default background color.

```
apps/web/src/app/
├── (public)/
├── (admin)/
│   └── broadcast/              # NEW — control panel
│       ├── page.tsx            # session picker + start/end
│       └── [sessionId]/
│           └── page.tsx        # trigger grid + active overlays panel
├── (auth)/
├── (overlay)/                  # NEW — route group
│   ├── layout.tsx              # transparent, no chrome
│   └── overlay/
│       ├── scorebar/page.tsx
│       ├── lower-third/page.tsx
│       ├── standings-widget/page.tsx
│       ├── player-card/page.tsx
│       ├── punishment-ticker/page.tsx
│       ├── intro/page.tsx
│       └── outro/page.tsx
└── api/broadcast/...
```

### 6.2 Admin Broadcast Control Panel

**`/admin/broadcast`:**
- Header "Broadcast Control"
- Dropdown: pick `match_day` (scheduled/in-progress/completed within last 24h)
- If no active session: "Start Stream Session" → POST → redirect to `/admin/broadcast/<sessionId>`
- If active session: link "Resume session started at <time WAT>" → same redirect
- Below: table of past sessions for selected match_day (read-only)

**`/admin/broadcast/[sessionId]`:**
Three columns (desktop) / stacked (mobile):
1. **Template Grid.** Card per template. Each card has:
   - Header (name, type)
   - Payload preview form (Zod-schema-driven)
   - "Auto-fill from live match" button where `autofill.ts` applies
   - "Trigger" button → POST
2. **Active Overlays Panel.** Live list (polls every 3s; realtime subscribe optional). Each row: template name, truncated payload, triggered_at, "Clear" button.
3. **Session Controls.** Session tag editable inline, notes textarea, "End Session" button (confirm modal).

Nav link: add "Broadcast" to admin sidebar, permission-gated on `broadcast.manage`.

### 6.3 Browser-source overlay pages

Each `page.tsx` under `(overlay)/overlay/<key>/` is a Client Component:

1. Reads `session` + optional debug flags from `useSearchParams`.
2. On mount: fetches `/api/broadcast/sessions/<session>/active?template_key=<key>` to hydrate.
3. Subscribes: `supabase.channel("overlay:"+sessionId).on('broadcast', { event: 'overlay.triggered' }, handler).on('broadcast', { event: 'overlay.cleared' }, clearHandler).subscribe()`.
4. On `overlay.triggered` where payload's `templateKey === <key>`: validate with Zod on client (defensive), animate in, render.
5. On `overlay.cleared` matching current event id: animate out.
6. Stub animation: 300ms CSS fade + slide; polished motion design is Phase 2 proper.
7. No auth. No site chrome. Transparent background.

Debug aid: `?debug=1` renders HUD showing connection state + last event, only when env `NEXT_PUBLIC_OVERLAY_DEBUG=1`.

---

## 7. Tests

**Unit (≥10 new, Vitest):**

1. `sessions.startSession` creates row, rejects when another active session exists for same match_day.
2. `sessions.endSession` clears active overlays and sets `ended_at`.
3. `events.triggerOverlay` rejects unknown `templateKey`.
4. `events.triggerOverlay` rejects payload failing Zod schema.
5. `events.triggerOverlay` writes row and calls `realtime.publish` exactly once.
6. `events.clearOverlay` sets `cleared_at` and publishes `overlay.cleared`.
7. `autofill.buildScorebarPayload` reads match + players → schema-valid payload.
8. `autofill.buildPunishmentTickerPayload` filters to `public_visible=true`, limits N, orders desc.
9. `registry` exports every `template_key` in CHECK constraint (drift guard).
10. `permissions` — admin has both broadcast perms, moderator has neither.
11. `schemas` — each template's Zod schema round-trips its `default_payload_schema` JSON.
12. `realtime.publish` forms correct channel name and event names.

**E2E (Playwright, `apps/web/tests/e2e/broadcast-overlay.spec.ts`):**

1. Log in as admin, create test match_day + match via API fixture helper.
2. Start stream session via UI.
3. Open second browser context at `/overlay/scorebar?session=<id>` (headless vMix stand-in).
4. In admin tab, fill scorebar (home=3, away=1), click Trigger.
5. Assert within 2s the overlay context's DOM contains `3` and `1` and the two names.
6. Click Clear. Assert overlay leaves within 2s.
7. End session. Clean up by soft-deleting test match_day.

---

## 8. Numbered Tasks

1. **Migration `20260421_broadcast_tables.sql`** — create three tables with constraints and indexes per §3.
2. **Migration `20260421_broadcast_audit.sql`** — attach `audit_row_change()` trigger to three new tables.
3. **Migration `20260421_user_roles_add_production.sql`** — extend `user_roles.role` CHECK to include `'production'`.
4. **Seed update** — append 7 `overlay_templates` rows to `supabase/seed.sql`.
5. **Perms update** — add `broadcast.trigger` and `broadcast.manage` to `src/perms.ts`; add `production: ['broadcast.trigger']`.
6. **Schemas + registry** — implement `src/server/overlays/schemas.ts` and `registry.ts` with 7 Zod schemas.
7. **Autofill helpers** — implement `src/server/overlays/autofill.ts` for 5 data-bound templates.
8. **Broadcast sessions module** — `src/server/broadcast/sessions.ts` + unit tests.
9. **Broadcast events module** — `src/server/broadcast/events.ts` + `realtime.ts` + unit tests.
10. **API routes** — add 6 route handlers under `src/app/api/broadcast/`.
11. **Overlay route group** — create `(overlay)/layout.tsx` with transparent body and no chrome.
12. **Overlay pages (stubs)** — 7 pages under `(overlay)/overlay/<key>/page.tsx`.
13. **Hydration endpoint** — `/api/broadcast/sessions/:id/active` returns active-per-template map.
14. **Admin control panel list view** — `/admin/broadcast/page.tsx` with match_day picker + start session.
15. **Admin control panel session view** — `/admin/broadcast/[sessionId]/page.tsx` with trigger grid, active overlays list, session controls.
16. **Admin nav link** — add "Broadcast" (admin.manage-gated) to admin sidebar.
17. **E2E test** — `broadcast-overlay.spec.ts` per §7.
18. **Docs update** — README section explaining operator workflow + Supabase Realtime pre-flight.
19. **Verification pass** — run full test suite + manual demo of success criteria 1-5.
20. **Retrospective + lessons** — append findings to `tasks/lessons.md`.

---

## 9. Acceptance Criteria

- [ ] All three migrations apply cleanly to fresh DB and linked project.
- [ ] Audit trigger fires for every insert/update on broadcast tables.
- [ ] 7 `overlay_templates` rows present after seed.
- [ ] `npm run test` passes; ≥12 new unit tests green.
- [ ] `npm run e2e` passes; broadcast E2E green.
- [ ] `npm run lint` and `npm run build` clean.
- [ ] Manual demo: trigger scorebar (3–1) → visible on `/overlay/scorebar?session=<id>` within 1s.
- [ ] Manual demo: hydration — close/reopen overlay tab mid-session; active scorebar re-appears without re-triggering.
- [ ] Manual demo: non-admin user gets 403 from `POST /api/broadcast/events`.
- [ ] `hasPerm` returns true for admin on both broadcast perms, false for moderator and player.
- [ ] `(overlay)` route group does not render `<SiteChrome/>`; DOM confirms `<body>` transparent.

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Supabase Realtime latency > 1s on free tier | Medium | Medium | Document pre-flight; add diagnostic banner in admin UI showing "last ping"; measure in E2E. |
| vMix browser cache serves stale overlay bundle after deploy | High | Low | Append `?v=<build-hash>` in operator README; set `Cache-Control: no-store` on overlay pages via route segment config. |
| Payload schema drift between server Zod and overlay-page Zod | Medium | Medium | Single source of truth in `src/server/overlays/schemas.ts`. Unit test 9 enforces CHECK↔registry parity. |
| Admin triggers two scorebars back-to-back; overlay sees only second | Low | Low | Desired — latest wins. Document. |
| Realtime channel collisions (two sessions for same match_day) | Low | High | Unique index on `stream_sessions` prevents two active sessions per match_day. |
| Operator leaves overlay URL open after session ends → last frame forever | Medium | Low | `endSession` clears all active overlays; overlay page also listens for session-ended broadcast and blanks out. |
| Overlay page inherits site CSS resets → white background in vMix | High if missed | High visual | Explicit E2E assertion: `getComputedStyle(document.body).backgroundColor === 'rgba(0,0,0,0)'`. |
| Service-role key usage in hydration endpoint leak vector | Low | High | Endpoint returns only `overlay_events` fields. Rate-limit per session id. |

---

## 11. Open Questions

1. **Next.js WebSocket vs Supabase Realtime for bridge?** Picking Supabase Realtime. Revisit if latency measurements justify custom WS route.
2. **Should `production` role get `broadcast.manage` or only `broadcast.trigger`?** Plan says trigger-only; admin keeps manage. Confirm with ops.
3. **Do overlay URLs need signed token instead of raw `session` param?** Phase 2 prep treats URL as shared secret. Phase 2 proper should add short-lived HMAC token.
4. **vMix Web Controller API** — fallback HTTP push path? Deferred; document stub hook point in `realtime.ts`.
5. **Intro/outro media** — Supabase Storage or CDN bucket? No answer needed for stub.
6. **Cleanup policy** — `overlay_events` growth; agree on 90-day archival/prune for Phase 3.

---

## 12. Out of Scope (reiterated)

- Actual vMix production setup (hardware, Web Controller licensing, NDI, XDCAM output)
- Overlay visual design polish (motion graphics, typography, brand palette)
- Intro/outro media asset hosting
- Overlay replay/scrub UI
- Real-time co-editing of queued overlays
- **No Paystack, no payments, no monetization surface of any kind** — per CLAUDE.md.

---

## 13. Critical Files for Implementation

- `apps/web/src/server/broadcast/events.ts`
- `apps/web/src/server/overlays/schemas.ts`
- `apps/web/src/app/(overlay)/layout.tsx`
- `apps/web/src/app/(admin)/broadcast/[sessionId]/page.tsx`
- `supabase/migrations/20260421_broadcast_tables.sql`
