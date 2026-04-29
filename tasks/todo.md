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

## Phase B3 + B6 — review

Brief: smooth out 09-secondary-score-bug entry crack (B3) + clear top-scorers demo seeds + render full 4-10 tail strip + photo path normalization (B6). Both targets sit OUTSIDE the Phase A bootstrap-script set (09 is anchored, 14 was not in the 8 full-canvas list). No Phase A preservation needed.

### B3 — `KNOWLEDGE/brand-assets/elements/v2/09-secondary-score-bug/index.html`

- **a) `@keyframes entry` collapsed from 4-stop overshoot to 2-keyframe ease-out.** Was: `0% translateX(120%) scale(0.88) opacity 0; 35% translateX(20%) scale(0.96) opacity 0.7; 72% translateX(-2%) scale(1.02) opacity 1; 100% translateX(0) scale(1) opacity 1;` paired with `cubic-bezier(.18,.9,.28,1.18)` (overshoot-bouncy). Now: `0% translateX(140%) scale(0.95) opacity 0; 100% translateX(0) scale(1) opacity 1;` with `cubic-bezier(0.22, 1, 0.36, 1)` (smooth ease-out). Duration 0.9s → 0.65s — feels snappier without the visible overshoot crack at 35% / 72% stops.
- **b) `.bar` `glowPulse` gated on `.bug-mount.entered`.** Was running concurrently with the entry transform — two animations competing for paint frames during the 0.65s reveal. Now scoped via `.bug-mount.entered .bar { animation: glowPulse ... }`. JS adds `.entered` on `animationend` of the `entry` keyframe (filtered by `event.animationName === 'entry'` so `pulseRing` and `scorePop` don't trigger early). `show()` removes `.entered` + re-arms the listener so each cycle waits for a fresh entry to finish before resuming the loop.

### B6 — `KNOWLEDGE/brand-assets/elements/v2/14-top-scorers/index.html`

- **a) Hardcoded fallback demo numbers `|| 22 / 19 / 17` dropped from `__cadeRunDigitRoll`.** Was: `parseInt(...) || 22` would render the demo-time placeholder when the live payload was empty. Now: `parseInt(...)` returns NaN when no `data-target` is present + the new `maybeRoll` helper renders an em-dash for NaN. Real data still rolls 0 → target as before.
- **b) `rebuildTail` now ALWAYS renders 7 cells (ranks 4-10).** Was: `for (var i = 3; i < Math.min(10, scorers.length); i++)` skipped the loop when `scorers.length <= 3`. Now: `for (var i = 3; i < 10; i++)` renders all 7 slots; missing data falls through to `(empty)` name + `—` goals + no photo. Matches user complaint "only top 3 with no pictures" — the tail strip is now visible structurally even with sparse data.
- **c) Empty-state placeholder for podium pods.** When `update()` runs with fewer than 3 scorers, the unused pods now show name `(no scorers)` + goals `—` + cleared photo `src`. The `dataset.target` attribute is DELETED (not just zeroed), so the digit-roll skips that pod via the new NaN branch. Producer sees clear "no data" signal in OBS.
- **d) New `cade-clear-static-seeds` IIFE strips placeholder seeds on production load.** When `?demo=1` is absent, the script clears all 3 podium pods (`data-target` deleted, text → `—`, names → `(no scorers)`, photo `src` removed) and all 7 tail-strip cells (names → `(empty)`, goals → `—`, photo `src` removed) BEFORE any postMessage `show` arrives. Demo mode (`?demo=1`) keeps the seeds intact so the local preview still renders the designed state. This kills the "random goal numbers in OBS" symptom even if the broadcast control panel ships `show` without `data`.
- **e) Demo loop already guarded by `?demo=1`.** Confirmed at line 1687 — the brief's concern about (3) was based on a stale view of the file. No change needed.
- **f) Photo path normalization via server helper update.** `apps/web/src/lib/player-photos.ts` `getPlayerHeadshotUrl` now returns `/overlays/v2/_assets/players/processed/<slug>/headshot_<NN>_nobg.png` instead of `/players/<slug>/headshot_<NN>.png`. The new path matches the v2 sync script's published asset tree + the static fallback paths inside the overlay HTML — so server payloads (top_scorers_data, autofill, lower-third) all resolve photos from the SAME asset tree the static HTML defaults to. No more `/players/...` vs `/overlays/v2/_assets/...` split. Unit tests updated; `top_scorers_data.test.ts` passes through hardcoded URL strings to test schema serialization (not the helper) so no test changes there.

### Verification gate (CLAUDE.md §11 + §12)

| Check | Result |
|---|---|
| `npm run test` | 188 files / 1763 tests passed |
| `npm run lint` | clean (0 errors, 14 pre-existing warnings none from this slice) |
| `npm run build` | (running at commit time — see commit body if any new errors) |
| Sync script | `node apps/web/scripts/sync-v2-overlays.mjs` → 16/16 HTML synced. `wc -l` confirms source/mirror line-count parity for both 09 (894) + 14 (1736). |
| Phase B markers | `B3 fix (2026-04-28)` + `B6 fix (2026-04-28)` comments present in source HTMLs and the player-photos helper. |
| Live verify | Post-deploy via Claude-in-Chrome (logged separately). |

### Lessons captured

- Static-HTML "designer-time" placeholders (`data-target="22"`) are NOT inert in production. They survive page load and bleed through OBS until JS overwrites them. Add a `?demo=1`-gated clear pass that strips placeholder data before any animation triggers. Captured in `tasks/lessons.md` 2026-04-28 (Phase B6 lesson).
- For "enter from off-screen" reveals, prefer single ease-out curves over multi-stop anticipation/overshoot keyframes. Concurrent infinite animations (glowPulse, breathe) on the entering element MUST be gated on a post-entry class — `animation-delay` doesn't pause GPU paint. `animationend` listeners must filter on `event.animationName` to avoid pulseRing/scorePop triggering them early. Captured in `tasks/lessons.md` 2026-04-28 (Phase B3 lesson).

## Phase B4 + B5 + C — review (2026-04-28)

### Shipped

**New endpoint (1 file):**
- `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts` — view-token-gated GET. Accepts `?ids=A,B[,C][,D][,E]` (explicit) OR `?key=04-h2h-2|05-h2h-3|06-h2h-5` (resolves pinned players from latest `overlay_events.payload.players[].displayName` → `users.gamer_tag` → `players.id` chain). Returns `{cards: H2HCard[], seasonId, channel: "public:standings:<seasonId>"}`. Idempotent + `Cache-Control: no-store`.

**Endpoint test (1 file, 10 cases):**
- `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.test.ts` — verifies view-token gate / 404 / empty-cards / explicit-ids happy / invalid UUID / >5 ids / missing-ids+missing-key / key-no-overlay-row / key-resolves-displayName-chain / buildH2HCards-throws.

**Injector wiring (1 file):**
- `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx`:
  - `INITIAL_FETCH_PATH` extended to take `(sessionId, overlayKey)` (was `(sessionId)` only). All three call sites updated to pass `overlayKey`.
  - Three new entries: `04-h2h-2`, `05-h2h-3`, `06-h2h-5` → `/api/broadcast/sessions/<id>/h2h?key=<key>`.
  - `REALTIME_KEY_EVENTS` extended with the same three keys → `["standings.changed"]` so stat cells repaint mid-stream when match results post.

**H2H 2-player overlay (`04-h2h-2/index.html` + public mirror):**
- Strengthened entry: player columns slide from `-300px / +300px` with `scale(0.92)→1.0` punch (was `-180/+180` with no scale). Single play.
- Drop exit slide: `body.cade-exiting .player-col { animation: none; opacity: 0; transition: opacity 0.3s }`. Only the player columns get fade-only — the rest (top-band, kicker, stats-card, partners, etc.) keep the existing `cade-fade-out` translateY exit.
- Stat-row wiring: 9 `data-stat="<key>"` attributes added to value cells (`position`, `played`, `wins`, `draws`, `losses`, `gf`, `ga`, `gd`, `points`) plus `data-stat="win-prob"` on each winprob value. New `applyStatsToSide(info, side)` helper renders from `info.stats.<key>`. `update(data)` accepts BOTH `{players: [{slug,name}]}` (postMessage) AND `{cards: H2HCard[]}` (server) — readPlayer normalizes both into a single `info.stats` bag.
- Gate observer scope: `.player-col` REMOVED from observer SEL list so the keyframe `from-opacity:0` step actually paints on cade-visible (was being clobbered by `style.opacity = '1' !important` immediately after class add).

**H2H 3-player overlay (`05-h2h-3/index.html` + public mirror):**
- Strengthened entry: c1 from `-250px`, c2 from below (existing punch keyframe), c3 from `+250px`, all with `scale(0.92)→1.0`. 100ms stagger between cards (`0.55s / 0.65s / 0.75s`).
- Drop exit slide: `body.cade-exiting .player-card { animation: none; opacity: 0; transition: opacity 0.3s }`.
- Stat wiring: `data-stat` attrs on Pos / P / W-D-L / Pts / GF / GA / GD value cells + win-pill `.val`. New `applyStatsToCard(cardEl, info)` helper. The synthetic `wdl` key concatenates `wins-draws-losses`. `update(data)` accepts both shapes.
- Gate observer: `.player-card` REMOVED from SEL list (same reason as B4).

**H2H 5-player overlay (`06-h2h-5/index.html` + public mirror):**
- Strengthened entry: c1 from `-400px`, c2 from `-200px+staircase`, c3 anchor, c4 from `+200px+staircase`, c5 from `+400px`. 50ms stagger. New `card-in-c1`..`card-in-c5` keyframes — old single `card-in` rule + duplicate `.grid .card { animation: card-in ... }` block REMOVED to prevent re-overwrite.
- Drop exit slide: `body.cade-exiting .card { animation: none; opacity: 0; transition: opacity 0.3s }`.
- Stat wiring: `data-stat` attrs on every `.stats > .stat-value` (P / Pts / W-D-L / GF / GA / Win Prob) + `data-stat="position"` on the pos-chip number. New dynamic `Win Prob · GD <±N>` label via `data-stat-label="wp-gd"` (renders signed GD).
- Gate observer: `.card` REMOVED from SEL list.

**Docs:**
- CLAUDE.md §14 — new HARD RULE table listing all auto-update overlays + their `INITIAL_FETCH_PATH` + `REALTIME_KEY_EVENTS` wiring. Spells out the contract: view-token gated (NOT perm gated), `{seasonId, channel, cards|payload|rows}` response shape, no-store cache, dual-shape `update(data)` handler.

### Verification gate

| Check | Result |
|---|---|
| `npm run test --run` | 1773 / 1773 passed (was 1763 — 10 new H2H endpoint tests) |
| `npm run lint` | clean (0 errors, only pre-existing warnings unchanged from prior commit) |
| `npm run build` | clean (Compiled successfully in ~10s; pre-existing UserBadge dynamic-server warnings unchanged) |
| Sync script | `node apps/web/scripts/sync-v2-overlays.mjs` → 16/16 HTML synced + assets copied |
| Source/mirror parity | `wc -l` confirms byte-identical between `KNOWLEDGE/brand-assets/elements/v2/<key>` and `apps/web/public/overlays/v2/<key>` for all three H2H keys |
| H2H endpoint isolated | 10/10 tests green for `/api/broadcast/sessions/[id]/h2h/route.test.ts` |

### Lessons captured

- **Auto-update overlay HARD RULE.** Any overlay rendering live league data MUST be wired in `OverlayDataInjector` `INITIAL_FETCH_PATH` (mount-time seed) + `REALTIME_KEY_EVENTS` (mid-stream repaint). Endpoint must be view-token gated (NOT perm-gated — these serve unauthenticated OBS browser sources). Static HTML's `update(data)` must accept BOTH the postMessage shape AND the server response shape, normalizing both into a unified per-player `info.stats` bag. Skipping any of the three (endpoint / wiring / dual-shape handler) leaves the overlay frozen on hardcoded placeholder values forever — exactly the H2H stats bug. Captured in `tasks/lessons.md` 2026-04-28 (Phase C lesson).
- **Gate observer must NOT clobber CSS keyframe `from-opacity:0` steps.** The `cade-visible-gate-observer-v2` script forces inline `opacity: 1 !important` on every selector match the moment `cade-visible` is added. If the same element has a CSS keyframe entry animation (e.g. `player-a-in { 0% { opacity: 0 } 100% { opacity: 1 } }`), the observer wins (both `!important`, but inline beats stylesheet) and the from-step is never visible. Fix: exclude entry-animated containers from the observer SEL list. They're still gated via the `body.cade-visible` CSS rule which ALSO uses opacity:0/1 — but the keyframe runs ON TOP because the CSS class doesn't have `!important`. Captured 2026-04-28 (Phase B4 lesson).
- **TypeScript strict mode catches `let foo: T; foo = maybeReturnsTOrNull()` even when guarded by an immediate `if (foo === null) return`.** Have to assign through a temporary `const parsed = ...` first, narrow with the if-return, then assign to the typed var. Caught by `next build`'s tsc pass, NOT by `npm run lint` (eslint doesn't follow type narrowing across reassignment). Captured 2026-04-28 (Phase C type-narrowing lesson).

## Final review — 9-bug overlay sweep (2026-04-29 14:10 WAT)

All 9 user-reported bugs shipped + verified on prod across 4 commits:

| Commit | Phase | Bugs fixed |
|---|---|---|
| `53374dc7` | A — design system foundation | Bug 1 (token cross-doc propagation + bg-image upload) |
| `3ba537f3` | B1 + B2 | Bug 5 (OAS chip), Bug 6 (ELITE S2 BG), Bug 8 (match-scores demo guard + single-play) |
| `66c2b49f` | B3 + B6 | Bug 7 (score-bug smooth entry), Bug 9 (top-scorers empty-state + photo path) |
| `15cc5cbc` | B4 + B5 + C | Bug 3 (h2h player entry slide), Bug 4 (h2h stat wiring + auto-update HARD RULE) |

### Prod verification (Claude-in-Chrome against `cade-league.vercel.app`)

| Check | Result |
|---|---|
| Phase A token propagation across 4 full-canvas overlays (01-brb, 04-h2h-2, 07-leaderboard, 11-match-scores-day) | `?previewTokens=` `--overlay-bg-color: #ff0000` flows into iframe ✓ |
| B1 leaderboard `.partner--oas` background | `rgba(0, 0, 0, 0)` (chip dropped) ✓ |
| B1 leaderboard `.bg-fill` background-image | `url(".../ELITE%20S2%20BG.png")` ✓ |
| B1 leaderboard `.bg-halftone` element | NOT FOUND (removed) ✓ |
| B2 match-scores-day `?demo=1` absent → body class | empty after 12s (demo guarded) ✓ |
| B3 score-bug `@keyframes entry` | smooth 2-keyframe ease-out (no overshoot) ✓ |
| B4 h2h-2 stats after postMessage show | 20 `[data-stat]` elements rendered with payload values ✓ |
| B5 h2h-3 stats | 24 `[data-stat]` elements wired ✓ |
| B5 h2h-5 stats | 35 `[data-stat]` elements wired ✓ |
| B6 top-scorers empty payload | 7 tail rows with `(empty)` + `—` placeholders, no demo numbers ✓ |
| C h2h endpoint without view_token | HTTP 401 (gate active) ✓ |

### Phase D — docs

- `CLAUDE.md` §14 — auto-update HARD RULE table appended (Phase C agent in `15cc5cbc`).
- `docs/superpowers/specs/2026-04-26-overlay-design-prompt.md` — new §3a documenting bg-image + design-system tokens for new-overlay AI prompts.

### Status

All bugs ✓ shipped + verified. All tasks marked complete. Plan = done.

## Bug 3 — review (2026-04-28)

**Reported:** "there is no way to add background to the top 10 goal scorers overlay on the design page, the upload bg modal does not show for the top 10 goal scorers."

**Root cause:** Phase A (commit `53374dc7`) shipped `BG_IMAGE_SUPPORTED_KEYS` with eight full-canvas overlays only — `01-brb`, `04-h2h-2`, `05-h2h-3`, `06-h2h-5`, `07-leaderboard`, `11-match-scores-day`, `12-starting-soon`, `13-stream-ended`. The Golden Pad (`14-top-scorers`) was misclassified as floating-UI at that time, so the editor's `supportsBgImage()` gate hid the image-row widget for it. In reality, the top-scorers podium fills the full 1920×1080 canvas (paints the ELITE S2 stadium BG behind the podium / tail strip) — qualifies as full-canvas.

**Fix slice (single commit):**

| File | Change |
|---|---|
| `apps/web/src/server/overlays/design/defaults.ts` | Added `"14-top-scorers"` to `BG_IMAGE_SUPPORTED_KEYS` (now 9 keys). Added `"bg-image": ""` to its `OVERLAY_OVERRIDES` entry. Updated comment to reflect the change + reference Bug 3 + the new follow-up migration. |
| `apps/web/src/server/overlays/design/defaults.test.ts` | Moved `14-top-scorers` from `FLOATING_UI` test list into `FULL_CANVAS` list. Updated test description label to "nine full-canvas overlay keys". |
| `KNOWLEDGE/brand-assets/elements/v2/14-top-scorers/index.html` | Added the cade-token-bootstrap `<script>` block at the top of `<head>` (verbatim copy from `04-h2h-2`). Wired `.bg-image { background-image: var(--overlay-bg-image, url('...ELITE S2 BG.png')); }` so the iframe picks up the admin-uploaded URL when present, falls back to the canonical stadium image otherwise. |
| `apps/web/public/overlays/v2/14-top-scorers/index.html` | Mirror auto-synced via `node apps/web/scripts/sync-v2-overlays.mjs`. Sync rewrites the relative `../../../designsample/...` path to absolute `/overlays/v2/_assets/designsample/...` for the public folder. |
| `supabase/migrations/20260615000001_top_scorers_bg_image.sql` | Idempotent INSERT of one `bg-image=''` row for `(14-top-scorers, default)`, mirroring Phase A's seed pattern. Uses the same admin-fallback-or-skip ladder for `set_by`. |
| `tasks/todo.md` | This review section. |

`OverlayDesignEditor.tsx` was inspected — the gate is data-driven via `supportsBgImage(overlayKey)` (line 156). No hard-coded list to fix in the component. Once the key landed in `BG_IMAGE_SUPPORTED_KEYS` the editor's `filteredCatalog` automatically includes the image row.

**Verification gate:**
- `npm run test --run` — 1773/1773 pass (defaults.test.ts: 17/17, including the new `14-top-scorers` assertions in both FULL_CANVAS branches).
- `npm run lint` — 0 errors (only pre-existing warnings unrelated to this change).
- `npm run build` — clean production build.
- Sync script — 16/16 HTML files synced, asset buckets unchanged.

**Auto-pipeline:** `db:push` runs in GitHub Actions on push to main when `supabase/migrations/**` changes (per `.github/workflows/db-push.yml`); no manual push needed.

