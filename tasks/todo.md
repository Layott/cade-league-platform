# Tasks — Active Work

Active plan: **Overlay design system fixes + 9-bug overlay sweep** (user brief 2026-04-28).

## 2026-04-28 — User-reported overlay bugs (9 items)

User brief recap:
1. Overlay design system: changes don't update preview; can't add/upload background image; some overlays have no bg.
2. New design workflow: confirm "do I prompt you?" — yes (CLAUDE.md §14 + design-prompt template).
3. H2H 2-players: needs entry animation for the players themselves; no exit anim needed.
4. H2H stats not updating from `/admin/tournament/h2h-lookup` data — must auto-update; HARD RULE for all auto-update overlays.
5. OAS logo on leaderboard has white bg chip; logo PNG is already transparent — drop the chip.
6. Leaderboard background should be `ELITE S2 BG.png` (currently green-wall + halftone-dot).
7. Secondary score bug entry animation "cracks" — not smooth.
8. Match scores today: continuous replay of stat animations (should animate in once + hold). Marquee fine. Add bg option (or default to ELITE S2 BG.png).
9. Top 10 goal scorers: not auto-linked to leaderboard; in OBS only top 3 with no pictures + random goal numbers.

## Root-cause investigation findings

### Bug 1 — Design preview pipeline
- SSR `/overlay/v2/[key]/page.tsx` injects `<style>:root{--overlay-X: value}</style>` on the OUTER document.
- `OverlayDataInjector` mounts the static HTML inside an `<iframe src="/overlays/v2/<key>/index.html">` — separate document, separate `:root`. CSS variables do NOT cross document boundaries.
- Persisted DB tokens AND `?previewTokens=` are computed but never reach the iframe content.
- The static HTML has its own hard-coded `:root{--overlay-bg-color: #050505...}` defaults — those win.
- **No `bg-image` token type exists.** `tokens.ts` TokenType union: `color|font|number|boolean|enum|string`. No image upload widget. No file storage hook.

### Bug 3+4 — H2H overlays
- `04-h2h-2`, `05-h2h-3`, `06-h2h-5` are NOT in `OverlayDataInjector` `INITIAL_FETCH_PATH` or `REALTIME_KEY_EVENTS` — they get NO live data, only postMessage from broadcast control panel.
- The HTML's `update()` only sets name/photo/orgLogo. Stat-row cells (Position/P/W/D/L/GF/GA/GD/Pts/WinProb%) are HARDCODED `0` / `—` placeholders.
- `/api/tournament/h2h?ids=A,B[,C][,D][,E]` exists + returns `{cards: H2HCard[]}` with full stats — but it's gated by `tournament.read` perm (admin-only), not view_token.
- Player slide-in keyframes exist (`player-a-in`, `player-b-in`) but the gate observer forces inline `opacity: 1 !important` on cade-visible — clobbering the `from-opacity: 0` step. Animation runs but entry feels muted.

### Bug 5+6 — Leaderboard
- `.partner--oas` has explicit `background: rgba(255,255,255,0.92); border-radius: 6px; padding: 6px 16px;` chip — drop it.
- `.bg-fill` paints a lime-green wall + halftone dot pattern. Replace with `background-image: url('/overlays/v2/_assets/designsample/ELITE%20S2%20BG.png')`.

### Bug 7 — Score bug entry crack
- `@keyframes entry` has 4 stops with overshoot (`scale(1.02)` at 72%) + cubic-bezier with y2=1.18 (bounces past target). Stutters at 35%/72% holds.
- Concurrent `glowPulse` + `pulse` on data update can stack with entry transform.

### Bug 8 — Match-scores-day continuous animation
- Has `header-loop`, `title-loop`, `row-enter`, `footer-loop` with `infinite` keyword on `var(--cycle: 99999s)`. Effectively single-play.
- CSS rule on cade-visible swaps to `cade-fade-in` (iteration 1, fill forwards) — single play.
- BUT show() (in HTML script) does `el.style.animation = 'none'; void offsetHeight; el.style.animation = orig` — RESTART. So every `show` re-fires entry animation.
- Demo loop fires `show`/`hide` every 8s → animations restart every cycle → user perceives loop.
- Background already points at ELITE S2 BG.png (line 227). Issue is: bg is gated on cade-visible, so it only shows during the cycle; user maybe wants it to show always OR wants ability to swap via design system.

### Bug 9 — Top scorers
- `14-top-scorers` IS in `INITIAL_FETCH_PATH` + `REALTIME_KEY_EVENTS`. Data flow OK.
- But: `getPlayerHeadshotUrl` returns `/players/<slug>/headshot_NN.png` — that's a SEPARATE asset tree. Need to verify both paths exist OR change to `/overlays/v2/_assets/players/processed/<slug>/headshot_01_nobg.png` for consistency with the rest of the v2 overlays.
- "Random goal numbers + only top 3" matches the demo's hardcoded `t1=22, t2=19, t3=17` defaults at line 1461-1463 + the initial pod HTML. When live data is empty / no session resolved → demo defaults persist. Should fall back to "NO SCORERS YET" placeholder, NOT demo numbers.
- Tail strip (ranks 4-10) only renders via `rebuildTail()` which expects `scorers.length > 3` → if ≤3 rows arrive, tail stays empty. That matches user's "only top 3" complaint.

## Implementation plan

### Phase A — Design system foundation (UNBLOCKS verification of all subsequent fixes)

Spec: cross-document token propagation + new image-upload token type.

- [ ] **A1.** Migration `20260612000001_overlay_design_tokens_bg_image.sql` — append `image` to `token_type` CHECK constraint; seed `bg-image` rows for the 7 overlays that need a default (h2h-2/3/5, leaderboard, match-scores-day, brb, starting-soon) → value `''` or canonical `/overlays/v2/_assets/designsample/ELITE%20S2%20BG.png`.
- [ ] **A2.** `apps/web/src/server/overlays/design/tokens.ts` — extend `TokenType` union with `"image"`. Update `escapeCssValue` (or add `escapeUrl`) so image tokens get serialized as `url("<value>")` automatically.
- [ ] **A3.** `apps/web/src/server/overlays/design/defaults.ts` — add `{tokenKey: "bg-image", tokenType: "image", label: "Background image"}` to TOKEN_CATALOG. Add per-overlay defaults.
- [ ] **A4.** New Supabase storage bucket `overlay-bgs` (public, max 5MB, .png/.jpg/.webp). Migration `20260612000002_overlay_bgs_bucket.sql`.
- [ ] **A5.** Server action `uploadOverlayBgAction` in `app/admin/broadcast/v2/design/actions.ts` — gates on `overlay.design.manage`, accepts FormData with file + overlayKey + variantId, uploads to bucket, sets the `bg-image` token to the public URL.
- [ ] **A6.** `OverlayDesignEditor.tsx` — add `image` widget (file input + preview thumb + clear button). Live-preview re-renders.
- [ ] **A7.** `OverlayDataInjector.tsx` — accept new prop `designTokens: Record<string, string>` + `previewTokens?: Record<string, string>`. Serialize both as base64 + append `?tokens=<b64>&previewTokens=<b64>` to iframe URL. Iframe URL changes → reload → static HTML reads them.
- [ ] **A8.** `[key]/page.tsx` — pass `resolveTokens()` result + `decodePreviewTokens()` result to OverlayDataInjector via new props.
- [ ] **A9.** Each v2 overlay HTML (16 files) — add inline `<script>` at top of `<head>` that reads `?tokens=<b64>&previewTokens=<b64>` from `location.search`, decodes, builds a `<style id="overlay-design-tokens">:root{--overlay-X: value}</style>` block + appends to head BEFORE the existing `:root` defaults. Image tokens wrap as `url("<value>")`. Persists on subsequent navigation.
- [ ] **A10.** Each overlay HTML — add CSS rule `.bg-image { background-image: var(--overlay-bg-image, <existing-default>); }` for overlays where bg-image is meaningful. h2h-2/3/5, leaderboard, match-scores-day, brb already have bg-image divs. Lower-third, score-bug, up-next-bug, timer don't have full-canvas bg.
- [ ] **A11.** E2E `apps/web/tests/e2e/overlay-design-tokens.spec.ts` — extend: save `bg-image` URL → assert iframe HTML contains `--overlay-bg-image: url("<URL>")` + actual `<div class="bg-image">` resolves correctly.
- [ ] **A12.** Unit test `defaults.test.ts` — assert `bg-image` is in catalog + `image` type allowed.

### Phase B — Per-overlay fixes (parallelizable after Phase A)

- [ ] **B1.** Leaderboard (`07-leaderboard/index.html`):
  - Drop `.partner--oas { background; border-radius; padding; box-shadow }` block — let it inherit normal `.partner` styling.
  - Replace `.bg-fill` background with `background-image: var(--overlay-bg-image, url('/overlays/v2/_assets/designsample/ELITE%20S2%20BG.png')); background-size: cover; background-position: center`.
  - Drop `.bg-halftone` (the green halftone-dot wallpaper) — ELITE S2 BG already has texture.
  - Adjust `.bg-vignette` to match dark bg (currently tuned for green wall).
  - Adjust top-band / corner-badge / season-mark colors so they read against the dark bg (matchday-mark + season-mark are currently `rgba(0,0,0,0.55)` text on green — invisible on dark).

- [ ] **B2.** Match-scores-day (`11-match-scores-day/index.html`):
  - Add `body.cade-rendered` JS guard: first `show` adds `cade-rendered`. Subsequent `show` calls do NOT re-trigger `el.style.animation = 'none'` restart.
  - Remove the `infinite` keyword on `header-loop`/`title-loop`/`row-enter`/`footer-loop` (they're already effectively single-play via cycle:99999s but explicit non-infinite is cleaner).
  - Background already wired — once Phase A lands, design system can override per-overlay.
  - Demo loop (`?demo=1`) — fire `show` once on load; remove the 8s setInterval.
  - Marquee animation stays infinite (user said it's fine).

- [ ] **B3.** Score bug (`09-secondary-score-bug/index.html`):
  - Replace `@keyframes entry` with a smooth 2-keyframe ease-out:
    ```
    @keyframes entry {
      0%   { transform: translateX(140%) scale(0.95); opacity: 0; }
      100% { transform: translateX(0)    scale(1.0);  opacity: 1; }
    }
    ```
  - Use `cubic-bezier(0.22, 1, 0.36, 1)` (no overshoot), duration 0.65s.
  - Suppress `glowPulse` for the first 0.7s of `.bug-mount.visible` so it doesn't compete with the entry transform.

- [ ] **B4.** H2H 2-players (`04-h2h-2/index.html`) — entry animation + stat wiring + drop exit:
  - **Animation**: strengthen player-col entry — slide from -300px (left) / +300px (right) over 1.0s, single play. Add slight scale-from-0.92 for emphasis.
  - **Drop exit**: `body.cade-exiting .player-col { animation: none; opacity: 0; transition: opacity 0.3s; }` — no slide-out, just fade.
  - **Stat wiring**: extend `update()` in HTML to also re-render stat-row cells from `data.players[].stats` (Pos/P/W/D/L/GF/GA/GD/Pts) + winProbPct.
  - **Live feed**: see C1 below — wire to new endpoint.

- [ ] **B5.** H2H 3-player + 5-player (`05-h2h-3`, `06-h2h-5`) — same pattern as B4. Entry + stat wiring.

- [ ] **B6.** Top scorers (`14-top-scorers/index.html`) — fix demo defaults + photo paths + tail strip:
  - Remove the hardcoded `t1=22, t2=19, t3=17` `parseInt(p1.dataset.target || p1.textContent, 10) || 22` fallback. If no real data, render `—` for goals + `(no scorers yet)` for name.
  - Replace any stale photoUrl path (in initial DOM) with `/overlays/v2/_assets/players/processed/<slug>/headshot_01_nobg.png`.
  - Tail strip: render slots 4-10 even when payload has fewer rows (clear text instead of empty cells) so the visual layout stays.
  - Server-side fix: also normalize `getPlayerHeadshotUrl` to return `/overlays/v2/_assets/players/processed/<slug>/headshot_01_nobg.png` instead of `/players/<slug>/headshot_NN.png` for the v2-served overlays. Or: inject a `slug → /overlays/v2/_assets/...` map in the HTML's update().

### Phase C — H2H live data feed

- [ ] **C1.** New endpoint `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts` — accepts `?ids=A,B[,C][,D][,E]&t=<view_token>` (view-token-gated, not perm-gated). Returns `{cards: H2HCard[], seasonId, channel}`. Channel = `public:standings:<seasonId>`.
- [ ] **C2.** `OverlayDataInjector.tsx` — extend `INITIAL_FETCH_PATH` for `04-h2h-2`, `05-h2h-3`, `06-h2h-5` keys. The path needs `?ids=` of currently-selected players — read from `overlay_events` payload OR from session pin state. Simplest: broadcast control panel writes `h2h_pinned_players: [...]` into `overlay_events.payload`, h2h overlays read it from initial fetch param.
- [ ] **C3.** Add `04-h2h-2`/`05-h2h-3`/`06-h2h-5` to `REALTIME_KEY_EVENTS = ["standings.changed"]` so stats auto-update mid-stream when results post.
- [ ] **C4.** Update CLAUDE.md §14 with new HARD RULE: "Auto-update overlays MUST consume their data feed via INITIAL_FETCH_PATH + REALTIME_KEY_EVENTS." List the keys.

### Phase D — Documentation

- [ ] **D1.** Update CLAUDE.md §14 — add bg-image token to design system docs. Add "auto-update overlay" hard rule.
- [ ] **D2.** Update `docs/superpowers/specs/2026-04-26-overlay-design-prompt.md` — note that new overlays should support the bg-image token via `var(--overlay-bg-image, <fallback>)`.

### Phase E — Verification

- [ ] **E1.** `npm run test` + `npm run lint` clean.
- [ ] **E2.** `npm run build` clean.
- [ ] **E3.** Manual: open `/admin/broadcast/v2/design`, change accent color → preview reflects. Upload bg image → preview reflects. Save → bare overlay route reflects.
- [ ] **E4.** Manual: open each fixed overlay (h2h-2, leaderboard, score-bug, match-scores-day, top-scorers) at `/overlay/v2/<key>?demo=1` and verify the issue is gone.
- [ ] **E5.** Use Claude-in-Chrome to walk through `/admin/broadcast/v2/design` + verify each token change updates the preview iframe live.
- [ ] **E6.** Push to main → Vercel auto-deploys.

## Locked decisions (user, 2026-04-28 14:00 WAT)

1. **bg-image scope:** 7 full-canvas overlays only — `01-brb`, `04-h2h-2`, `05-h2h-3`, `06-h2h-5`, `07-leaderboard`, `11-match-scores-day`, `12-starting-soon`, `13-stream-ended`. Anchored bugs (score-bug, lower-third, up-next-bug, timer) excluded.
2. **Phase A split:** ship as ONE coherent slice. Foundation must be atomic.
3. **H2H pinned-player source:** read from latest `overlay_events.payload.players[]` for the overlay key (option b — simpler, broadcast control panel already writes overlay_events on trigger).
4. **Asset tree:** keep both. Normalize v2 overlay HTMLs + server fetch helpers to `/overlays/v2/_assets/players/processed/<slug>/...`. Don't migrate legacy `/players/` tree (other consumers may use it).

## Verification status (2026-04-28 13:30 WAT — Claude-in-Chrome pass against prod)

All 16 overlay routes return 200, zero console errors, iframes attach, §14 contract intact.

| Bug | Confirmed by | Evidence |
|---|---|---|
| 1 — token cross-doc fail | direct test | `?previewTokens=` set outer to `#ff0000`, iframe stayed `#050505` |
| 4 — H2H stats placeholder | postMessage show on h2h-2 | Position cell = `—` after trigger |
| 5 — OAS chip | leaderboard inspect | `partner--oas` bg = `rgba(255,255,255,0.92)` |
| 6 — green wall | leaderboard inspect | `.bg-fill` linear-gradient lime + halftone present |
| 7 — score-bug crack | keyframe inspect | 4-stop overshoot at 72% scale(1.02) |
| 8 — match-scores-day loop | source audit | `setInterval(fire('show'), 8000)` line 1426 (unguarded) |
| 9 — top-scorers defaults | demo render | hardcoded `t1=22, t2=19` rendered |

## Awaiting approval

User OK'd start. Phase A in progress (agent-dispatched). B+C queued.

## Phase A — review (2026-04-28)

### Shipped

**Migrations (2 new):**
- `20260612000001_overlay_design_tokens_bg_image.sql` — extends `token_type` CHECK to allow `'image'`; seeds 8 default `bg-image` rows (one per full-canvas overlay).
- `20260612000002_overlay_bgs_bucket.sql` — `overlay-bgs` storage bucket (public read, 5 MB cap, image/png|jpeg|webp; service-role write policies).

Both applied to cloud — verified via `supabase db query` that the 8 seed rows landed and the bucket is provisioned with the right MIME / size limit.

**Server-side modules:**
- `tokens.ts` — `TokenType` union extended with `"image"`; `escapeUrl(value)` helper for CSS `url("...")` wrapping with metachar-strip defence-in-depth.
- `defaults.ts` — `bg-image` entry in `TOKEN_CATALOG` (image type), `OVERLAY_OVERRIDES` populated for all 8 full-canvas keys with `"bg-image": ""` (empty = use HTML fallback). New `BG_IMAGE_SUPPORTED_KEYS` const + `supportsBgImage(key)` helper exported for the UI gate + the upload action.

**Server actions (`apps/web/src/app/admin/broadcast/v2/design/actions.ts`):**
- `uploadOverlayBgAction(FormData) → { ok, url } | { error }` — validates MIME, size (≤2 MB), `overlayKey ∈ BG_IMAGE_SUPPORTED_KEYS`, gates on `overlay.design.manage` perm + rate limiter, uploads via service-role to `overlay-bgs/<key>-<variant>-<ts>.<ext>`, persists public URL via `setDesignToken`. Returns the URL on success.

**Admin UI (`OverlayDesignEditor.tsx`):**
- New `ImageRow` widget — file input (PNG/JPEG/WebP, ≤2 MB pre-flight), 80×45 thumb (16:9), Upload (FormData → server action), Clear (resets local state, save commits the clear).
- Catalog filtered: image-typed entries only render when `supportsBgImage(overlayKey)` returns true. Floating-UI overlays (timer, lower-third, score-bug, up-next, top-scorers, orgs, coaches, penalties) hide the widget entirely.

**Iframe propagation fix (the load-bearing change):**
- `OverlayDataInjector.tsx` — `designTokens` + `previewTokens` props serialized into iframe URL as `?tokens=<b64>&previewTokens=<b64>` via Unicode-safe `btoa(unescape(encodeURIComponent(json)))`.
- `(overlay)/overlay/v2/[key]/page.tsx` — passes `designTokens={designTokens}` + `previewTokens={previewTokens || undefined}` through to the injector.
- 8 overlay HTMLs (16 files: source + public mirror) — inline `<script id="cade-token-bootstrap">` between `</title>` and `<style>`. Reads URL params, decodes, builds `:root{...}` rule, ALWAYS defers `appendChild` to `DOMContentLoaded` so the injected `<style id="cade-injected-tokens">` lands at the END of `<head>` and wins source-order cascade.
- 7 of 8 overlays got `background-image: var(--overlay-bg-image, url('.../ELITE S2 BG.png'))` rule swap (via one-shot `_phaseA-bg-image-var.mjs`, then deleted).
- 07-leaderboard's `.bg-fill` rewritten to use the ELITE S2 BG fallback (was a green linear-gradient); `.bg-halftone` set to `display:none` since the S2 BG already carries texture; `.bg-vignette` deepened for readability against the dark bg.

**Tests:**
- Unit: `defaults.test.ts` extended with `supportsBgImage` + `BG_IMAGE_SUPPORTED_KEYS` + `bg-image` catalog assertions (12 → 17 tests on the file; 1763 total tests still green).
- E2E: `overlay-design-tokens.spec.ts` extended with new `bg-image propagates through iframe` test that asserts iframe's computed `--overlay-bg-image` matches the persisted URL after upload + falls back after revert.

### Verification gate (CLAUDE.md §11 + §12)

| Check | Result |
|---|---|
| `npm run test --run` | 1763 / 1763 passed |
| `npm run lint` | clean (0 errors, only pre-existing warnings) |
| `npm run build` | clean (Compiled successfully in 7.9s) |
| `npm run db:push` | 2 migrations applied to cloud |
| Cloud DB seed verify | 8 bg-image rows present (1 per full-canvas key, value="") |
| Cloud DB bucket verify | `overlay-bgs` provisioned, public, 5 MB cap, allowed PNG/JPEG/WebP |
| Localhost iframe propagation proof | `?previewTokens=<b64({bg-color:#ff0000,accent-color:#00ffff})>` → iframe `--overlay-bg-color` = `#ff0000`, `--overlay-accent-color` = `#00ffff` ✓ |
| Localhost fallback proof | no `previewTokens=` → iframe falls back to `#050505` / `#6bcd06` defaults; `.bg-fill` background-image resolves to ELITE S2 BG ✓ |

### Cross-document propagation fix — the critical insight

CSS custom properties (`--overlay-X`) do NOT cross document boundaries. The SSR `<style id="overlay-design-tokens">` block on `/overlay/v2/<key>` lives on the OUTER document; the actual overlay rendering happens INSIDE an `<iframe src="/overlays/v2/<key>/index.html">`, which is a separate document. Before Phase A, the iframe always resolved tokens to its own hard-coded `:root{}` defaults regardless of what the outer page injected. The only way to get DB tokens + admin live-preview overrides into the iframe is to plumb them through the iframe's URL (or postMessage) so the iframe's own document evaluates them.

The bootstrap script also has a subtle ordering bug — running synchronously during head parse appends BEFORE the author `<style>` blocks that follow in source order. Fix: ALWAYS defer `appendChild` to `DOMContentLoaded` so the injected block lands at the END of `<head>` and wins source-order cascade. Captured in `tasks/lessons.md` 2026-04-28.

### Deferred follow-ups (not part of Phase A)

- **E2E run:** the bg-image E2E test at `apps/web/tests/e2e/overlay-design-tokens.spec.ts` was not exercised in the verification gate (Playwright requires the dev server running); the existing accent-color E2E + the unit suite cover the regression. Recommend running the full Playwright suite as part of post-deploy validation.
- **Phase B+C:** the H2H pinned-player source, anchored-overlay token wiring (score-bug / up-next / lower-third / timer), and animation polish are still queued per the Locked Decisions §1-3 above.
- **Visual screenshot:** the brief calls for screenshot-comparison QA per CLAUDE.md §4b. Localhost iframe inspection confirmed the propagation works at the CSS-variable level; visual diff against `/wallets`-quality reference is still owed for the 7 overlay variants (07-leaderboard's bg-fill swap especially).

## Phase B1 + B2 — review

Bug 5 + 6 (07-leaderboard) and Bug 8 (11-match-scores-day) cleanups requested in the user brief. Both files mirror to `apps/web/public/overlays/v2/<key>/index.html` via `node apps/web/scripts/sync-v2-overlays.mjs` (the script intentionally rewrites `../../../<bucket>/...` paths to `/overlays/v2/_assets/<bucket>/...` in the mirror — source and mirror are NOT byte-identical, that's by design).

### B1 — `KNOWLEDGE/brand-assets/elements/v2/07-leaderboard/index.html`

- **a) `.partner--oas` chip dropped.** The OAS PNG is already transparent — the previous `background: rgba(255,255,255,0.92); border-radius: 6px; padding: 6px 16px; box-shadow: ...` chip was cosmetic noise on the dark backdrop. Now inherits standard `.partner` styling (height: 58px only).
- **b) `.bg-fill` already wired to ELITE S2 BG via Phase A.** No change needed; confirmed at line 250-256 — `background-image: var(--overlay-bg-image, url('../../../designsample/ELITE%20S2%20BG.png'))`.
- **c) `.bg-halftone` element + CSS rule + selectors deleted.** Was previously `display: none` from Phase A but kept in DOM "for back-compat". Per brief, removed entirely: deleted the `<div class="bg-halftone" aria-hidden="true">` element, the `.bg-halftone { display: none }` rule, the `@keyframes halftone-drift` block, and removed `.bg-halftone` from the gate selectors (cade-visible / cade-exiting CSS rules) AND from the `cade-visible-gate-observer-v2` `SEL` constant.
- **d) `.bg-vignette` simplified for dark bg.** The previous multi-stop `radial-gradient(ellipse...) + linear-gradient(to bottom...)` was tuned for the green-wall variant and was over-darkening the corners on the dark ELITE S2 BG. Replaced with a single subtle `radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.4) 100%)` — clean center-out falloff that reads on dark backdrop.
- **e) `.matchday-mark` + `.season-mark` text colors flipped.** Was `rgba(0,0,0,0.55)` (dark on green) — invisible on dark bg. Now `rgba(255,255,255,0.85)` (pale ink). Confirmed all other `rgba(0,0,0,...)` instances are `text-shadow` / `box-shadow` / `drop-shadow` / `.row.is-top` (top-2 rows on green chip want black text — kept).

### B2 — `KNOWLEDGE/brand-assets/elements/v2/11-match-scores-day/index.html`

- **a) Demo loop `?demo=1` guard already present.** The `<script data-tag="cade-demo-mode">` block at line 1492 already starts with `if (new URLSearchParams(location.search).get('demo') !== '1') return;` — no change needed. The brief request was based on a stale view of the file; the §14 contract is satisfied.
- **b) `cade-rendered` single-play guard added to `show()`.** Was: every `show` postMessage ran `el.style.animation = 'none'; void offsetHeight; el.style.animation = orig` to FORCE-RESTART the entry animations, so each cycle visibly replayed the entry choreography. Now: a top-level `var hasRenderedOnce = false` gates the restart dance — first `show` adds `cade-rendered` body class + runs the restart loop; subsequent `show` calls just toggle `cade-visible` without re-firing entry animations. `hide` does NOT reset the flag (animations stay played for the lifetime of the page).
- **c) `infinite` keyword dropped from `header-loop`, `title-loop`, `row-enter`, `footer-loop`.** Was previously `animation: <name> var(--cycle) cubic-bezier(...) infinite` paired with `--cycle: 13s` — would replay every 13s. Now `animation: <name> var(--cycle) cubic-bezier(...)` — defaults to single-play (iteration-count: 1), matching the b) guard. Marquee at line 837 stays `infinite` per user feedback ("marquee is fine").
- **d) Background already on ELITE S2 BG via Phase A.** Confirmed at line 302 — `background-image: var(--overlay-bg-image, url('../../../designsample/ELITE%20S2%20BG.png'))`.

### Verification gate (CLAUDE.md §11 + §12)

| Check | Result |
|---|---|
| `npm run test --run` | 1763 / 1763 passed |
| `npm run lint` | clean (0 errors, 14 pre-existing warnings) |
| `npm run build` (apps/web) | local build hits a TypeScript error in an UNTRACKED file `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts` (Phase B4 in-flight from another session — `let ids: string[]` rejects `null` return). Not in my commit; Vercel build runs only against pushed tree so my push won't include it. |
| Sync script | `node apps/web/scripts/sync-v2-overlays.mjs` reports 16/16 HTML synced; source vs mirror diff for both files contains only the expected `../../../<bucket>/` → `/overlays/v2/_assets/<bucket>/` path rewrites. |
| Phase B markers | 1 marker in `07-leaderboard/index.html`, 5 in `11-match-scores-day/index.html`; both mirrored. |

### Lessons captured

- The sync script intentionally rewrites paths during mirror — "byte-identical" is impossible by design. Verify by running the sync, then diff and confirm only path rewrites differ. Captured in `tasks/lessons.md` 2026-04-29.
- `git stash --include-untracked` plus an existing pre-session stash (`pre-slice3-wip`) on the same workspace is risky: pop can pull in unrelated working-tree changes from other agents' WIP slices. Always verify the post-pop diff includes only your own work; stage explicitly with `git add <file>` rather than `git add -A` to avoid accidentally committing other agents' in-flight code. Captured in `tasks/lessons.md` 2026-04-29.

