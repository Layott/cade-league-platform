# Plan 16 — Amended: 27-template execution plan driven by HTML references

**Owner:** Spektakula
**Version:** 2.1 (amendment of `2026-04-21-plan-16-broadcast-visual-polish.md` v2.0)
**Date:** 2026-04-22
**Status:** Draft — amendment layer, to be merged back into the parent Plan 16 spec once approved
**Origin HEAD:** `ae694c0`
**Depends on:** Plan 12 (shipped), Plan 16 v2.0 registry/schemas/migrations (shipped), Plan 37 (shipped — editable overlay rewrites for lower-third / score-bug / up-next-bug / layout-timer)
**Reference bundle:** `KNOWLEDGE/brand-assets/elements/*.html` — 27 standalone reference files dropped by user 2026-04-22

---

## 0. What changed vs. Plan 16 v2.0

Plan 16 v2.0 already scaffolded:

- All 27 Zod schemas (`apps/web/src/server/overlays/schemas.ts`)
- All 27 registry entries (`apps/web/src/server/overlays/registry.ts`)
- All 27 `/overlay/<key>` page.tsx stubs (`apps/web/src/app/(overlay)/overlay/…`)
- Migration `20260505000003_plan16_overlay_template_types.sql` extending the CHECK + seeding 20 new rows
- Design-preview harness + style-guide

What's missing and is the point of this amendment:

1. The motion + chrome on each `/overlay/<key>/page.tsx` is a **functional stub**, not a reference-quality implementation. The user has now provided 27 reference HTML files that encode the exact production visual + animation.
2. One reference file — `04b_stinger_miss.html` — has **no matching registry entry** and is a scope expansion (miss stinger, sibling of goal stinger).
3. `12a_caster_chat_solo.html` + `12b_caster_chat_duo.html` both map to a single existing registry key `layout_casters_chat` — the schema needs a `variant: "solo" | "duo"` discriminator added.
4. The existing score-bug page in Plan 37 replaced the stub with Plan-37 chrome. The HTML `18_score_bug.html` should still drive **Plan 16's polish pass** (scanlight, clip-path, pulse-dot) but must not regress Plan 37's editable/load-from-match behaviour.

This amendment catalogs the HTML→route mapping, the per-template execution contract, and the execution ordering so the motion polish wave can proceed as parallel subtasks.

---

## 1. Mapping table (27 HTMLs → 27 routes, plus 1 scope expansion)

Legend:
- **Exists**: registry entry + route folder + page.tsx already present from Plan 16 v2.0 scaffold.
- **New**: needs a brand-new registry key, schema, route, seed row, CHECK constraint extension.
- All HTMLs use URL params for data binding (`URLSearchParams`); they have zero `<audio>` / `<video>` tags and no WebGL — sound comes from `useOverlaySound(soundSlot)`, not inline `<audio>` elements. All animation is CSS `@keyframes` (245 total across the bundle); framer-motion re-implementations should mirror timing + easing.
- Base64 images embedded in every file are the CADE + GameEvo + Pro-League **shield/logo art**, inlined so the HTML is a single-file drop. React port references `public/brand/logos/*.png` instead.
- No `localStorage` / `sessionStorage` usage anywhere — safe for server-rendered Next.js pages with `dynamic = "force-dynamic"`.

| HTML file                       | Registry key (proposed)      | Route slug                       | Status   | Schema (existing) / proposed changes                                    | Key animations to preserve                                                                                              | Sound? | External assets |
|---------------------------------|------------------------------|----------------------------------|----------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|--------|-----------------|
| `01_long_intro.html`            | `stinger_intro`              | `/overlay/stinger-intro`         | existing | `stingerIntroSchema` (no change)                                         | 10s full sequence: `li-bg` 10s linear, `li-grid` 10s linear, 3× pre-flash layers staggered, `shield-seq` ease-out, triple `burst-pulse` @ 2.0/2.15/2.3s, `title-seq` + `season-seq` + `cade-seq` + `tag-seq` each 10s, `rays-slow` 10s linear, `scan-twice` linear, `flash-final` climax | yes (`stinger-intro`) | logos (public/brand) |
| `02_stinger_normal.html`        | `stinger_normal`             | `/overlay/stinger-normal`        | existing | `stingerNormalSchema` (no change)                                        | 2s tempo: 5 keyframes — stripe wipe + logo thump + exit fade; no payload fields                                         | yes (`stinger-normal`) | shield logo |
| `03_stinger_replay.html`        | `stinger_replay`             | `/overlay/stinger-replay`        | existing | `stingerReplaySchema` (no change)                                        | 2s tempo: "REPLAY" title slam + strobe + pink→green hue shift, clip-path reveal                                         | yes (`stinger-replay`) | shield logo |
| `04_stinger_goal.html`          | `stinger_goal`               | `/overlay/stinger-goal`          | existing | `stingerGoalSchema` (no change)                                          | 2s tempo: "GOAL!" slam with `.bang` bounce, 8 horizontal stripes slide-in (every 40ms), burst rings                     | yes (`stinger-goal`) | shield logo, scorer photo (optional) |
| `04b_stinger_miss.html`         | **`stinger_miss`** *(NEW)*   | **`/overlay/stinger-miss`** *(NEW)* | **new** | **Create `stingerMissSchema = { scorerDisplayName?, scorerPhotoUrl?, soundSlot }`** (mirror `stingerGoalSchema` — swap title text + strike animation) | 2s tempo: `bg-show` 2s, `glow-breathe`, dual `mwipe`/`mwipe-r` wipes (cubic-bezier 0.65,0,0.35,1), `hub-in` ease-out, `.miss-title .strike` strike-through, `ml-left`/`ml-right` side lines, `reticle-in` reticle overlay | yes (**new slot: `stinger-miss`** — extend `soundSlotSchema`) | shield logo |
| `05_stinger_winner.html`        | `stinger_winner`             | `/overlay/stinger-winner`        | existing | `stingerWinnerSchema` (no change)                                        | 2s tempo: champion photo iris-in + "WINNER" title slam + confetti sweep + final-score flip                              | yes (`stinger-winner`) | winner photo |
| `01_starting_soon.html`         | `starting_soon_basic`        | `/overlay/starting-soon-basic`   | existing | `startingSoonBasicSchema` (no change)                                    | Looped ambient: grid-scroll, radial-pulse, subtitle fade-in-out loop, 14 @keyframes driving ambience                    | no     | brand poster |
| `22_starting_ad_timer.html`     | `starting_soon_timer`        | `/overlay/starting-soon-timer`   | existing | `startingSoonTimerSchema` (no change — `startsAt` + `adVideoUrl`)        | Countdown ring (client tick from `startsAt`), ad-slot fade rotations (sequence shares the `UP_NEXT` demo block), bottom marquee | yes (`tick-1s`) | ad mp4 / poster URL (payload) |
| `02_be_right_back.html`         | `layout_brb_basic`           | `/overlay/layout-brb-basic`      | existing | `layoutBrbBasicSchema` (no change)                                       | 11 @keyframes — ambient pulse, "BE RIGHT BACK" breathe, optional message crawl                                          | no     | shield |
| `08_brb_ad_timer.html`          | `layout_brb_full`            | `/overlay/layout-brb-full`       | existing | `layoutBrbFullSchema` (no change)                                        | Countdown ring from `resumeAt`, ad surface fade rotation, socials ticker slide                                          | yes (`tick-1s` optional) | ad video URL, social handles |
| `03_stream_ended.html`          | `stream_ended`               | `/overlay/stream-ended`          | existing | `streamEndedSchema` (no change)                                          | Outro: 16 @keyframes, logo reveal + socials crawl + "THANKS FOR WATCHING" slow fade                                     | no     | socials |
| `10_timer.html`                 | `layout_timer`               | `/overlay/layout-timer`          | existing (Plan 37 already rebuilt) | `layoutTimerSchema` (no change — Plan 37 live-edit flow applies)    | 6 @keyframes: tick pulse every 1s, final-3s red flash, position variants `tl/tr/bl/br/top/bottom`                       | yes (`tick-1s`, `timer-end`) | none |
| `11_animated_bg.html`           | `layout_animated_bg`         | `/overlay/layout-animated-bg`    | existing | `layoutAnimatedBgSchema` (no change — `intensity` field)                 | 7 @keyframes: grid-scroll + glow-orbs + scanline — pure ambience loop, GPU-friendly (`transform: translate3d`)           | no     | none |
| `12a_caster_chat_solo.html`     | `layout_casters_chat`        | `/overlay/layout-casters-chat?variant=solo` | existing | **Amend schema: add `variant: z.enum(["solo","duo"]).default("duo")`**; solo = 2 stacked mini-cams + chat column; duo = side-by-side. Chat + ticker payloads unchanged. | 26 @keyframes: caster-card slide-in, nameplate typewriter, chat-message stagger (top→bottom), ticker marquee (infinite), LIVE pulse | no | caster photos (optional) |
| `12b_caster_chat_duo.html`      | `layout_casters_chat`        | `/overlay/layout-casters-chat?variant=duo`  | existing | same (variant="duo" — two large cams side-by-side + chat right column)   | 26 @keyframes (same family as 12a, shifted geometry)                                                                     | no     | caster photos |
| `13_h2h_2.html`                 | `h2h_2`                      | `/overlay/h2h-2`                 | existing | `h2h2Schema` (no change — 2 players)                                     | 20 @keyframes: VS split-card — left player swipe-in-left, right swipe-in-right, center-VS pop, stats counter roll-up    | yes (`whoosh-long`) | player photos |
| `14_h2h_3.html`                 | `h2h_3`                      | `/overlay/h2h-3`                 | existing | `h2h3Schema` (no change — 3 players)                                     | 23 @keyframes: 3-up card layout, cascade enter + stats roll-up                                                           | yes (`whoosh-long`) | player photos |
| `15_h2h_5.html`                 | `h2h_5`                      | `/overlay/h2h-5`                 | existing | `h2h5Schema` (no change — 3–5 players)                                   | 20 @keyframes: 5-up card layout, stagger cascade enter                                                                   | yes (`whoosh-long`) | player photos |
| `16_leaderboard.html`           | `leaderboard_animated`       | `/overlay/leaderboard-animated`  | existing | `leaderboardAnimatedSchema` (no change)                                  | 20 @keyframes: rows slide-in from right staggered, "delta" chevron colour-flip (green up / pink down), top-3 crown glow | no     | player photos (optional) |
| `17_lower_third.html`           | `lower_third`                | `/overlay/lower-third`           | existing (Plan 37 rewrote) | `lowerThirdSchema` (no change; Plan 37 multi-instance unchanged) | 11 @keyframes: 8 px pink accent bar swipe, 180 px green-bordered photo iris, body scanlight sweep, clip-path slope      | yes (`whoosh-short`) | player/caster photo |
| `18_score_bug.html`             | `score_bug`                  | `/overlay/score-bug`             | existing (Plan 37 rewrote) | `scoreBugSchema` (no change — Plan 37 live-edit flow)             | 12 @keyframes: corner clip-path, accent stripe, pulse dot when LIVE, score digit flip on change                          | yes (goal-side only via `score-flip`) | team/player photos |
| `19_up_next.html`               | `up_next_bug`                | `/overlay/up-next-bug`           | existing (Plan 37 rewrote) | `upNextBugSchema` (no change — Plan 37 editable)                  | 12 @keyframes: slide-in-bottom + photos crossfade + "4:30 PM" flip                                                      | yes (`whoosh-short`) | player photos |
| `20_match_scores.html`          | `match_scores_day`           | `/overlay/match-scores-day`      | existing | `matchScoresDaySchema` (no change)                                        | 18 @keyframes: scroll-list, per-row status-pill colour map (scheduled=neutral / in_progress=primary pulse / completed=pink), score reveal on hover | no | team logos (optional) |
| `24_top_scorers.html`           | `top_scorers`                | `/overlay/top-scorers`           | existing | `topScorersSchema` (no change)                                            | 24 @keyframes: 2-1-3 podium arrangement (visually #2-#1-#3), crown-glow #1, gold/silver/bronze medal flips, remaining rows slide-in stagger | no | scorer photos |
| `25_orgs.html`                  | `orgs_roster`                | `/overlay/orgs-roster`           | existing | `orgsRosterSchema` (no change)                                            | 21 @keyframes: org-logo reveal + player chip cascade + banner marquee                                                    | yes (`whoosh-long`) | org logo, player photos |
| `26_coaches.html`               | `coach_intros`               | `/overlay/coach-intros`          | existing | `coachIntrosSchema` (no change)                                           | 22 @keyframes: coach hero photo iris + stat roll-up + mentored-player grid cascade                                       | yes (`whoosh-short`) | coach photo, player photos |
| `27_penalties.html`             | `player_penalties`           | `/overlay/player-penalties`      | existing | `playerPenaltiesSchema` (no change — 5 sanctionType enum values)          | 33 @keyframes (richest HTML): complete offence log — row-by-row slide-in + sanction-icon colour map + magnitude pulse   | no     | player photos |

**Total: 27 reference HTMLs → 27 existing routes + 1 new route (`stinger_miss`).**

### Existing but no reference HTML (from Plan 16 v2.0 scaffold)

Four routes have a registry entry but no reference HTML in this drop — they stay on the Plan 16 v2.0 motion stub:

- `/overlay/scorebar` — legacy Plan 12; score-bug (`18_score_bug.html`) is the modern replacement.
- `/overlay/standings-widget` — legacy Plan 12; `leaderboard-animated` is the modern replacement.
- `/overlay/player-card` — legacy Plan 12.
- `/overlay/punishment-ticker` — legacy Plan 12; `player-penalties` is the modern replacement.
- `/overlay/intro` + `/overlay/outro` — legacy Plan 12; `stinger-intro` + `stream-ended` are the modern replacements.
- `/overlay/layout-4pip`, `/overlay/layout-2pip` — Plan 16 group B layouts without a reference HTML in this drop; stay on the v2.0 stub (webcam-grid — no shipping motion work this wave).

These stay in the registry and remain working routes, but are NOT in scope for this amendment's polish pass. A later drop may add reference HTMLs for them.

---

## 2. Per-template execution contract

Only the **new** route + the **schema amendments** need explicit per-template execution work. The remaining 26 routes reuse their existing page.tsx + schema; their execution contract is "replace stub body with reference-derived framer-motion components; page path + schema path + seed row unchanged."

### 2.1. New route: `stinger_miss`

- **Page file:** `apps/web/src/app/(overlay)/overlay/stinger-miss/page.tsx`
- **Schema file:** sibling export in `apps/web/src/server/overlays/schemas.ts` — add:
  ```ts
  export const stingerMissSchema = z.object({
    scorerDisplayName: z.string().trim().min(1).max(80).optional(),
    scorerPhotoUrl: photoUrlSchema.optional(),
    soundSlot: soundSlotSchema, // will validate against extended enum
  });
  export type StingerMissPayload = z.infer<typeof stingerMissSchema>;
  ```
- **Registry:** extend `TEMPLATE_KEYS` with `"stinger_miss"` and add:
  ```ts
  stinger_miss: {
    schema: stingerMissSchema,
    route: "/overlay/stinger-miss",
    group: "stingers",
    label: "Miss Stinger (2s)",
    defaultSoundSlot: "stinger-miss",
  }
  ```
- **Sound-slot enum:** extend `soundSlotSchema` in `schemas.ts` with `"stinger-miss"`. Drop a `stinger-miss.mp3` asset into `apps/web/public/overlay/sounds/` and register it in `lib/overlay-sound.ts`.
- **Migration:** new file `supabase/migrations/20260508000010_plan16_stinger_miss.sql`:
  1. Drop + recreate `overlay_templates.template_type` CHECK extending with `'stinger_miss'`.
  2. Seed one row: `('stinger_miss','stinger_miss','Miss Stinger (2s)','/overlay/stinger-miss') on conflict (template_key) do nothing`.
  3. No new enum table — `overlay_events` uses the `template_key` TEXT FK, which is automatically valid once the seed row exists.
- **Admin trigger surface:** `/admin/broadcast/[sessionId]/page.tsx` already enumerates `TEMPLATE_REGISTRY` and auto-renders a trigger card per key with a schema-driven form (see Plan 16 v2.0 §12). No admin edits needed — new key surfaces automatically with fields `scorerDisplayName` (text input), `scorerPhotoUrl` (text / select from players-manifest), `soundSlot` (select from extended enum).

### 2.2. Schema amendment: `layout_casters_chat`

Add a `variant` discriminator to distinguish solo-cam-stack vs. duo-cam-sidebyside:

```ts
export const layoutCastersChatSchema = z.object({
  variant: z.enum(["solo", "duo"]).default("duo"),
  chat: z.array(...).max(50).default([]),
  ticker: z.string().trim().max(240).optional(),
  soundSlot: soundSlotSchema,
});
```

- No DB migration needed (jsonb payload already accepts the new field; Zod reads it at trigger time).
- Admin trigger form picks up the new enum automatically.
- Overlay page reads `variant` and branches the layout inside the same React component — both variants share the chat column + ticker + LIVE pulse.

### 2.3. No new `broadcast_events.event_type` values

**Correction to the brief:** there is no `broadcast_events.event_type` enum column in the schema. The relevant column is `public.overlay_templates.template_type` (a CHECK list) and `public.overlay_events.template_key` (a TEXT FK to the seeded template row). The realtime event names (`overlay.triggered` / `overlay.cleared` / `session.ended` / Plan 37's `instance.triggered` / `instance.cleared` / `clock.changed`) are **transport-layer constants** defined in `REALTIME` in `registry.ts`, not DB enum values. No new transport event names are required for this amendment.

---

## 3. Gaps + risks

**Data-binding vs. placeholder:**

- Every HTML uses `URLSearchParams` or a ship-as-demo-data block (e.g., `UP_NEXT = [{a:"FARUK",…}]`). In the React port, the placeholder demo data is thrown away — the page reads `useOverlayChannel(...)` or `useOverlayInstances(...)` + `schema.parse(payload)`. No HTML ships with real DB queries; every demo is static + hard-coded.
- Leaderboard-style HTMLs (`16_leaderboard`, `27_penalties`, `24_top_scorers`, `h2h` cards) share a common demo `ROSTER` + derive `LEADERBOARD` / `byPens` / `byGoals` client-side via `sort()`. In production this shifts to `server/overlays/autofill.ts` builders that query the DB; the overlay page still just takes `rows` / `players` from the payload.
- Timer + starting-soon-timer HTMLs use a 1-second `setInterval` tick bound to `seconds` URL param. Payload uses `expiresAt` / `startsAt` ISO-datetime strings (per schemas); overlay page derives display seconds client-side from `now - startsAt`. Plan 37 established this pattern for match-clock.
- Lower-third HTML reads `?title=CASTER&org=GAMEVERSE` — these fields are **not in the current schema** (only `displayName`, `gamerTag`, `jerseyNumber`, `photoUrl`, `stats`). The reference HTML suggests extending with `title?: string`, `org?: string`. **Deferred**: Plan 37 already shipped the lower-third polish without these fields; adding them is a future follow-up and out of scope for this amendment.
- `27_penalties.html` reads `ROSTER` with a `pens` numeric column; schema uses `count` + `sanctionType` — reference aligns fine, no change.
- `11_animated_bg.html` uses `intensity` baked into class names; payload already has `intensity: "low"|"medium"|"high"` — straight port.

**Browser-only API risks:**

- Zero WebGL, zero `getContext('webgl')`, zero `three.js` — no risk.
- Zero `<video>` tags for effect overlays — `starting-soon-timer` + `layout-brb-full` take an `adVideoUrl` via payload and embed `<video autoplay muted loop playsinline>` client-side. `muted` is mandatory for Chrome autoplay; already the pattern in the v2.0 stubs.
- Zero `localStorage` / `sessionStorage` — overlay pages are pure-render from URL + realtime.
- Zero `new Worker(…)`, zero `window.open` — no cross-window breakage.
- Custom fonts (Agharti, Quedora) referenced by class name only; base64-inlined in the HTML but loaded via `next/font/local` in the React port (per Plan 16 v2.0 §4). No FOUT risk if `display: "swap"` is set; the enter animations can wait for `document.fonts.ready` if needed.

**Route collisions with Plan 37:**

- Plan 37 rewrote four overlays in place: `/overlay/lower-third`, `/overlay/score-bug`, `/overlay/up-next-bug`, `/overlay/layout-timer`. The motion polish pass from the HTMLs `17`, `18`, `19`, `10` **must not regress** the Plan 37 contract: multi-instance lower-third, same-eventId payload swap for score-bug without re-mount, `match_clock` realtime edit for timer, "Load from match" dropdown for up-next. Motion polish layer-on-top strategy:
  - `17_lower_third.html` chrome (pink accent bar, photo slot, scanlight, slope clip-path) — already adopted by Plan 37; this amendment confirms the HTML as the canonical reference.
  - `18_score_bug.html` chrome — adopted by Plan 37; re-verify pulse-dot + digit-flip timings match the reference.
  - `19_up_next.html` chrome — adopted by Plan 37.
  - `10_timer.html` chrome — adopted by Plan 37.
  - **No route slugs collide**; the four Plan 37 routes are the intended destinations for the four HTMLs.

**Bundle-size risk:**

- Each polished overlay adds framer-motion animation descriptors; Plan 16 v2.0 set a ≤ 250 KB first-load JS budget per overlay route. Reference HTMLs with 20+ @keyframes (`27_penalties`=33, `12a/12b_caster_chat`=26 each, `24_top_scorers`=24, `25_orgs`=21) are the highest risk — measure after port via `next build` output and trim low-impact decorative keyframes if budget trips.

**Asset ingestion:**

- 101 `data:image/...` base64 blobs across the bundle are the CADE/GameEvo/Pro-League shields + player-photo placeholder rectangles. React port references `public/brand/logos/*.png` already imported in Plan 16 v2.0. No new file imports required.
- New sound asset: `stinger-miss.mp3` needs to be sourced + dropped into `public/overlay/sounds/`. Until then the slot validates + renders silent.

---

## 4. Execution plan (ordering + parallelism)

Wave structure minimises merge conflicts. Three waves, each internally parallel.

### Wave A — no-data stingers + full-screen states (parallel × 7)

Each is a self-contained visual package with zero data wiring to DB. Safe to run as parallel subagents because each touches a separate `page.tsx` file.

Subtasks (can all run concurrently):

1. `stinger_intro` ← `01_long_intro.html` (10s — largest stinger; budget watcher)
2. `stinger_normal` ← `02_stinger_normal.html`
3. `stinger_replay` ← `03_stinger_replay.html`
4. `stinger_goal` ← `04_stinger_goal.html`
5. **`stinger_miss` ← `04b_stinger_miss.html` (new registry entry + schema + migration — sole sequential prerequisite before a parallel slot)**
6. `stinger_winner` ← `05_stinger_winner.html`
7. `starting_soon_basic` ← `01_starting_soon.html`
8. `starting_soon_timer` ← `22_starting_ad_timer.html`
9. `stream_ended` ← `03_stream_ended.html`
10. `layout_brb_basic` ← `02_be_right_back.html`
11. `layout_brb_full` ← `08_brb_ad_timer.html`
12. `layout_timer` ← `10_timer.html` (verify no Plan 37 regression)
13. `layout_animated_bg` ← `11_animated_bg.html`

Wave-A-exit gate: `npm run test`, `npm run lint`, `next build`, hit each route with `?preview=1`, verify console clean + motion renders.

### Wave B — data-bound single-shot surfaces (parallel × 6)

Each reads a payload but does not need "Load from match" or multi-instance orchestration. Parallel-safe.

1. `lower_third` ← `17_lower_third.html` (verify Plan 37 multi-instance preserved)
2. `score_bug` ← `18_score_bug.html` (verify Plan 37 live-edit preserved)
3. `up_next_bug` ← `19_up_next.html` (verify Plan 37 editable preserved)
4. `leaderboard_animated` ← `16_leaderboard.html`
5. `match_scores_day` ← `20_match_scores.html`
6. `player_penalties` ← `27_penalties.html` (highest @keyframes count — budget watcher)

Wave-B-exit gate: add `server/overlays/autofill.ts` builders for any new payloads; run unit tests against builders; E2E smoke on `/overlay/design-preview` for all six cards.

### Wave C — composite / layout-heavy (parallel × 5)

Longest per-template runtime; keep parallel but budget per-agent.

1. `h2h_2` ← `13_h2h_2.html`
2. `h2h_3` ← `14_h2h_3.html`
3. `h2h_5` ← `15_h2h_5.html`
4. `top_scorers` ← `24_top_scorers.html` (2-1-3 podium layout)
5. `orgs_roster` ← `25_orgs.html`
6. `coach_intros` ← `26_coaches.html`
7. `layout_casters_chat` ← `12a_caster_chat_solo.html` + `12b_caster_chat_duo.html` (two variants, one component — schema amendment up-front prerequisite)

Wave-C-exit gate: full Plan 16 v2.0 §19 Review-log table populated with 27 APPROVED rows + git sha + bundle-size reading per row. Verify `/overlay/design-preview` grid renders all 27 cards with animation loops.

### Recommended sequencing

1. **Prerequisite (serial, single agent):** schema + registry + migration amendments — `stinger_miss`, `layout_casters_chat.variant`, `soundSlot` extension. Ship as a single commit so all wave-A/B/C agents rebase off a clean schema module. `npm run test` + `npm run build` green before launching waves.
2. **Wave A** (13 subagents parallel).
3. **Wave B** (6 subagents parallel, pending wave-A gate).
4. **Wave C** (7 subagents parallel, pending wave-B gate).

---

## 5. Test plan

Per-route verification checklist — every agent runs this before claiming their subtask complete:

1. **Route smoke:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:3030/overlay/<slug>?session=test` returns 200. Gated behind an active dev server on port 3030 (owned by a separate process per task rules — confirm with user before starting).
2. **Preview render:** `curl http://localhost:3030/overlay/<slug>?preview=1` and confirm HTML body contains the debug HUD emitted by `?preview=1` — `template=<key> ver=<n> sound=<slot|null>`.
3. **Playwright smoke** (contributes to the single `overlay-presets-and-editable.spec.ts` Plan-37 spec OR new `plan-16-amended.spec.ts` if the amendment ships its own spec): navigate `/overlay/design-preview`, assert the card for each key is visible + animated (scroll into view, wait 1.5 s, assert DOM count changed at least once → confirms animation running).
4. **Visual diff against HTML (manual):** open reference HTML side-by-side with `/overlay/<slug>?preview=1` in a browser. Diff motion cadence + colour + type ramp. Capture screenshots into `docs/superpowers/specs/plan-16-amended/screenshots/` for the review-log attachment.
5. **Console-error scan:** open DevTools, reload, expect zero `error` / `warning` entries. Pay specific attention to `next/font` FOUT warnings and hydration-mismatch warnings (pass `suppressHydrationWarning` only on nodes with a proven dynamic-time cause).
6. **Bundle size:** after each wave, grep `next build` output for the `/overlay/<slug>` line and confirm first-load JS ≤ 250 KB; if exceeded, drop decorative keyframes until under budget.
7. **Sound slot resolver:** trigger via admin `/admin/broadcast/[sessionId]` with `soundSlot` set, confirm `<audio>` element inserted by `useOverlaySound` fires at the right phase (enter vs. idle). Test once per stinger + once per whoosh-using surface.
8. **Unit tests:** extend `schemas.test.ts` with a test asserting `stingerMissSchema.parse({})` fails (scorer optional but object shape required), `layoutCastersChatSchema.parse({ variant: "solo", chat: [] })` passes. Extend `registry.test.ts` with a parity assertion that `TEMPLATE_KEYS` still mirrors the DB CHECK (28 entries including `stinger_miss`).

Spec-wide exit gate (after Wave C lands):

- `npm run test` green; new unit tests ≥ 3 (schema `stinger_miss`, schema `layout_casters_chat` variant, registry parity).
- `npm run lint` clean.
- `next build` clean, every overlay route ≤ 250 KB first-load.
- `npm --workspace apps/web run e2e` green.
- `npx supabase db query "select count(*) from overlay_templates"` returns 28 (27 existing + `stinger_miss`).
- `/overlay/design-preview` grid renders 28 cards; every card has a filled Review-log row.

---

## 6. Open questions (deferred — do NOT block Wave A)

1. Extend `lowerThirdSchema` with optional `title?` + `org?` fields to match `17_lower_third.html` URL params? (Plan 37 shipped without them.) → separate follow-up.
2. Source the `stinger-miss.mp3` asset. Until supplied, `stinger_miss` ships with `defaultSoundSlot: null` and the sound-slot registry gets an unused placeholder. → user to provide.
3. Do we want a `stinger_miss` trigger wired directly into the match workflow (e.g., fired by the referee scorekeeper when a penalty misses)? → Plan 40 candidate; out of scope here.
4. `layout_casters_chat` chat column — should chat messages stream live from Twitch/YouTube chat API, or remain producer-pushed via admin UI? Payload today is a snapshot array, not a live stream. → defer; snapshot is fine for the motion-polish wave.

---

## 7. Deliverables checklist

- [ ] Prerequisite commit: schema + registry + migration amendments (1 agent, serial).
- [ ] Wave A: 13 overlay polish PRs / commits (parallel agents).
- [ ] Wave B: 6 overlay polish commits (parallel agents; Plan 37 non-regression verified).
- [ ] Wave C: 7 overlay polish commits (parallel agents).
- [ ] Plan 16 v2.0 §19 Review-log filled with 28 APPROVED rows.
- [ ] `/overlay/design-preview` renders 28 cards.
- [ ] `npm run test`, `npm run lint`, `next build`, `npm --workspace apps/web run e2e` all green.
- [ ] Amendment merged back into `2026-04-21-plan-16-broadcast-visual-polish.md` v2.1 by the spec maintainer.
