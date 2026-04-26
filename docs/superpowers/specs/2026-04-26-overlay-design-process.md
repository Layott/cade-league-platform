# Overlay Design Process

**Date:** 2026-04-26
**Owner:** designer/operator (any human or agent editing v2 overlay visuals)
**Scope:** the 16 broadcast v2 overlays under `KNOWLEDGE/brand-assets/elements/v2/` — how to change them, how to ship them, how to keep them honest with the control panel.

---

## 1. Overview

**HTML-as-source-of-truth.** The visual design of every v2 overlay lives in a single standalone HTML file under `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html`. A designer can open that file directly in Chrome and iterate on layout / colors / motion without touching any TypeScript or running Next.js.

The Next.js app **does not own** the overlay design. It owns:

1. **The contract** (Zod payload schemas in `apps/web/src/server/overlays/schemas.ts`).
2. **The control panel** that triggers overlays (`apps/web/src/app/admin/broadcast/v2/[sessionId]/page.tsx` + per-overlay controls under `apps/web/src/components/broadcast/v2/controls/`).
3. **The transport** (Supabase Realtime `overlay:<sessionId>` channel + `OverlayDataInjector.tsx` postMessage relay).
4. **A static mirror** of the HTMLs at `apps/web/public/overlays/v2/<key>/index.html`, written by the sync script at build/dev time.

There are **two paths** for the same HTML, and the rule is non-negotiable:

| Path | Role | Edit it? |
|------|------|----------|
| `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` | Source of truth | **YES — edit here** |
| `apps/web/public/overlays/v2/<key>/index.html` | Generated mirror | **NO — overwritten by sync** |

Any edit to the public mirror is destroyed the next time `npm run sync:overlays`, `npm run prebuild`, or `npm run build` runs. Always edit `KNOWLEDGE/...`.

---

## 2. The 16 overlays

All 16 keys live in `apps/web/src/components/broadcast/v2/overlay-keys.ts` (`V2_OVERLAY_KEYS`) and are mirrored in `apps/web/scripts/sync-v2-overlays.mjs` (`KEYS`). Each maps 1:1 to a legacy `template_key` via `apps/web/src/components/broadcast/v2/template-mapping.ts` so it can reuse the existing realtime + Zod plumbing.

| Key | Source HTML | Payload schema (`schemas.ts`) | Control component | Description |
|---|---|---|---|---|
| `01-brb` | `KNOWLEDGE/brand-assets/elements/v2/01-brb/index.html` | `layoutBrbBasicSchema` | `controls/BrbControl.tsx` | BRB / intermission full-screen |
| `02-timer` | `.../02-timer/index.html` | `layoutTimerSchema` | `controls/TimerControl.tsx` | Lower-third countdown bug |
| `04-h2h-2` | `.../04-h2h-2/index.html` | `h2h2Schema` | `controls/H2H2Control.tsx` | Head-to-head, 2 players |
| `05-h2h-3` | `.../05-h2h-3/index.html` | `h2h3Schema` | `controls/H2H3Control.tsx` | Head-to-head, 3 players |
| `06-h2h-5` | `.../06-h2h-5/index.html` | `h2h5Schema` | `controls/H2H5Control.tsx` | Head-to-head, 3-5 players |
| `07-leaderboard` | `.../07-leaderboard/index.html` | `leaderboardAnimatedSchema` | `controls/LeaderboardControl.tsx` | Animated standings |
| `08-lower-third` | `.../08-lower-third/index.html` | `lowerThirdSchema` | `controls/LowerThirdControl.tsx` | Lower-third name/stats card (3 multi-instance slots) |
| `09-secondary-score-bug` | `.../09-secondary-score-bug/index.html` | `scoreBugSchema` | `controls/SecondaryScoreBugControl.tsx` | Persistent score bug |
| `10-up-next-bug` | `.../10-up-next-bug/index.html` | `upNextBugSchema` | `controls/UpNextBugControl.tsx` | Up-next fixture bug |
| `11-match-scores-day` | `.../11-match-scores-day/index.html` | `matchScoresDaySchema` | `controls/MatchScoresDayControl.tsx` | Today's results table |
| `12-starting-soon` | `.../12-starting-soon/index.html` | `startingSoonBasicSchema` | `controls/StartingSoonControl.tsx` | Starting-soon full-screen |
| `13-stream-ended` | `.../13-stream-ended/index.html` | `streamEndedSchema` | `controls/StreamEndedControl.tsx` | Stream-ended full-screen |
| `14-top-scorers` | `.../14-top-scorers/index.html` | `topScorersSchema` | `controls/TopScorersControl.tsx` | Top-10 goal scorers |
| `15-orgs` | `.../15-orgs/index.html` | `orgsRosterSchema` | `controls/OrgsControl.tsx` | Org roster card |
| `16-coaches` | `.../16-coaches/index.html` | `coachIntrosSchema` | `controls/CoachesControl.tsx` | Coach + roster intro |
| `17-penalties` | `.../17-penalties/index.html` | `playerPenaltiesSchema` | `controls/PenaltiesControl.tsx` | Player penalty list |

**Excluded from the live route list (intentional):** `03-animated-bg*` (background-only meta) and `18-partners-strip` (subsumed). Their source HTMLs exist for reference but are not synced or routed.

---

## 3. Workflow for changing an existing overlay

### Step 1 — Edit the source

```bash
# Open in your editor of choice
code KNOWLEDGE/brand-assets/elements/v2/02-timer/index.html
```

Iterate on CSS, animation, layout, postMessage handling, etc. The file is fully self-contained — fonts, design tokens, markup, and JS all live in one HTML.

### Step 2 — Sync to the public mirror

Two modes:

```bash
cd apps/web

# One-shot: rewrites paths + copies all 16 HTMLs + asset buckets
npm run sync:overlays

# Live mode: chokidar watches KNOWLEDGE/...elements/v2/ and re-syncs on save
npm run sync:overlays:watch
```

Watch mode is the right default while iterating — every save in `KNOWLEDGE/...` triggers a re-sync within ~50ms, and Chrome's hot-refresh picks it up.

### Step 3 — Preview locally

```bash
cd apps/web
npx next dev -p 3030
```

Open the standalone HTML directly:

```
http://localhost:3030/overlays/v2/02-timer/index.html
```

Visual smoke-check at full 1920×1080. Use `?demo=1` (where the HTML supports it) or open Chrome DevTools and post a sample message:

```js
document.querySelector('iframe').contentWindow.postMessage(
  { type: 'show', data: { minutes: 3, seconds: 0 } },
  '*',
);
```

### Step 4 — Test the trigger pipeline

Visit the broadcast control page authenticated as admin:

```
http://localhost:3030/admin/broadcast/v2/<sessionId>
```

(Get a `sessionId` from `/admin/broadcast/v2` — the index page lists active sessions, or "New session" creates one.)

Click the corresponding overlay's **Trigger** / **ENTER** button. Confirm:

- The mini-preview iframe animates the entry.
- A second tab on `/overlay/v2/<key>?session=<id>&token=<token>` (the live OBS/vMix URL) shows the same animation in sync.
- Browser console: no errors in either frame.
- Click **Hide** / **OUT** → exit animation plays cleanly, no stuck frames.

### Step 5 — Lint + build

```bash
cd apps/web
npm run lint
npm run build   # also runs prebuild → sync:overlays automatically
```

`build` re-runs the sync via the `prebuild` hook, so the public mirror in the deploy bundle always matches `KNOWLEDGE/...`. No manual sync step is required for prod.

### Step 6 — Commit + push

```bash
git add KNOWLEDGE/brand-assets/elements/v2/<key>/index.html
git add apps/web/public/overlays/v2/<key>/index.html   # the synced mirror
git commit -m "fix(overlay): <what changed in <key>>"
git push origin main
```

Vercel auto-deploys on push to `main`. **Both** the source AND the synced mirror get committed — the mirror is checked in (not gitignored) so production builds don't depend on the sync running clean in CI.

### Step 7 — Verify on prod

After Vercel reports green:

```bash
curl -I https://<prod-domain>/overlays/v2/02-timer/index.html
# expect 200
```

Open the live URL in a browser. Authenticated admin → trigger the overlay on a real session. Confirm the design lands as intended. Per `CLAUDE.md` §12, scan the broadcast route too and report a row in the post-push verification table.

---

## 4. Workflow for adding a NEW overlay

This is rare — the 16-overlay roster is locked. Add only with explicit user approval. Sketch:

### Step 1 — Create the source HTML

```bash
mkdir KNOWLEDGE/brand-assets/elements/v2/19-new-overlay
cp KNOWLEDGE/brand-assets/elements/v2/02-timer/index.html \
   KNOWLEDGE/brand-assets/elements/v2/19-new-overlay/index.html
```

Edit from the template — see §5 for the required anatomy.

### Step 2 — Add the Zod payload schema

In `apps/web/src/server/overlays/schemas.ts`:

```ts
export const newOverlaySchema = z.object({
  /* ... */
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,   // only if match-aware
});
export type NewOverlayPayload = z.infer<typeof newOverlaySchema>;
```

### Step 3 — Register the key

Two registries must agree:

- `apps/web/src/components/broadcast/v2/overlay-keys.ts` → append to `V2_OVERLAY_KEYS` + `V2_OVERLAY_LABELS`
- `apps/web/scripts/sync-v2-overlays.mjs` → append to `KEYS`

If multi-instance, also add to `V2_MULTI_INSTANCE_KEYS`.

### Step 4 — Map to a legacy template key (or invent one)

In `apps/web/src/components/broadcast/v2/template-mapping.ts` add the entry. If no legacy equivalent exists, register a new `TemplateKey` in `apps/web/src/server/overlays/registry.ts` first (rare — coordinate with `events.ts` / `presets.ts`).

### Step 5 — Build the control component

```
apps/web/src/components/broadcast/v2/controls/NewOverlayControl.tsx
```

Copy `BrbControl.tsx` (simple) or `TimerControl.tsx` (editable with payload form) as the template. Both wrap `ControlCard` and emit `<input type="hidden" name="payload" value="<JSON>" />` matching the Zod schema.

### Step 6 — Slot it into the control grid

Edit `apps/web/src/app/admin/broadcast/v2/[sessionId]/ControlGrid.tsx` — import + render the new control. Pass `active={active['19-new-overlay'] ?? false}`.

### Step 7 — Sync, preview, test, deploy

Same as §3 steps 2-7. Add a unit test for the new schema in `schemas.test.ts` and a control test in `SimpleControls.test.tsx` (or a sibling).

---

## 5. Anatomy of an overlay HTML

Every overlay is a single self-contained file. Required structure:

### 5a. Brand fonts (Agharti + Quedora)

Use `../../../fonts/...` paths. The sync script rewrites them to `/overlays/v2/_assets/fonts/...` automatically. Reference live working examples: `02-timer/index.html` lines 28-96.

```css
@font-face {
  font-family: 'Agharti';
  src: url('../../../fonts/agharti-family-2026-03-23-03-20-06-utc%20MAINPRIMARY%20FONT/Family%20Deliverables/Agharti-Bold.woff2') format('woff2');
  font-weight: 700;
  font-display: block;
}
/* ... 4 more Agharti weights, 4 Quedora weights */
```

### 5b. Design tokens in `:root`

Locked palette per `CLAUDE.md` §Brand:

```css
:root {
  --green:       #6bcd06;
  --green-hot:   #8fff1a;
  --pink:        #fe036d;
  --pink-hot:    #ff3d8a;
  --black:       #0a0a0a;
  --white:       #ffffff;
  --ink-dim:     rgba(255,255,255,.72);
  --shadow-green: 0 0 36px rgba(107,205,6,.55), 0 6px 24px rgba(0,0,0,.45);
  --shadow-pink:  0 0 36px rgba(254,3,109,.65), 0 6px 24px rgba(0,0,0,.45);
}
```

### 5c. Body + stage

```css
html, body {
  width: 1920px; height: 1080px;
  overflow: hidden;
  background: transparent !important;
  font-family: "Quedora","Rajdhani",system-ui,sans-serif;
  color: var(--white);
  -webkit-font-smoothing: antialiased;
}
body { opacity: 1 !important; background: transparent !important; }
.stage { position: relative; width: 1920px; height: 1080px; }
```

`background: transparent !important;` is **mandatory** — OBS/vMix composite the iframe over a live video feed, and any solid color blocks the feed.

### 5d. postMessage handler

The contract enforced by `OverlayDataInjector.tsx`. Every overlay listens for:

```js
window.addEventListener('message', (ev) => {
  const msg = ev && ev.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'show' || msg.type === 'update') {
    const data = msg.data;     // shape matches the Zod schema
    /* render */
  }
  if (msg.type === 'hide')  { /* exit animation, then hide */ }
  if (msg.type === 'reset') { /* clear + return to neutral */ }
});
```

Multi-instance overlays (lower-third) also receive `msg.slot` (1-3) so each slot positions independently. See `08-lower-third/index.html` for the canonical pattern.

### 5e. Visibility gate (Plan 51 load-bearing)

Two cooperating scripts at the bottom of every overlay:

**Master gate** — flips `body.cade-visible` / `body.cade-exiting` on `show` / `hide`:

```html
<script>
(function cadeGate() {
  'use strict';
  function show() {
    document.body.classList.remove('cade-exiting');
    document.body.classList.add('cade-visible');
  }
  function hide() {
    document.body.classList.remove('cade-visible');
    document.body.classList.add('cade-exiting');
  }
  window.addEventListener('message', function (ev) {
    var msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'show' || msg.type === 'update') show();
    else if (msg.type === 'hide') hide();
  }, false);
})();
</script>
```

**Inline-style observer** — Chrome's cross-origin iframe lifecycle eats CSS-only opacity transitions in some renderer states. The observer sets `opacity` + `visibility` *inline* with `!important`, which always wins:

```html
<script data-tag="cade-visible-gate-observer-v2">
(function(){
  var SEL = '.timer';   // change to your overlay's root visible element selector
  function apply() {
    var b = document.body;
    if (!b) return;
    var vis = b.classList.contains('cade-visible');
    var exit = b.classList.contains('cade-exiting');
    document.querySelectorAll(SEL).forEach(function(el){
      if (vis) {
        el.style.setProperty('opacity', '1', 'important');
        el.style.removeProperty('transform');
        el.style.setProperty('visibility', 'visible', 'important');
      } else {
        el.style.setProperty('opacity', '0', 'important');
      }
    });
  }
  apply();
  new MutationObserver(apply).observe(document.body, {attributes:true, attributeFilter:['class']});
})();
</script>
```

The `SEL` selector is overlay-specific — `.timer`, `.brb-stage`, `.lower-third`, etc. **Without these two scripts, overlays show on page load instead of waiting for the trigger.** Both must be present.

### 5f. Optional demo loop

For standalone preview without the control panel, gate a demo loop on `?demo=1`:

```js
if (new URLSearchParams(location.search).has('demo')) {
  // simulate entry → hold → exit cycle every 6 s
}
```

---

## 6. Animation guidelines

- **Palette:** `#6bcd06` green (primary), `#fe036d` pink (secondary). Black + white supporting. No other colors without approval.
- **Fonts:** Agharti for display (numbers, kickers, big titles). Quedora for body / sub-text. JetBrains Mono only for monospaced numerics (timer digits, score readouts).
- **Entry:** fast snap-in, 200-400ms. `cubic-bezier(.22, 1, .36, 1)` (ease-out-expo) is the go-to. Add a brief "punch" — slight overshoot at 60% then settle to 100%.
- **Hold:** the resting state should feel alive — pulsing dots, blinking colons, subtle scanlines, glowing edges. Never dead static.
- **Critical states:** for the last 10s of timers / dangerous scores, swap green → pink, pulse the box, intensify the glow. See `02-timer/index.html` `.timer.critical` for the canonical pattern.
- **Exit:** graceful 300-500ms fade + slide-out. Use `cubic-bezier(.64, 0, .78, 0)` (ease-in-quart). Never hard-cut — Chrome's iframe lifecycle will stutter and look broken.
- **60fps target:** prefer `transform` + `opacity` over animating `width`/`left`/`top`. Use `will-change` on the entry/exit element.
- **No layout thrash:** if you must animate a property that triggers reflow, isolate it inside the overlay's root `.stage` so the rest of the page is unaffected.

---

## 7. Common pitfalls

Tracked over time. Add to this list whenever you bite a new bug.

1. **Editing only `apps/web/public/...` and forgetting `KNOWLEDGE/...`.** Your change is overwritten the next sync. Always edit the KNOWLEDGE source.
2. **Forgetting to run sync after editing KNOWLEDGE.** Local preview still shows stale HTML. Either run `npm run sync:overlays` once or use `:watch`.
3. **Forgetting `background: transparent !important;` on body.** Solid canvas blocks the live video feed in OBS/vMix.
4. **Adding `cade-visible` to body's literal `class=` attribute.** The overlay shows on page load (before any postMessage). The `cade-visible` class must be set by the master gate script in response to a `show` message.
5. **Hardcoding photo paths.** Stale + breaks on roster changes. Resolve via the player slug → asset map (e.g. `processed/<slug>/headshot_01.png`). The `_assets/players/processed/` mirror is built by the sync script.
6. **Skipping the inline-style observer.** Pure-CSS opacity transitions get eaten by Chrome iframe lifecycle in cross-origin embedding (OBS browser source). Both scripts in §5e are required.
7. **Wrong asset-path prefix.** Source HTML uses `../../../<bucket>/...`; the sync rewrites to `/overlays/v2/_assets/<bucket>/...`. If you write absolute paths in the source, the sync skips them and the rewrite breaks.
8. **Schema drift.** Adding a new payload field to the HTML's postMessage handler without updating `schemas.ts` → the trigger fails Zod validation server-side. Schema first, HTML second, control component third.
9. **Per-control-card scaling math.** The `ControlCard` mini-preview is 480 × 270 (1920 × 1080 / 4) with `transform: scale(0.25)`. If the overlay assumes a different viewport size, the preview clips. Always design at 1920 × 1080.
10. **Audio NotAllowedError.** Browser autoplay policy rejects audio in iframes without user interaction. Either swallow with `.catch(() => {})` (silent overlays) or only play sounds through the operator's separate sound-slot SFX trigger.

---

## 8. Pre-deploy checklist

Run through this every change. Skip nothing.

- [ ] Edited `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` (NOT just the public mirror).
- [ ] Ran `cd apps/web && npm run sync:overlays` (or had `:watch` running).
- [ ] Previewed at `http://localhost:3030/overlays/v2/<key>/index.html` — visual sanity check.
- [ ] Triggered via `/admin/broadcast/v2/<sessionId>` — entry + hide animations clean.
- [ ] Body `<body>` tag has NO literal `cade-visible` class (default OFF).
- [ ] `background: transparent !important;` on `html, body, .stage`.
- [ ] Both visibility-gate scripts present (§5e).
- [ ] postMessage handler reads the field names that match `schemas.ts`.
- [ ] `npm run lint` clean.
- [ ] `npm run build` clean (also runs `prebuild` → sync, so any path errors surface here).
- [ ] Committed BOTH the KNOWLEDGE source AND the synced public mirror.
- [ ] Smoke-tested on prod after Vercel deploy: curl 200 + browser trigger.

---

## 9. Reference — where each piece lives

| Concern | Path |
|---|---|
| Source HTMLs | `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` |
| Public mirror | `apps/web/public/overlays/v2/<key>/index.html` |
| Sync script | `apps/web/scripts/sync-v2-overlays.mjs` |
| npm scripts | `apps/web/package.json` → `sync:overlays`, `sync:overlays:watch`, `prebuild` |
| Zod schemas | `apps/web/src/server/overlays/schemas.ts` |
| Legacy registry | `apps/web/src/server/overlays/registry.ts` |
| v2 key registry | `apps/web/src/components/broadcast/v2/overlay-keys.ts` |
| v2 → legacy map | `apps/web/src/components/broadcast/v2/template-mapping.ts` |
| Data injector | `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx` |
| Control card base | `apps/web/src/components/broadcast/v2/ControlCard.tsx` |
| Per-overlay controls | `apps/web/src/components/broadcast/v2/controls/<Name>Control.tsx` |
| Control grid | `apps/web/src/app/admin/broadcast/v2/[sessionId]/ControlGrid.tsx` |
| Server actions | `apps/web/src/app/admin/broadcast/v2/[sessionId]/actions.ts` |
| OFF-routing helpers | `apps/web/src/server/broadcast/v2/off_routing.ts` |
| Active-state probe | `apps/web/src/server/broadcast/v2/overlay_active_state.ts` |
| Realtime channel | `overlay:<sessionId>` (subscribed by `OverlayDataInjector.tsx` + `ControlGrid.tsx`) |
| Standings channel | `public:standings:<seasonId>` (data-driven overlays only) |
| Asset buckets (mirrored) | `apps/web/public/overlays/v2/_assets/{fonts,logos,Orgs,designsample,players}/` |
| Asset source | `KNOWLEDGE/brand-assets/{fonts,logos,Orgs,designsample,players}/` |
| Player processed images | `KNOWLEDGE/brand-assets/players/processed/<slug>/{headshot,card,fullbody}_NN[.nobg].png` |
| Live OBS URL | `https://<host>/overlay/v2/<key>?session=<id>&token=<token>` |
| Standalone HTML preview | `http://localhost:3030/overlays/v2/<key>/index.html` |

---

## 10. TL;DR

1. Edit `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html`.
2. `cd apps/web && npm run sync:overlays:watch` while iterating.
3. Preview at `http://localhost:3030/overlays/v2/<key>/index.html`.
4. Test trigger end-to-end at `/admin/broadcast/v2/<sessionId>`.
5. `npm run lint && npm run build` (build re-runs sync via `prebuild`).
6. Commit BOTH the KNOWLEDGE source AND the public mirror.
7. Push, wait for Vercel, smoke on prod.

The HTML is the design. The schemas are the contract. The control panel is the trigger. Keep them in sync and overlays just work.
