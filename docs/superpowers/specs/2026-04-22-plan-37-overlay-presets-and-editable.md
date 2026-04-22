# Plan 37 — Overlay preset library, editable runtime overlays, reference-driven design polish

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Draft — spec only, awaiting approval before implementation
**Origin HEAD:** `03d6963`
**Depends on:** Plan 12 (overlay bridge — shipped), Plan 16 (27 polished templates — shipped)
**Supersedes:** none

---

## 1. Goal + Success Criteria

**Goal.** Convert the broadcast surface from "one-shot fire-and-clear" into a **producible, multi-instance, runtime-editable** stream graphics rig. Three orthogonal upgrades layered on Plans 12 + 16:

1. **Preset library** — every editable overlay (lower-third, score-bug, up-next, timer, BRB-basic, casters-chat, intro, outro, starting-soon-basic, stream-ended) maintains a saved `overlay_presets` library. Producers load a preset into the trigger form, optionally tweak, then trigger.
2. **Multi-active lower-thirds** — current registry/events model assumes one active row per template per session. Replace lower-third's slot model with three concurrent stacked slots (bottom / mid / top) so a caster name + a player tag + a sponsor mention can co-exist on screen.
3. **Editable runtime** — match-clock, score-bug, up-next become *live editable while triggered*: clock pause/resume/adjust, score-bug numbers/names editable mid-broadcast, up-next dual-mode (auto-pull from next scheduled match OR free-form override). The overlay re-renders on every edit; no clear+retrigger ceremony.

A fourth, parallel workstream — **reference design adoption** — replaces the inline-styled Plan 12 stubs for the editable templates with motion + chrome derived from `KNOWLEDGE/brand-assets/elements/*.html`. Strong design language reference, not pixel-perfect; brand tokens + motion tokens enforced.

**Success criteria (each demonstrable end-to-end before plan is complete):**

1. `overlay_presets`, `overlay_active_instances`, `match_clock` migrations applied; CHECK constraints + audit trigger + admin RLS verified via `npx supabase db query`.
2. Producer can save a lower-third preset on `/admin/broadcast/[sessionId]` ("Caster · Rhymez"), reload it next session, edit one field, save as new preset — round-trip preserves payload byte-for-byte through Zod schema.
3. Producer triggers three lower-third instances concurrently (bottom / mid / top slot). All three render simultaneously on `/overlay/lower-third?session=…`. Clearing slot 2 leaves slots 1 + 3 untouched.
4. Match-clock: producer sets countdown 5:00, hits Start. Overlay tab counts down without server tick. Producer pauses at 3:42, edits to 4:00, resumes — overlay reflects within 250 ms via realtime broadcast.
5. Score-bug "Load from match" dropdown lists today's scheduled/in-progress matches; selecting one populates form with `home/away` names + current scoreline. Free-form mode untouched.
6. Up-next "Load from match" pulls the next chronologically scheduled match in the active match-day; free-form mode lets producer key in custom matchup.
7. Lower-third + score-bug + up-next + timer overlay pages each adopt the chrome from `17_lower_third.html`, `18_score_bug.html`, `19_up_next.html`, `10_timer.html` — clip-path corner, accent stripes, pulse dot, shield slot — using only brand tokens (no inline hex).
8. `npm run test` green, ≥ 15 new unit tests; `npm run e2e` green, ≥ 1 new spec (`overlay-presets-and-editable.spec.ts`) covering preset CRUD, multi-instance render, live clock edit.
9. `npm run lint` clean; `next build` clean; bundle size stays ≤ 250 KB first-load JS per editable overlay route.
10. `audit_row_change()` trigger fires on insert/update/delete for all three new tables — verified by `audit:smoke` extension.

---

## 2. Scope Discipline

**In scope:**
- New tables: `overlay_presets`, `overlay_active_instances`, `match_clock`
- New server modules: `server/overlays/presets.ts`, `server/overlays/instances.ts`, `server/overlays/match_clock.ts`
- Realtime channels: `instances:lower_third` (per-session, multi-active), `match_clock:<sessionId>` (server-config push)
- Admin UI rewrite of `/admin/broadcast/[sessionId]` per editable template — preset library left, active instances right, "Load from match" dropdown for score-bug + up-next
- Overlay page rewrites (4): `/overlay/lower-third`, `/overlay/layout-timer`, `/overlay/score-bug`, `/overlay/up-next-bug`
- Reference-driven chrome polish for the four rewritten pages; brand tokens only
- New perms: `overlay_presets.manage`, `match_clock.manage` (admin role default)
- Migration files (3) + audit attachment + admin RLS
- Unit (≥ 15) + E2E (≥ 1) + verification per §7

**Out of scope (defer / drop):**
- Multi-instance support for templates other than `lower_third` (single-instance contract preserved for the other 26)
- Visual regression snapshots — Phase 3
- Producer-authored *new templates* (template registry stays code-defined per Plan 12 §3.1)
- Preset *sharing* across sessions other than read access (no fork / version history yet)
- WebSocket clock authority — clock stays client-computed off `set_at + seconds_remaining` math; no server tick worker
- Animated transitions *between* preset payloads on the editable overlays in this plan — single fade-in on instance trigger only; full motion polish parity with Plan 16 stingers is Phase 3
- Mobile/touch admin UI — desktop admin only
- Pixel-perfect 1920×1080 reference replication — design language only

---

## 3. Architectural decisions (locked)

3.1. **Preset library is generic, keyed by `template_key`.** One table covers all editable templates; payload is `jsonb`, validated against the registry schema at write time and again at trigger time. No per-template preset table — keeps schema flat, mirrors `overlay_events.payload`.

3.2. **Multi-active is opt-in per template.** The existing `overlay_events` "single active per template per session" contract stays for the 26 non-lower-third templates. Lower-third moves to `overlay_active_instances` with an explicit `instance_slot int` (1=bottom, 2=mid, 3=top). Other templates may opt in later by writing to the same table.

3.3. **Match-clock is a server-config row, not a tick stream.** `match_clock` stores `mode + seconds_remaining + set_at`. Client computes `displaySeconds = mode==='countdown' ? max(0, seconds_remaining - (now - set_at)) : …`. Realtime broadcast fires only on edits (Start, Pause, Adjust). Avoids thousands of broadcast events per minute and survives client refresh.

3.4. **Single-row clock per session** (PK = `(stream_session_id)` UNIQUE, not the literal sentinel UUID — the brief's "default '00000000-…001'" is interpreted as one canonical clock row *per session*). This is the autonomous clarification: the literal sentinel makes no sense across concurrent sessions; the clock follows session ownership.

3.5. **Audit + RLS** match Plan 12 conventions: every new table gets `audit_row_change()` trigger, plus `deleted_at` soft-delete column. RLS denies anon, allows service role, and gates writes to admin role via `auth.uid()` lookup against `user_roles`.

3.6. **Permissions surface:** two new perms wired into `src/perms.ts` and seeded into `role_permissions`:
   - `overlay_presets.manage` — admin only — create/update/delete/restore presets
   - `match_clock.manage` — admin + production — set/start/pause/reset clock
   The existing `broadcast.manage` covers triggering instances.

3.7. **No incremental "patch" for editable score-bug.** Editing a triggered score-bug rewrites the row's `payload jsonb` in place, bumps `updated_at`, and re-broadcasts on `overlay.triggered` with the same `eventId`. The overlay page treats same-id retrigger as a payload swap (no re-mount, no fade-in flicker). This is a behavioural change to `useOverlayChannel` — see §5.4.

---

## 4. Data model (3 new tables)

### 4.1 `overlay_presets`

```sql
create table public.overlay_presets (
  id            uuid primary key default gen_random_uuid(),
  template_key  text not null,
  label         text not null,
  payload       jsonb not null,
  is_default    boolean not null default false,
  created_by    uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint overlay_presets_label_chk
    check (char_length(label) between 1 and 80),
  constraint overlay_presets_template_key_chk
    check (template_key in ( /* mirrors TEMPLATE_KEYS */ ))
);

create unique index overlay_presets_default_per_template_idx
  on public.overlay_presets (template_key)
  where is_default and deleted_at is null;

create index overlay_presets_template_idx
  on public.overlay_presets (template_key)
  where deleted_at is null;
```

Audit trigger attached. RLS: select all for authenticated, insert/update/delete gated on `overlay_presets.manage` via API layer (RLS denies non-service writes; API uses service role after `hasPerm` check).

### 4.2 `overlay_active_instances`

```sql
create table public.overlay_active_instances (
  id                  uuid primary key default gen_random_uuid(),
  stream_session_id   uuid not null references public.stream_sessions(id),
  template_key        text not null,
  instance_slot       int not null,
  payload             jsonb not null,
  triggered_at        timestamptz not null default now(),
  cleared_at          timestamptz,
  triggered_by        uuid references public.users(id),
  deleted_at          timestamptz,
  constraint overlay_active_instances_slot_chk
    check (instance_slot between 1 and 3),
  constraint overlay_active_instances_template_chk
    check (template_key in ('lower_third'))
);

create unique index overlay_active_instances_one_per_slot_idx
  on public.overlay_active_instances (stream_session_id, template_key, instance_slot)
  where cleared_at is null and deleted_at is null;

create index overlay_active_instances_session_idx
  on public.overlay_active_instances (stream_session_id)
  where cleared_at is null and deleted_at is null;
```

The CHECK starts allowlisting only `lower_third`. Future templates that opt in extend the CHECK in a follow-up migration. Audit trigger attached. RLS: gated on `broadcast.manage`.

### 4.3 `match_clock`

```sql
create table public.match_clock (
  stream_session_id   uuid primary key references public.stream_sessions(id),
  mode                text not null default 'stopped',
  seconds_remaining   int not null default 0,
  set_at              timestamptz not null default now(),
  set_by              uuid references public.users(id),
  label               text,
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint match_clock_mode_chk
    check (mode in ('countdown','countup','paused','stopped')),
  constraint match_clock_label_chk
    check (label is null or char_length(label) between 1 and 40),
  constraint match_clock_seconds_chk
    check (seconds_remaining between 0 and 359999)  -- 99h59m59s sanity cap
);
```

PK is the session id — exactly one canonical clock per session. Audit trigger attached. RLS: gated on `match_clock.manage`.

### 4.4 Realtime channel additions

Extend `REALTIME` in `server/overlays/registry.ts`:

```ts
export const REALTIME = {
  channel: (sessionId) => `overlay:${sessionId}`,
  eventTriggered: "overlay.triggered",
  eventCleared:   "overlay.cleared",
  eventSessionEnded: "session.ended",
  // Plan 37 additions
  eventInstanceTriggered: "instance.triggered",
  eventInstanceCleared:   "instance.cleared",
  eventClockChanged:      "clock.changed",
};
```

All three new events publish on the same `overlay:<sessionId>` channel — single subscription per overlay tab.

---

## 5. Server modules

### 5.1 `apps/web/src/server/overlays/presets.ts`

```
listPresets(sb, templateKey?)              → Preset[]
getPreset(sb, id)                          → Preset | null
createPreset(sb, { templateKey, label, payload, userId, isDefault? })  → { id }
updatePreset(sb, id, { label?, payload?, isDefault?, userId })          → void
deletePreset(sb, id, userId)               → void   // soft delete
restorePreset(sb, id, userId)              → void
loadPresetIntoEvent(sb, { presetId, sessionId, userId })  → { id }
```

`createPreset` and `updatePreset` Zod-validate payload against `TEMPLATE_REGISTRY[templateKey].schema` before write. `loadPresetIntoEvent` is a convenience that fetches preset → calls `triggerOverlay` (or `triggerInstance` for lower-third).

### 5.2 `apps/web/src/server/overlays/instances.ts`

```
listActiveInstances(sb, sessionId, templateKey)     → ActiveInstance[]
triggerInstance(sb, { sessionId, templateKey, instanceSlot, payload, userId }) → { id }
clearInstance(sb, instanceId, userId)               → void
clearAllInstances(sb, sessionId, templateKey, userId) → void
updateInstancePayload(sb, instanceId, payload, userId) → void
```

`triggerInstance` upserts on the partial unique index `(session, template_key, slot)` where active — replaces same-slot live row, sets previous row's `cleared_at`. Publishes `instance.triggered` with `{ instanceId, instanceSlot, templateKey, payload }`. `updateInstancePayload` mutates in place + republishes — no new id, no flicker.

### 5.3 `apps/web/src/server/overlays/match_clock.ts`

```
getClock(sb, sessionId)                     → ClockState | null
setClock(sb, sessionId, { mode, secondsRemaining, label?, userId })  → ClockState
startClock(sb, sessionId, userId)           → ClockState  // mode = countdown|countup based on prior
pauseClock(sb, sessionId, userId)           → ClockState  // freeze remaining at now
resumeClock(sb, sessionId, userId)          → ClockState  // recompute set_at = now
adjustClock(sb, sessionId, deltaSeconds, userId) → ClockState
resetClock(sb, sessionId, userId)           → ClockState
```

All mutators upsert the single row (PK = session id), publish `clock.changed` with full state, and rely on the audit trigger for change history.

`pauseClock` semantics: read current state, compute `displaySeconds` server-side, write `{ mode: 'paused', seconds_remaining: displaySeconds, set_at: now }`. `resumeClock` writes `{ mode: prior_running_mode, seconds_remaining: unchanged, set_at: now }`. Client-side compute always trusts `set_at + seconds_remaining`.

### 5.4 `useOverlayChannel` change

Extend the hook to accept an optional `expectMultiInstance: true` mode. In that mode it returns `OverlayInstance[]` keyed by `instanceSlot`, listening to `instance.triggered` / `instance.cleared`. Also: on a `triggered` event whose `eventId` matches the current single-instance state, payload is *replaced in place* — no animation re-mount. Add a `payloadVersion` counter that the page can use as a `key` to deliberately force re-mount on slot change but not on payload edit.

Add a sibling hook `useMatchClock(sessionId)` returning `{ mode, displaySeconds, label, lastSetAt }` with a 250 ms `requestAnimationFrame`-throttled tick.

---

## 6. Admin UI (per editable template panel)

The current `/admin/broadcast/[sessionId]/page.tsx` is a 27-card grid. Plan 37 splits the editable-template subset into a dedicated **rich panel** while leaving the other 23 cards as the existing schema-textarea form.

### 6.1 Editable template panel layout

```
┌────────────── EDITABLE TEMPLATE: lower_third ──────────────┐
│ ┌── Presets ──┐  ┌── Edit & Trigger ───────────────┐       │
│ │ + New       │  │ Slot:  ( • bottom  ○ mid  ○ top )│       │
│ │ ─────────── │  │ Player: [dropdown / search]      │       │
│ │ Caster · Rh │  │ Display: [Rhymez___________]    │       │
│ │ Caster · Ze │  │ Tag:    [@RHYMEZ_FC________]    │       │
│ │ Player · Ba │  │ Jersey: [10]                     │       │
│ │ Sponsor · X │  │ Stats:  [GP][W][D][L][PTS]       │       │
│ │ … (default) │  │ [Save preset] [Save as new] [⚡  │       │
│ └─────────────┘  │            Trigger to slot]      │       │
│                  └──────────────────────────────────┘       │
│ ┌── Active instances ───────────────────────────────────┐   │
│ │ slot 1 (bottom)  RHYMEZ  @RHYMEZ_FC  19s ago  [Edit][Clear]│
│ │ slot 2 (mid)     —                                          │
│ │ slot 3 (top)     SPONSOR · GAMEPRIDE  04m  [Edit][Clear]   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

Identical structural pattern for `score_bug`, `up_next_bug`, `layout_timer`, `layout_brb_basic`, `intro`, `outro`, `starting_soon_basic`, `stream_ended`, `layout_casters_chat`. Slot column hidden on single-instance templates.

### 6.2 Score-bug + up-next "Load from match" dropdown

Each panel exposes a "Pull from match flow" toggle. When ON:
- Score-bug: dropdown lists matches in the current session's match-day with `status in ('scheduled','in_progress')`. Selecting populates form from `match_results.home_score / away_score` (or zeros if scheduled). Toggle OFF reverts to free-form.
- Up-next: dropdown defaults to "next scheduled match by `match_order`". User can override pick. Toggle OFF reverts to free-form.

Auto-pull is a one-shot form fill — it does NOT keep the score-bug live-syncing to match-results. Producer must hit Trigger / Save Edit.

### 6.3 Match-clock panel

Single row of controls for the active session's clock:

```
[label: WARMUP    ] [mm:ss: 05:00] (•countdown ○countup)
[ ▶ Start ] [ ⏸ Pause ] [ ⟲ Reset ] [+30s] [-30s] [+1m] [-1m]
Current: 03:42 · paused · last edit 14s ago by zed
```

State shown live via `useMatchClock`.

### 6.4 Server actions

New `apps/web/src/app/admin/broadcast/actions.ts` additions:

- `createPresetAction`, `updatePresetAction`, `deletePresetAction`, `loadPresetAction`
- `triggerInstanceAction`, `clearInstanceAction`, `updateInstancePayloadAction`
- `setClockAction`, `startClockAction`, `pauseClockAction`, `resumeClockAction`, `adjustClockAction`, `resetClockAction`

All wrapped in `requirePermAsync(sb, ctx, …)` per the perm matrix in §3.6.

---

## 7. Overlay page rewrites

### 7.1 `/overlay/lower-third` — multi-instance, stacked

- Subscribes via `useOverlayChannel(sessionId, "lower_third", { expectMultiInstance: true })`.
- Renders an absolutely-positioned column on the left. Slots stack vertically at `bottom: 80px / 280px / 480px`. Slot 1 (bottom) enters first; Plan 16 `ENTER` motion token reused.
- Each slot card uses chrome from `17_lower_third.html`: 8 px pink accent bar, photo slot with green border, body panel with `clip-path: polygon(0 0, 100% 0, calc(100% - 24px) 100%, 0 100%)`, AghartiWide name, Quedora handle line. Brand tokens only.
- Old single-instance subscription path retained behind a feature flag for one release for backward compat, then removed.

### 7.2 `/overlay/layout-timer` — clock subscriber

- Replaces `expiresAt`-from-payload model with `useMatchClock(sessionId)`.
- Renders timer-chrome from `10_timer.html`: 2 px green border with pink accent corners, `clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px)`, AghartiWide tabular numerals, pulse dot in label.
- When `mode === 'countdown'` and remaining ≤ 5 s, swap to `--secondary` (`#fe036d`) + pulse animation per reference.
- Falls back gracefully if no clock row exists for the session (renders nothing).

### 7.3 `/overlay/score-bug` — same single-instance, in-place editable

- Hook flow unchanged (single instance per template), but page treats `eventId`-stable-but-payload-changed as a payload swap (no re-mount).
- Chrome from `18_score_bug.html`: green-bordered panel with header strip (live pulse dot + "LIVE" label), `grid-template-columns: 1fr auto 1fr` match row, circular green-bordered photos, AghartiWide score numbers with `tabular-nums`, pink VS divider.

### 7.4 `/overlay/up-next-bug` — same single-instance, dual-mode invisible to overlay

- Page only consumes the Zod-validated payload — auto-pull vs free-form is an admin-side concern, payload shape is identical.
- Chrome from `19_up_next.html`: `clip-path: polygon(20px 0, calc(100% - 20px) 0, 100% 100%, 0 100%)` trapezoid, left "UP NEXT · IN 4:30" kicker block with green-faint background, centre VS column with green bars top/bottom, right shield slot.
- "IN mm:ss" countdown computed client-side off `kickoffAt`; reuses `useMatchClock`-style local tick (no server math needed).

---

## 8. Reference design adoption (per editable template)

For each rewritten overlay page, this section locks the design vocabulary. Reference filenames live under `KNOWLEDGE/brand-assets/elements/`. Brand tokens enforced — no inline hex.

### 8.1 lower_third — `17_lower_third.html`
- **Color palette:** panel `--ink-1` strong (rgba(5,8,5,0.96) → token `--panel-strong`), accent `--secondary` (pink) for left bar + chevron + scanlight, body border `--primary` (green), name shadow `--secondary` 0.5α, handle text `--primary`.
- **Layout:** 8 px accent bar | 180 px photo slot with green outline | 520 px+ body with name + handle row + tag row, terminated by 24 px right slope (clip-path polygon).
- **Motion:** `slideInLeft` 0.7 s ease-out-quint with 0.3 s delay (Plan 16 `ENTER`); pink accent bar `scaleY` 0 → 1 with `transform-origin: bottom`; light sweep across body 1 s after enter.
- **Typography:** name AghartiWide 900 / 62 px / `letter-spacing: 1px` / uppercase / pink text-shadow 2 2 0; handle Quedora 500 / 14 px / `letter-spacing: 3px` / `--primary`.
- **Special effects:** scanlight body sweep, photo bottom-mask gradient (player melts into panel).

### 8.2 layout_timer — `10_timer.html`
- **Color palette:** `--panel-strong` background, `--primary` border + label, `--secondary` pulse dot + accent corners + expired state.
- **Layout:** corner-clipped box (16 px diagonal cuts top-left + bottom-right), 2 px pink stripe top-left + 2 px green stripe bottom-right, 280 px min-width, label row + giant value below.
- **Motion:** `slideInRight` 0.6 s `ENTER` on mount; expired state `pulse` 0.5 s infinite scaling 1 → 0.6 → 1 on the value.
- **Typography:** label Quedora 700 / 12 px / `letter-spacing: 5px` / `--primary`; value AghartiWide 900 / 78 px / `letter-spacing: 2px` / `tabular-nums` / green text-shadow 0 0 24 px.
- **Special effects:** outer glow `0 0 0 1px primary 0.3α` + inset glow `inset 0 0 40px primary 0.08α`.

### 8.3 score_bug — `18_score_bug.html`
- **Color palette:** `--panel-strong` panel, `--primary` border + header strip background (0.12α) + photo border + score glow, `--secondary` for VS divider + pulse dot, `--bone` for header session-index text.
- **Layout:** 520 px wide box, header strip (LIVE dot + label + index) + match row (`1fr auto 1fr` grid: left team, score group, right team mirrored), bottom-right 16 px clip-corner.
- **Motion:** `slideInRight` 0.6 s `ENTER` on mount; score number flip via Plan 16 `SCORE_FLIP` token on payload-update where `score` field changed.
- **Typography:** header Quedora 700 / 11 px / `letter-spacing: 4px` / `--primary`; team name AghartiWide 900 / 26 px / uppercase / `--white`; score AghartiWide 900 / 40 px / `tabular-nums` with green text-shadow.
- **Special effects:** 52 px circular photo with 2 px green border + green shadow; pink "cycling" border state when payload edited within 250 ms (visual feedback on producer mid-edit).

### 8.4 up_next_bug — `19_up_next.html`
- **Color palette:** `--panel-strong` panel, `--primary` border + kicker label + photo border + VS bars, `--secondary` chevron + VS text + name text-shadow, faint green panel-tint on the left "IN mm:ss" block (rgba 0.06α).
- **Layout:** trapezoid clip-path (20 px slope top-left + top-right), three columns: left kicker+countdown (220 px), centre match row (photos with VS column between), right shield slot (100 px) with faint green backdrop.
- **Motion:** `slideInUp` 0.7 s `ENTER` 0.3 s delay; countdown text recomputed each `requestAnimationFrame`.
- **Typography:** kicker Quedora 700 / 11 px / `letter-spacing: 4px` / `--primary`; countdown AghartiWide 900 / 40 px / `tabular-nums` / green shadow; name AghartiWide 900 / 38 px / pink text-shadow 1 1 0.
- **Special effects:** 76 px circular photos with green border + green glow; VS column with two glowing green bars top + bottom, pink VS letters between.

---

## 9. Brand + motion tokens

Reuse existing `apps/web/src/app/globals.css` brand tokens (`--primary` `#6bcd06`, `--secondary` `#fe036d`, `--ink-*`, `--chalk-*`, `--bone`). If `--panel`, `--panel-strong` are missing they get added in this plan as derived tokens (rgba over `--ink-1`).

Reuse `apps/web/src/lib/motion.ts` tokens. New tokens added only if a reference HTML demands a curve not in the current set. Candidates from the reading:
- `CORNER_IN` — 0.6 s `cubic-bezier(0.16, 1, 0.3, 1)` (corner reveal in starting-soon style HUD)
- `LIGHT_SWEEP` — 1.2 s ease-out for the body scanlight pass on lower-third
Add only if scope demands; otherwise reuse `ENTER`.

---

## 10. Tests (≥ 15 unit + 1 E2E)

### Unit (Vitest, mocked Supabase)

- `presets.test.ts` — createPreset Zod-rejects invalid payload (1), createPreset writes row + audit user id (2), updatePreset preserves byte-identical jsonb on no-op (3), unique-default-per-template enforced (4), deletePreset sets `deleted_at` not hard delete (5), loadPresetIntoEvent calls trigger with parsed payload (6).
- `instances.test.ts` — triggerInstance enforces slot 1-3 (7), triggerInstance to occupied slot clears prior row + replaces (8), updateInstancePayload republishes without new id (9), listActiveInstances filters cleared + soft-deleted (10).
- `match_clock.test.ts` — setClock writes mode/seconds/set_at atomically (11), pauseClock computes display from prior running state (12), resumeClock preserves seconds_remaining (13), adjustClock clamps to ≥0 (14), getClock returns null when no row (15).
- Reuse-of-tokens lint guard test: every rewritten overlay page sources colors from `var(--…)` only — `grep '#[0-9a-f]\{3,6\}'` zero matches (16).

### E2E (Playwright, real cloud DB)

- `apps/web/tests/e2e/overlay-presets-and-editable.spec.ts`:
  1. Admin creates two lower-third presets ("Caster · Rhymez", "Sponsor · X"), reloads page, confirms both listed.
  2. Triggers preset "Caster · Rhymez" to slot 1, "Sponsor · X" to slot 3 — overlay tab renders both stacked.
  3. Clears slot 1 — slot 3 still renders.
  4. Sets clock countdown 5:00 → Start → wait 2 s → assert overlay shows ≤ 4:58. Pause → assert overlay frozen → Adjust +30 s → Resume → assert resumed.
  5. Triggers score-bug from match-flow dropdown → edits home score in admin → assert overlay reflects new score within 1 s without re-mount (data-testid stays same React key).

---

## 11. Migrations

Three SQL files under `supabase/migrations/`:

1. `20260507000500_overlay_presets.sql` — table + indexes + audit trigger + RLS policy (admin via `app.current_user_id` lookup).
2. `20260507000510_overlay_active_instances.sql` — table + indexes + audit + RLS gated on `broadcast.manage`.
3. `20260507000520_match_clock.sql` — table + audit + RLS gated on `match_clock.manage`.
4. `20260507000530_plan37_perms_seed.sql` — `insert into role_permissions` for `overlay_presets.manage` + `match_clock.manage` (admin role; `match_clock.manage` also production).

Verification after `db:push`: `npx supabase db query "select tgname, tgrelid::regclass from pg_trigger where tgname = 'audit_row_change_trg' and tgrelid::regclass::text in ('public.overlay_presets','public.overlay_active_instances','public.match_clock')"` → 3 rows.

---

## 12. Numbered tasks (20)

**Group A — Migrations + perms (4)**

1. Write + apply `20260507000500_overlay_presets.sql` (table + audit + RLS); verify trigger attachment via `db query`.
2. Write + apply `20260507000510_overlay_active_instances.sql` with partial unique index on `(session, template_key, slot) where active`.
3. Write + apply `20260507000520_match_clock.sql` with `seconds_remaining` 0..359999 CHECK + mode CHECK.
4. Add `overlay_presets.manage` + `match_clock.manage` to `apps/web/src/perms.ts` constant map; write `20260507000530_plan37_perms_seed.sql`; smoke `requirePermAsync` against new perms.

**Group B — Server modules (4)**

5. Implement `server/overlays/presets.ts` (7 fns) + co-located unit tests (≥6).
6. Implement `server/overlays/instances.ts` (5 fns) + unit tests (≥4).
7. Implement `server/overlays/match_clock.ts` (7 fns) + unit tests (≥5).
8. Extend `server/overlays/registry.ts` `REALTIME` map with three new event names; extend `useOverlayChannel` with `expectMultiInstance` mode + add `useMatchClock` hook.

**Group C — Admin UI (4)**

9. Refactor `/admin/broadcast/[sessionId]/page.tsx` — split editable templates into rich `EditableTemplatePanel` component, leave other 23 in legacy textarea form.
10. Build `EditableTemplatePanel` (preset list + edit form + active-instances list + slot picker) — generic over template_key, pulls schema from registry to render the form.
11. Build "Load from match" dropdown for score-bug + up-next; new server fn `listMatchesForSession(sessionId)` reading `matches` joined to `match_days`.
12. Build `MatchClockPanel` (label/mm:ss inputs, Start/Pause/Resume/Reset + ±30s/±1m buttons) wired to clock actions; add `actions.ts` server-action exports for all clock + preset + instance verbs.

**Group D — Overlay page rewrites (4)**

13. Rewrite `/overlay/lower-third/page.tsx` — multi-instance stacked rendering, chrome from `17_lower_third.html`, brand tokens only, motion via `ENTER`.
14. Rewrite `/overlay/layout-timer/page.tsx` — switch to `useMatchClock`, chrome from `10_timer.html`, expired pulse on `--secondary`.
15. Rewrite `/overlay/score-bug/page.tsx` — chrome from `18_score_bug.html`, payload-swap-no-remount via stable React key, score flip via `SCORE_FLIP`.
16. Rewrite `/overlay/up-next-bug/page.tsx` — chrome from `19_up_next.html`, trapezoid clip-path, left countdown block, right shield slot.

**Group E — Reference design polish + tokens (2)**

17. Add `--panel` + `--panel-strong` tokens to `globals.css` if missing; audit-grep all four overlay rewrites for inline hex (must be zero).
18. Optional: extend `lib/motion.ts` with `CORNER_IN` + `LIGHT_SWEEP` if rewrites use them; otherwise document reuse of `ENTER`.

**Group F — Tests + verification (2)**

19. Author 15 unit tests across the three new server modules + token-lint guard.
20. Author E2E spec `overlay-presets-and-editable.spec.ts`; run `npm run test`, `npm run lint`, `npm run build`, `npm --workspace apps/web run e2e`, `npm run audit:smoke` — all green before claiming complete.

---

## 13. Acceptance criteria

The plan is complete when every §1 success criterion is demonstrated, every §12 task is checked, and:

- `npm run test` ≥ 100 unit tests green (85 existing + ≥15 new)
- `npm run e2e` ≥ 23 specs green (22 existing + ≥1 new)
- `npm run lint` clean
- `next build` clean, bundle ≤ 250 KB first-load JS for each editable overlay route
- `npm run audit:smoke` clean — three new tables emit audit rows on insert/update/delete
- Visual smoke on a live `/admin/broadcast/[id]` against cloud DB: producer can save a preset, trigger three lower-thirds, edit a clock mid-countdown, and edit a triggered score-bug without re-mount — observed by hand or scripted in the E2E

---

## 14. Risks

- **R1: Realtime payload-swap-no-remount logic is subtle.** If `useOverlayChannel` re-keys on payload change, score-bug will flicker on every edit. Mitigation: payload mutation publishes on a dedicated `instance.payload_updated` micro-event so the page can distinguish "new instance" from "same instance updated", and uses stable React keys.
- **R2: Multi-instance lower-third + Plan 16 single-instance lower-third polish co-existing.** Plan 16 may have shipped a single-instance polished lower-third. Mitigation: re-read Plan 16's lower-third Review log before starting Task 13; if Plan 16 polish exists, refactor it into a slot-aware variant rather than throwing it away.
- **R3: Clock drift between admin display and overlay display.** Both compute off `set_at + seconds_remaining` against `Date.now()`. Mitigation: server returns `set_at` as `timestamptz`; client trusts WAT-conversion via existing `formatWat` helper; ≤ 100 ms drift is acceptable for stream graphics.
- **R4: Preset payload schemas drift if registry changes.** Adding a required field to a template's Zod schema breaks every saved preset. Mitigation: presets re-validate at load time; failed validation surfaces in admin UI as "Schema mismatch — re-edit and re-save", not a hard error.
- **R5: Reference HTML inline-hex creep.** Easy to copy `#6bcd06` from the reference and paste into the overlay page. Mitigation: §12 task 17 grep guard + §10 unit test 16 `grep` zero-hex assertion.
- **R6: Per-session `match_clock` PK assumes ≤ 1 concurrent live session.** Phase 1A only runs one stream at a time so this is fine; if Phase 2 adds parallel sessions it still works (one row per session). Documented for visibility.

---

## 15. Out of scope (drop / defer)

- Visual regression (Percy / Chromatic) — Phase 3
- Producer-authored brand-new templates (template registry stays code-driven)
- Preset sharing / forking / version history
- Animated transitions *between* successive preset payloads on a single overlay (only initial enter motion in scope)
- Server-side clock tick worker (client-side compute only)
- Mobile producer UI
- Multi-instance for templates other than lower_third
- Pixel-perfect reference replication

---

## 16. Reference cross-walk (26 elements ↔ template_keys)

| File | template_key | Plan 37 in scope? | Design notes |
|---|---|---|---|
| `01_long_intro.html` | `stinger_intro` | no — Plan 16 polish stands | Shield drop + title build at 3 s, AghartiWide 180 px main, pink `4 4 0` text-shadow |
| `01_starting_soon.html` | `starting_soon_basic` | yes | Tactical HUD corners, 1400 px green glow + breathing 6 s, top-bar shield + GameEvo / Pro League marks. Edit-mode panel only — overlay stays on Plan 16 polish |
| `02_be_right_back.html` | `layout_brb_basic` | yes | Same atmospheric stack as starting-soon; bottom bar with countdown panel; producer-editable message |
| `02_stinger_normal.html` | `stinger_normal` | no | Plan 16 polish stands |
| `03_stinger_replay.html` | `stinger_replay` | no | Plan 16 polish stands |
| `03_stream_ended.html` | `stream_ended` | yes | Centred shield + "STREAM ENDED" headline + socials grid; producer-editable subtitle + socials |
| `04_stinger_goal.html` | `stinger_goal` | no | Plan 16 polish stands |
| `04b_stinger_miss.html` | (none in registry) | drop | Reference exists, registry has no `stinger_miss` — out of scope |
| `05_stinger_winner.html` | `stinger_winner` | no | Plan 16 polish stands |
| `08_brb_ad_timer.html` | `layout_brb_full` | partial — wait | Editable in spirit, but `layout_brb_full` carries `adVideoUrl` — keep on Plan 16 polish |
| `10_timer.html` | `layout_timer` | **yes — primary rewrite** | `match_clock`-driven; corner-clipped chrome; AghartiWide 78 px tabular numerals; expired state pulses pink |
| `11_animated_bg.html` | `layout_animated_bg` | no | Decorative; Plan 16 polish stands |
| `12a_caster_chat_solo.html` | `layout_casters_chat` | yes | Producer-editable chat list; reference has solo + duo variants — duo wins as default chrome |
| `12b_caster_chat_duo.html` | `layout_casters_chat` | yes | Same template, duo variant |
| `13_h2h_2.html` | `h2h_2` | no | Plan 16 polish stands |
| `14_h2h_3.html` | `h2h_3` | no | Plan 16 polish stands |
| `15_h2h_5.html` | `h2h_5` | no | Plan 16 polish stands |
| `16_leaderboard.html` | `leaderboard_animated` | no | Plan 16 polish stands |
| `17_lower_third.html` | `lower_third` | **yes — primary rewrite** | Multi-instance stacked; pink accent + photo slot + clip-path body + scanlight sweep; AghartiWide 62 px name |
| `18_score_bug.html` | `score_bug` | **yes — primary rewrite** | LIVE pulse-dot header + 1fr-auto-1fr match grid + circular photos + AghartiWide 40 px scores; pink "cycling" border on edit |
| `19_up_next.html` | `up_next_bug` | **yes — primary rewrite** | Trapezoid clip-path + left countdown block + centre VS bars + right shield slot |
| `20_match_scores.html` | `match_scores_day` | no | Plan 16 polish stands |
| `22_starting_ad_timer.html` | `starting_soon_timer` | no | Carries ad video; out of editable rich-panel scope |
| `24_top_scorers.html` | `top_scorers` | no | Plan 16 polish stands |
| `25_orgs.html` | `orgs_roster` | no | Plan 16 polish stands |
| `26_coaches.html` | `coach_intros` | no | Plan 16 polish stands |
| `27_penalties.html` | `player_penalties` | no | Plan 16 polish stands |

**Surprises from the reference HTMLs noted in the read:**

- The references encode rich JS behaviour (URL-param overrides, default rosters, shared atmospheric backgrounds). They are *animated mock-ups*, not data-bound components — useful for design vocabulary but not directly mountable.
- All references share an "atmospheric stack" (radial-gradient base + 120 px mask grid + diagonal repeating-linear stripes + SVG fractal noise + 1400 px breathing green glow + pink corner glow). The Plan 16 production overlays do NOT currently use this stack on the editable templates — adopting even partially (just the radial base) lifts visual density significantly. Recommend adding an opt-in `<AtmosphericStack intensity="low|medium|high" />` shared component, but defer the build to Phase 3 to keep this plan minimal.
- The references include `--gold` (`#f5c518`), `--bone` (`#e8f0dc`), `--silver` (`#c5c8ca`), `--bronze` (`#b8722a`) tokens not present in the current `globals.css`. Editable templates don't need them; flagged for future style-guide expansion.
- Reference uses `font-variant-numeric: tabular-nums` consistently on score / clock displays — current overlays use a `tabular` className that may or may not enforce this. Verify during Task 13/14/15.
- `27_penalties.html` and `25_orgs.html` rely on `--gold`/`--silver`/`--bronze` rank colouring — out of scope this plan but a clear Phase 3 win.

---

## 17. Review log

| Date | Reviewer | Verdict | Notes |
|---|---|---|---|
| 2026-04-22 | (pending) | — | Spec drafted, awaiting user approval before scaffolding tasks |
