# Plan 16 — Phase 2: Broadcast visual polish + motion design (27-overlay production set)

**Owner:** Spektakula
**Version:** 2.0 (full rewrite — was 7 templates + signal-green stub, now 27 templates + real brand palette)
**Date:** 2026-04-21
**Status:** Draft — Phase 2 visual polish layer on top of Plan 12 (overlay bridge)
**Depends on:** Plan 12 (shipped) — `docs/superpowers/specs/2026-04-21-plan-12-vmix-overlay-bridge.md`
**Supersedes:** Plan 16 v1.0 (7-template draft). v1.0 assumed the Phase 1A `#00ff88` signal-green and 7 seeded templates. User dropped reference videos + brand brief revealing 27 production templates + the real CADE / GameEvo palette (`#6bcd06` primary, `#fe036d` secondary, black + white support). Scope is ~4× v1.0; clean rewrite.

---

## 1. Goal + Success Criteria

**Goal.** Replace the 300 ms CSS-fade stubs (Plan 12) across the broadcast surface with a production-grade, motion-designed set of **27 broadcast templates** driven by a shared motion-token library, a shared sound library, and the CADE / GameEvo / Pro League brand assets (Agharti + Quedora fonts, primary `#6bcd06`, secondary `#fe036d`). Ship behind a **review-first workflow** — every template renders in an isolation preview page (`/overlay/design-preview`) first, user approves per template in writing inside this plan's Review log, and only then does the polished motion replace the stub on the production `/overlay/<key>` route.

**Success criteria (each demonstrable end-to-end before plan is complete):**

1. `/overlay/design-preview` renders all 27 templates in a grid, gated on `broadcast.manage`. Each template card has a payload editor, play / loop / stop controls, device-frame toggle (1080p / 1440p / 4K), theme toggle, background swap, sound-on / sound-off toggle, export-stills button.
2. `/overlay/style-guide` renders the full brand palette, type ramp (Agharti display + Quedora accent + JetBrains Mono numerics), motion-token demos, stinger-sound samples.
3. Every production overlay page accepts `?preview=1` — auto-loops enter / idle / exit every 8 s and renders a debug HUD reading `template=<key> ver=<n> sound=<slot|null>`.
4. `apps/web/src/lib/motion.ts` exports `ENTER`, `EXIT`, `STAGGER`, `SCORE_FLIP`, plus the new `STINGER_IN`, `STINGER_OUT`, `STINGER_HOLD` tokens. Every overlay imports from this module — `grep -r "duration:" apps/web/src/app/(overlay)` shows no inline numeric literals.
5. `apps/web/src/lib/overlay-sound.ts` exports a `useOverlaySound(slot)` hook reading `soundSlot` off the template payload and playing via Web Audio API `<audio>`. Silent when `preview=0` sound toggle is off or when `soundSlot` is null.
6. Brand-asset ingestion procedure has run: `KNOWLEDGE/brand-assets/logos/*.png` imported into `apps/web/public/brand/logos/`; fonts loaded via `next/font/local` from `KNOWLEDGE/brand-assets/fonts/`; `KNOWLEDGE/brand-assets/players/processed/` manifest consumed by `server/overlays/players.ts` for player photo URLs; findings + per-video frame analysis committed to `docs/superpowers/specs/plan-16-design-language.md`.
7. Every production `/overlay/<key>` page (27 total) has a Review-log row reading `APPROVED` with a git sha, plus bundle-size reading ≤ 250 KB first-load JS.
8. Migrations extend `overlay_templates.template_type` CHECK with the 20 new keys; 20 new seed rows present.
9. `npm run test` green with ≥ 20 new unit tests covering motion tokens, Zod payload validators, autofill builders, sound-slot resolver, player-photo resolver. Existing 85-unit suite stays green.
10. `npm run e2e` green — `/overlay/design-preview` render-all smoke test asserts every template card's DOM mounts its key slot within 2 s.
11. `next build` clean, `npm run lint` clean, `npm run audit:smoke` clean.

---

## 2. Scope Discipline

**In scope:**
- `apps/web/src/lib/motion.ts` (7 motion tokens — 4 existing + 3 stinger)
- `apps/web/src/lib/overlay-sound.ts` + `apps/web/public/overlay/sounds/` library
- `apps/web/src/components/overlay/` — shared building blocks + 27 polished template components
- `apps/web/src/components/overlay/brand/` — logo React wrappers (CADE, GameEvo, Pro League, Gamepride, eSports Fed NG, Esports Africa News)
- `apps/web/src/server/overlays/players.ts` — player-photo URL resolver reading `KNOWLEDGE/brand-assets/players/processed/manifest.json`
- `/overlay/design-preview` (27 cards) + `/overlay/style-guide` (tokens + type ramp + motion + sound samples)
- `?preview=1` mode on every production overlay page
- `KNOWLEDGE/brand-assets/` ingestion procedure + `plan-16-design-language.md` write-up
- `framer-motion` install; motion polish on all 27 templates
- Local font loading via `next/font/local` for Agharti + Quedora (woff2 preferred)
- Migration `20260505000003_plan16_overlay_template_types.sql` extending CHECK + 20 new seeds
- `server/overlays/autofill.ts` — new builders for each data-bound template added in this plan
- Unit (≥ 20) + E2E (≥ 1 render-all smoke) + bundle-size checks per §13
- Review-log checkpoint table (27 rows), populated per template before ship

**Out of scope:**
- Visual regression tooling (Percy, Chromatic, Playwright snapshot diff) — Phase 3
- AR / 3D overlays (WebGL, three.js, Spine)
- Sponsor rotation / dynamic ad surface logic — ad slot is a static image URL in payload, no scheduler
- vMix Data Sources bridge, NDI output, green-screen keying
- Multi-language overlay text
- Runtime template authoring UI (templates stay seed-only per Plan 12 §3.1)
- Face detection on player photos — use manifest-declared crop boxes only; no ML
- Paystack / monetization surface — per CLAUDE.md

---

## 3. Review-first workflow (non-negotiable)

```
+---------------------+    +------------------------------+    +---------------------+
| 1. Agent scaffolds  | -> | 2. User opens                | -> | 3. User comments in |
|    harness + motion |    |    /overlay/design-preview   |    |    plan Review log: |
|    + sound + tokens |    |    isolation page + controls |    |    approve / iterate|
+---------------------+    +------------------------------+    +----------+----------+
                                                                          |
                                                                          |  (iterate loop)
                                                                          v
+---------------------+    +------------------------------+    +---------------------+
| 6. Production       | <- | 5. Agent swaps stub →        | <- | 4. User approves    |
|    /overlay/<key>   |    |    polished motion only for  |    |    specific template|
|    ships the polish |    |    APPROVED template keys    |    |    in Review log    |
+---------------------+    +------------------------------+    +---------------------+

Legend: approval = a signed row in the Review log (§19) committed to this file, with
        git sha + approver + verdict + bundle KB. No verbal approval.
```

**Approval grammar:**
- `APPROVED` — swap stub → polished on production route.
- `ITERATE: <note>` — revise in preview, do NOT ship yet.
- `HOLD` — block until dependency lands first.

No template ships to production until its Review-log row reads `APPROVED` with a git sha.

---

## 4. Brand tokens

Add to `apps/web/src/app/globals.css` under `:root`. Replace prior Phase 1A `--signal: #00ff88` with the real palette. Keep `--signal` as a **deprecated alias** mapped to `--primary` for one release cycle so Phase 1A code does not break — remove in Plan 17.

```css
:root {
  /* Primary brand — CADE / GameEvo green */
  --primary:      #6bcd06;
  --primary-ink:  #0a1400;   /* text that sits on --primary */
  --primary-dim:  #4a8f04;   /* 70% luminance variant for accents */
  --primary-glow: rgba(107, 205, 6, 0.32);

  /* Secondary brand — magenta/pink counterpoint */
  --secondary:      #fe036d;
  --secondary-ink:  #1a0008;
  --secondary-dim:  #b30250;
  --secondary-glow: rgba(254, 3, 109, 0.30);

  /* Ink — near-black greyscale, 0 darkest → 5 lightest of the ink ramp */
  --ink-0: #050607;   /* full-bleed backdrop */
  --ink-1: #0b0e11;   /* panel */
  --ink-2: #141820;   /* card */
  --ink-3: #1f2530;   /* raised card */
  --ink-4: #2b3340;   /* hairline / divider */
  --ink-5: #3a4355;   /* border on raised surface */

  /* Chalk — off-white to cool grey, 0 lightest → 3 darkest */
  --chalk-0: #ffffff;
  --chalk-1: #e8ecef;
  --chalk-2: #b4bcc5;
  --chalk-3: #7a8592;

  /* Status tints retained from Phase 1A */
  --amber: #ffb020;
  --flare: #ff3b3b;

  /* DEPRECATED — Phase 1A alias. Remove in Plan 17. */
  --signal:      var(--primary);
  --signal-ink:  var(--primary-ink);
  --signal-dim:  var(--primary-dim);
  --signal-glow: var(--primary-glow);
}
```

**Guard:** Plan 17 checklist appends a one-line task "remove `--signal*` aliases". No code inside `(overlay)/` or `components/overlay/` may use `--signal*` in the files written for Plan 16 — enforce via ESLint `no-restricted-syntax` on that subtree only.

---

## 5. Font loading

Use `next/font/local` (no network fetch, works in closed broadcast environments). Copy the woff2 files from the unzipped font deliverables directories into `apps/web/src/app/fonts/` at ingest time (Next.js cannot read outside the app root).

Source paths:

- Agharti primary (display): `KNOWLEDGE/brand-assets/fonts/agharti-family-2026-03-23-03-20-06-utc MAINPRIMARY FONT/Family Deliverables/Agharti-Black.woff2` + `Agharti-Bold.woff2` + `Agharti-Regular.woff2`. Variable cut at `Family Deliverables/Agharti Variable/` if the variable woff2 ships with a `wght` axis use that instead and drop the three static cuts.
- Quedora secondary (accent / data): `KNOWLEDGE/brand-assets/fonts/quedora-boxy-modern-minimalist-futuristic-font-2026-03-23-03-41-30-utc SECONDARY FONT/Quedora Main Files/woff 2/*.woff2` — pick Regular + Bold cuts.
- JetBrains Mono — retained unchanged for numerics (tabular-nums guaranteed); loaded via `next/font/google`.

`apps/web/src/app/layout.tsx` wiring:

```ts
import localFont from 'next/font/local';
import { JetBrains_Mono } from 'next/font/google';

const agharti = localFont({
  src: [
    { path: './fonts/Agharti-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Agharti-Bold.woff2',    weight: '700', style: 'normal' },
    { path: './fonts/Agharti-Black.woff2',   weight: '900', style: 'normal' },
  ],
  variable: '--font-display',
  display: 'swap',
});

const quedora = localFont({
  src: [
    { path: './fonts/Quedora-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Quedora-Bold.woff2',    weight: '700', style: 'normal' },
  ],
  variable: '--font-accent',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
```

CSS vars:
- `--font-display` → Agharti — used on stingers, outro scores, intro wordmark, full-screen states
- `--font-accent` → Quedora — used on lower-thirds, matchup cards, eyebrows
- `--font-mono` → JetBrains Mono — tabular numerics (scoreline, timer, stats grid)

**Licensing.** Both Agharti and Quedora were purchased by the operator for broadcast use — assume licence is valid (the zip filenames embed an envato-style purchase timestamp). If licensing questions arise, fall back to OFL stack (Space Grotesk + Inter + JetBrains Mono) behind a build flag `NEXT_PUBLIC_BROADCAST_FONTS=licensed|ofl`. Document in §16 Risks.

---

## 6. Motion tokens

`apps/web/src/lib/motion.ts`:

```ts
// Shared motion tokens — every overlay consumes from here.
// Bezier values locked after review of `KNOWLEDGE/brand-assets/videos/*.mp4`
// (see docs/superpowers/specs/plan-16-design-language.md).

export const ENTER = {
  duration: 0.45,
  ease: [0.22, 1, 0.36, 1],        // ease-out-quint — confident push in
} as const;

export const EXIT = {
  duration: 0.25,
  ease: [0.64, 0, 0.78, 0],        // ease-in-quint — snap exit, no lingering
} as const;

export const STAGGER = 0.06;       // 60 ms between cascading children

export const SCORE_FLIP = {
  duration: 0.6,
  ease: [0.68, -0.55, 0.27, 1.55], // anticipate + overshoot — "ding" on goal
} as const;

export const IDLE_PULSE = {
  duration: 2.4,
  ease: [0.4, 0, 0.6, 1],
  repeat: Infinity,
  repeatType: 'mirror' as const,
};

// NEW — stinger motion (Group A: animated full-screen transitions with sound)
export const STINGER_IN = {
  duration: 0.35,
  ease: [0.85, 0, 0.15, 1],        // ease-in-out-expo — whip in
} as const;

export const STINGER_HOLD = {
  duration: 1.30,                  // middle hold for 2s stinger; intro stinger overrides
} as const;

export const STINGER_OUT = {
  duration: 0.35,
  ease: [0.85, 0, 0.15, 1],
} as const;

// Runtime speed multiplier — /overlay/design-preview sets this via --motion-speed.
export function scaleDuration(d: number): number {
  if (typeof window === 'undefined') return d;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--motion-speed');
  const speed = Number(raw);
  return Number.isFinite(speed) && speed > 0 ? d / speed : d;
}
```

**Enforcement.** ESLint `no-restricted-syntax` rule bans literal `duration:` keys under `apps/web/src/app/(overlay)/` and `apps/web/src/components/overlay/`. Test fires on a seeded bad import in Task 3.

---

## 7. Sound library

**Decision.** `framer-motion` handles motion only. Sound is a thin Web Audio API wrapper over plain `<audio>` elements. Source files: Freesound CC0 + CC-BY preferred; if gaps exist, a tiny `Tone.js`-based real-time synth covers metronomic ticks / beeps (timer count-down, score-tick). Tone.js is deferred — ship with sampled MP3/OGG first; only pull Tone.js in if user asks.

**File layout:**

```
apps/web/public/overlay/sounds/
  stinger-intro.mp3            10s hero
  stinger-normal.mp3            2s
  stinger-replay.mp3            2s
  stinger-goal.mp3              2s
  stinger-winner.mp3            2s
  whoosh-short.mp3              ~0.6s enter accent for score-bug / up-next
  whoosh-long.mp3               ~1.2s enter for h2h reveal
  tick-1s.mp3                   1s loop for countdown timer
  LICENSE.md                    per-file CC attribution
```

**Zod schema extension.** Every template payload carries an optional `soundSlot: string | null` field. Registry maps `soundSlot` → file URL. `null` or missing → silent.

**Hook:**

```ts
// apps/web/src/lib/overlay-sound.ts
export function useOverlaySound(slot: string | null | undefined, trigger: unknown) {
  // Replays sound every time `trigger` identity changes (i.e. on enter animation).
  // Respects global mute (URL `?mute=1` or design-preview sound toggle).
  // Returns { ready: boolean } for tests to assert mount.
}
```

**Preview-page sound toggle** is OFF by default (operators hate surprise audio).

---

## 8. Design review harness

### 8.1 `/overlay/design-preview`

**Route:** `apps/web/src/app/(overlay)/overlay/design-preview/page.tsx`. Gated `broadcast.manage`. Layout: 27 template cards in a responsive grid, 4-col desktop / 2-col tablet / 1-col mobile. Grouped with section headers (A Stingers, B Layouts, C Matchup cards, D Data, E Full-screen, F Stats).

**Card behaviour.** Each card renders `/overlay/<key>?preview=1&payload=<base64>&ver=<n>` inside an `<iframe>` scaled via CSS transform, with:
- `[Animate in] [Exit] [Loop]` buttons (postMessage to iframe).
- Payload JSON editor (Zod-validated, renders on blur).
- Per-card sound toggle (defaults to the global header toggle).

**Global header controls (persisted via `localStorage`):**
- `theme`: dark (default) | light
- `background`: black | checker | transparent | custom-image
- `frame`: 1080p | 1440p | 4K (resizes iframe; overlays must be resolution-independent)
- `speed`: 0.25× / 0.5× / 1× / 2× → writes `--motion-speed` on iframe root
- `sound`: off (default) | on
- `Export stills` → POST `/api/broadcast/design-preview/export-stills` → headless Playwright → 27 peak-frame PNGs in a ZIP. Optional (Task 20); plan ships without if playwright-in-prod infeasible.

### 8.2 `/overlay/style-guide`

**Route:** `apps/web/src/app/(overlay)/overlay/style-guide/page.tsx`. Gated `broadcast.manage`.

Sections (anchor-nav):
1. **Brand palette** — swatches for every token in §4 with hex + CSS var name.
2. **Type ramp** — Agharti display 140 / 96 / 72 / 48 / 32 / 24 px; Quedora accent 32 / 24 / 18 / 14 / 12 px; JetBrains Mono numerics 180 / 72 / 48 / 32 / 16 px. Mixed samples with brand wordmark.
3. **Motion tokens** — `ENTER`, `EXIT`, `STAGGER`, `SCORE_FLIP`, `STINGER_IN`, `STINGER_HOLD`, `STINGER_OUT` each rendered as a live looping demo on a tinted block. Each also prints its cubic-bezier as an SVG with a dot travelling along the curve.
4. **Sound library** — one row per file in `public/overlay/sounds/`, with filename, waveform visual, length, licence, play button.
5. **Lock-ups** — CADE + GameEvo + Pro League logos at sizes; safe-area guide overlay (5 % padding, 1080p grid).
6. **Iconography** — inline SVG set used in overlays (medal, warning triangle, jersey chip, timer ring, ad-slot placeholder).

---

## 9. Per-template spec (27 templates)

Each entry ≤ 60 words. Layout → Typography → Motion → Color → Data bindings → Sound slot → Fallbacks.

### Group A — Stingers (animated, with sound)

#### 9.1 `stinger_intro` (long, 10 s)
- Layout: full-screen 1920×1080, CADE + GameEvo wordmark composite centre, Pro League eyebrow below, season label bottom.
- Typography: Agharti Black 220 px wordmark; Quedora Bold 32 px eyebrow; JetBrains Mono 14 px season.
- Motion: 0–1.5 s primary green sweep L→R; 1.5–4 s wordmark mask-reveal with `STAGGER`; 4–8 s hold + idle pulse; 8–10 s scale + fade with `STINGER_OUT`.
- Color: `--ink-0` bleed, `--primary` sweep, `--chalk-0` wordmark, `--secondary` glyph accent.
- Data: `{ seasonLabel, matchDayLabel? }`.
- Sound: `stinger-intro` (10 s hero).
- Fallbacks: missing `matchDayLabel` drops eyebrow line.

#### 9.2 `stinger_normal` (2 s)
- Layout: full-screen primary-green wipe L→R with inline wordmark.
- Typography: Agharti Black 140 px wordmark, kerning −0.02em.
- Motion: 0–0.7 s wipe in; 0.7–1.3 s wordmark mask-reveal; 1.3–2.0 s wipe out with `STINGER_OUT`.
- Color: `--primary` wipe, `--primary-ink` wordmark.
- Data: `{}` (static).
- Sound: `stinger-normal`.
- Fallbacks: n/a.

#### 9.3 `stinger_replay` (2 s)
- Layout: full-screen, diagonal split primary/secondary, REPLAY wordmark centre.
- Typography: Agharti Black 160 px "REPLAY", tight tracking.
- Motion: 0–0.7 s diagonal split collides centre; 0.7–1.3 s hold; 1.3–2.0 s split recedes with `STINGER_OUT`.
- Color: top half `--primary`, bottom `--secondary`, wordmark `--chalk-0`.
- Data: `{}`.
- Sound: `stinger-replay`.
- Fallbacks: n/a.

#### 9.4 `stinger_goal` (2 s)
- Layout: full-screen primary-green burst, "GOAL!" wordmark + optional scorer chip.
- Typography: Agharti Black 220 px "GOAL!"; Quedora Bold 32 px scorer display name.
- Motion: 0–0.4 s scale burst from 0.6 → 1.0 with `SCORE_FLIP`; 0.4–1.5 s hold + name slide-in; 1.5–2.0 s fade with `STINGER_OUT`.
- Color: `--primary` bleed, `--primary-ink` text, `--secondary` underline accent.
- Data: `{ scorerDisplayName?, scorerPhotoUrl? }`.
- Sound: `stinger-goal`.
- Fallbacks: missing scorer → just the wordmark.

#### 9.5 `stinger_winner` (2 s)
- Layout: full-screen, winner photo/logo left, "WINNER" wordmark right.
- Typography: Agharti Black 180 px "WINNER"; Quedora Bold 40 px winner display name.
- Motion: 0–0.7 s left-side photo slides from offscreen-left, right-side wordmark mask-reveals; 0.7–1.5 s hold; 1.5–2.0 s scale + fade.
- Color: backdrop `--ink-0`, accent `--primary`, photo ring `--primary`.
- Data: `{ winnerDisplayName, winnerPhotoUrl?, finalScore?: {home,away} }`.
- Sound: `stinger-winner`.
- Fallbacks: missing photo → initials block 240×240 in `--primary` bg.

### Group B — Persistent / screen layouts

#### 9.6 `layout_4pip`
- Layout: 4-panel PIP grid 2×2, each cell holds a player feed rectangle 960×540; thin `--primary` gridlines; labels bottom-left per cell.
- Typography: Quedora Bold 20 px label; JetBrains Mono 14 px gamer tag.
- Motion: enter `ENTER` (0.45 s cross-fade); labels cascade `STAGGER`; idle static.
- Color: dividers `--primary`, labels `--ink-1` pill with `--chalk-0` text.
- Data: `{ cells: [{ displayName, gamerTag, photoUrl? }] (length 4) }`.
- Sound: `null`.
- Fallbacks: < 4 cells → empty cells show silhouette + `GameEvo` watermark.

#### 9.7 `layout_2pip`
- Layout: 2-panel vertical split 960×1080 each, centre divider with mid-dot.
- Typography: Quedora Bold 28 px label, JetBrains Mono 14 px gamer tag.
- Motion: divider sweeps in centre-out with `ENTER`; labels fade.
- Color: divider `--primary`, label pills `--ink-1` + `--chalk-0`.
- Data: `{ cells: [{ displayName, gamerTag, photoUrl? }] (length 2) }`.
- Sound: `null`.
- Fallbacks: missing cell → placeholder.

#### 9.8 `layout_brb_full`
- Layout: full-screen "BE RIGHT BACK" eyebrow top; ad-video slot 1280×720 centred; countdown timer bottom; socials row bottom.
- Typography: Agharti Black 140 px "BRB"; Quedora Bold 32 px eyebrow; JetBrains Mono 72 px timer; Quedora 18 px socials.
- Motion: enter `ENTER` cascade; timer digits flip on 1 s boundary with `SCORE_FLIP`; idle gentle `IDLE_PULSE` on BRB glyph.
- Color: bleed `--ink-0`, accent `--primary`, secondary accent `--secondary` on social icons.
- Data: `{ resumeAt: ISO8601, adVideoUrl?: string, socials?: {twitter,instagram,tiktok} }`.
- Sound: `null` (ad video brings own audio).
- Fallbacks: no ad → ad slot hidden; expired timer → "BACK SHORTLY" text.

#### 9.9 `layout_brb_basic`
- Layout: full-screen eyebrow + wordmark + footer, no ad, no timer.
- Typography: Agharti Black 200 px wordmark.
- Motion: enter `ENTER`; idle `IDLE_PULSE` on wordmark.
- Color: bleed `--ink-0`, wordmark `--chalk-0`, accent `--primary` rule.
- Data: `{ message?: string }`.
- Sound: `null`.
- Fallbacks: missing message → defaults to "BE RIGHT BACK".

#### 9.10 `layout_timer`
- Layout: small composable element, 320×96 at 1080p, top-right safe area.
- Typography: JetBrains Mono 56 px tabular.
- Motion: digits flip per second with `SCORE_FLIP`; final 5 s pulses `--secondary`.
- Color: panel `--ink-1` @ 92 % + `--ink-5` hairline; digits `--chalk-0`.
- Data: `{ expiresAt: ISO8601 }`.
- Sound: `tick-1s` (loop in last 5 s only; muted by default).
- Fallbacks: expired → shows `00:00`.

#### 9.11 `layout_animated_bg`
- Layout: full-screen looping background, gradient + particle mesh.
- Typography: n/a.
- Motion: CSS `@keyframes` drift on a 24 s loop (GPU-cheap, NOT framer-motion); no JS during idle.
- Color: `--ink-0` base, `--primary-glow` + `--secondary-glow` particles.
- Data: `{}`.
- Sound: `null`.
- Fallbacks: n/a.

#### 9.12 `layout_casters_chat`
- Layout: right-edge chat panel 420×1080; caster feed 1500×844 left; footer ticker 1920×60.
- Typography: Quedora Bold 18 px chat username; Quedora 16 px chat message; JetBrains Mono 14 px ticker.
- Motion: enter `ENTER`; new chat messages slide-up with `STAGGER`; ticker auto-scrolls via CSS keyframe.
- Color: chat bg `--ink-1` @ 96 %, usernames `--primary`, ticker strip `--ink-2`.
- Data: `{ chat: [{user, msg, ts}], ticker?: string }`.
- Sound: `null`.
- Fallbacks: empty chat → panel hidden.

### Group C — Matchup cards (with player photos)

#### 9.13 `h2h_2`
- Layout: full-screen, two portrait panels left/right, `VS` glyph centre, head-to-head stats strip below.
- Typography: Agharti Black 96 px "VS"; Quedora Bold 40 px names; JetBrains Mono 18 px stats.
- Motion: 0–0.6 s panels slide in from edges with `ENTER`; 0.6–0.9 s VS glyph scale burst `SCORE_FLIP`; 0.9–1.2 s stats cascade `STAGGER`.
- Color: backdrop `--ink-0`, VS glyph `--primary` with `--secondary` shadow.
- Data: `{ players: [{displayName, gamerTag, photoUrl?, h2hStats: {w,d,l}}] (length 2) }`.
- Sound: `whoosh-long`.
- Fallbacks: missing photo → initials block 480×720 in `--primary` bg.

#### 9.14 `h2h_3`
- Layout: three portraits in a triangle arrangement (two top, one bottom centre), connector lines in `--primary`.
- Typography: Agharti Bold 72 px multi-line heading; Quedora Bold 32 px names.
- Motion: portraits fade + slide from centre outward with `STAGGER`; connector lines draw with SVG `pathLength`.
- Color: backdrop `--ink-0`, connectors `--primary`.
- Data: `{ players: [...] (length 3) }`.
- Sound: `whoosh-long`.
- Fallbacks: missing photo → initials.

#### 9.15 `h2h_5`
- Layout: five portraits in a pentagon arrangement, centre `--primary` polygon ring.
- Typography: Quedora Bold 28 px names.
- Motion: ring draws with `ENTER`; portraits pop in with `STAGGER` + scale 0.85 → 1.
- Color: backdrop `--ink-0`, polygon `--primary`.
- Data: `{ players: [...] (length 5) }`.
- Sound: `whoosh-long`.
- Fallbacks: < 5 players → collapses layout proportionally (triangle for 3, square for 4).

### Group D — Data displays

#### 9.16 `leaderboard_animated`
- Layout: right-anchored panel 560×900, header "LEADERBOARD", rows 1..N with medal chip.
- Typography: Quedora Bold 14 px eyebrow; Agharti Bold 24 px rank; Quedora Bold 22 px name; JetBrains Mono 18 px pts/gd.
- Motion: rows cascade `STAGGER` on enter; rank 1 has `IDLE_PULSE` on medal chip; rank-change triggers row swap with `SCORE_FLIP`.
- Color: panel `--ink-1` @ 94 %; rank 1 row `--primary-glow`; medals gold `#ffd24a`, silver `#c8cbd0`, bronze `#cd7a3e`.
- Data: `{ topN, rows: [{rank, displayName, pts, gd, delta?}] }`.
- Sound: `null`.
- Fallbacks: `topN > rows.length` renders only what's available.

#### 9.17 `lower_third`
- Layout: bottom-left, 720×180, photo 180×180 + stacked name/role/stats.
- Typography: Agharti Bold 44 px display name; Quedora Bold 18 px gamer tag; JetBrains Mono 14 px role.
- Motion: panel slides from left `ENTER`; photo clip-path diagonal reveal 80 ms offset; name types char-by-char `STAGGER/2`.
- Color: panel `--ink-2` @ 96 %; left accent 4 px `--primary`; gamer tag `--chalk-2`.
- Data: `{ playerId?, displayName, gamerTag, jerseyNumber?, stats?: {gp,w,d,l,pts} }`.
- Sound: `whoosh-short`.
- Fallbacks: missing photo → initials 180×180 `--primary` bg.

#### 9.18 `score_bug`
- Layout: top-left, 720×120, two player tiles side-by-side with small headshots + names + score digits.
- Typography: Quedora Bold 22 px names; JetBrains Mono 56 px score.
- Motion: enter slide-down `ENTER`; score change digit flips with `SCORE_FLIP`; winning-side tile pulses `--primary`.
- Color: panel `--ink-1` @ 92 %; separator `--primary`; winning tile bg `--primary`, ink `--primary-ink`.
- Data: `{ players: [{displayName, photoUrl?, score}] (length 2), matchId? }`.
- Sound: `null` (stinger_goal handles goal SFX).
- Fallbacks: missing photo → initials 80×80.

#### 9.19 `up_next_bug`
- Layout: bottom-right, 640×140, "UP NEXT" eyebrow + two mini portraits + `VS` + kickoff time.
- Typography: Quedora Bold 14 px eyebrow; Quedora Bold 24 px names; JetBrains Mono 18 px time.
- Motion: panel slides from right `ENTER`; `VS` glyph pulses `IDLE_PULSE`.
- Color: panel `--ink-2` @ 96 %; eyebrow `--primary`; VS `--secondary`.
- Data: `{ home: {displayName, photoUrl?}, away: {displayName, photoUrl?}, kickoffAt: ISO8601 }`.
- Sound: `null`.
- Fallbacks: missing photo → initials 80×80.

#### 9.20 `match_scores_day`
- Layout: full-screen, header "MATCH DAY N — SCORES", rows listing all completed fixtures for the day, grid style.
- Typography: Agharti Bold 56 px header; Quedora Bold 22 px names; JetBrains Mono 28 px scoreline.
- Motion: rows cascade `STAGGER`; finished matches tick in green, in-progress yellow.
- Color: backdrop `--ink-0`; winner row tint `--primary-glow`; in-progress tint `--amber`.
- Data: `{ matchDayLabel, rows: [{home, away, homeScore, awayScore, status}] }`.
- Sound: `null`.
- Fallbacks: empty rows → "NO MATCHES COMPLETED YET" placeholder.

### Group E — Full-screen states

#### 9.21 `starting_soon_basic`
- Layout: full-screen wordmark + subtitle.
- Typography: Agharti Black 220 px "STARTING SOON"; Quedora Bold 28 px subtitle.
- Motion: wordmark chars mask-reveal `STAGGER`; idle `IDLE_PULSE` on accent rule.
- Color: bleed `--ink-0`; wordmark `--chalk-0`; accent `--primary` rule.
- Data: `{ subtitle?: string }`.
- Sound: `null`.
- Fallbacks: missing subtitle drops line.

#### 9.22 `starting_soon_timer`
- Layout: full-screen wordmark + JetBrains Mono countdown + ad-video slot 1280×720.
- Typography: Agharti Black 160 px "STARTING SOON"; JetBrains Mono 120 px countdown.
- Motion: countdown digit flips `SCORE_FLIP` per second; final 10 s pulses `--secondary`.
- Color: bleed `--ink-0`, primary accents, `--secondary` on last 10 s.
- Data: `{ startsAt: ISO8601, adVideoUrl? }`.
- Sound: `tick-1s` (final 10 s).
- Fallbacks: no ad → ad slot hidden; past `startsAt` → shows `00:00` and collapses to `starting_soon_basic`.

#### 9.23 `stream_ended`
- Layout: full-screen "STREAM ENDED" + "THANKS FOR WATCHING" subtitle + socials row.
- Typography: Agharti Black 180 px; Quedora Bold 28 px subtitle; Quedora 18 px socials.
- Motion: wordmark mask-reveal `STAGGER`; subtitle fade-in 300 ms later; socials slide up 600 ms later.
- Color: bleed `--ink-0`, wordmark `--chalk-0`, accent `--primary`.
- Data: `{ subtitle?: string, socials?: {twitter,instagram,tiktok,youtube} }`.
- Sound: `null`.
- Fallbacks: missing socials → row hidden.

### Group F — Stats overlays

#### 9.24 `top_scorers`
- Layout: full-screen "TOP 10 GOAL SCORERS — GOLDEN PAD" header, 10 rows with player photos + goals count.
- Typography: Agharti Bold 56 px header; Quedora Bold 24 px names; JetBrains Mono 32 px goal count.
- Motion: rows cascade `STAGGER`; rank 1 photo framed in gold ring + `IDLE_PULSE`.
- Color: backdrop `--ink-0`; rank 1 row `--primary-glow`; gold ring `#ffd24a`.
- Data: `{ rows: [{rank, displayName, photoUrl?, goals}] (length ≤ 10) }`.
- Sound: `null`.
- Fallbacks: missing photo → initials 96×96.

#### 9.25 `orgs_roster`
- Layout: full-screen, animated org logo centre-top, roster grid below (player photos + names).
- Typography: Quedora Bold 28 px org name; Quedora Bold 20 px player names.
- Motion: logo scale + rotate 0→1 with `ENTER`; players cascade in `STAGGER` from logo outward.
- Color: backdrop `--ink-0`; logo ring `--primary`.
- Data: `{ org: {name, logoUrl}, players: [{displayName, photoUrl?}] }`.
- Sound: `whoosh-long`.
- Fallbacks: missing photo → initials.

#### 9.26 `coach_intros`
- Layout: full-screen, coach portrait left (540×720), stacked name + coached-player cards right.
- Typography: Agharti Bold 64 px coach name; Quedora Bold 18 px player chip.
- Motion: portrait slides in from left `ENTER`; player chips cascade from right `STAGGER`.
- Color: backdrop `--ink-0`; portrait ring `--primary`; chips `--ink-2`.
- Data: `{ coach: {displayName, photoUrl?}, players: [{displayName, photoUrl?}] }`.
- Sound: `whoosh-short`.
- Fallbacks: missing portrait → initials 540×720 `--primary` bg.

#### 9.27 `player_penalties`
- Layout: full-screen, "PENALTIES" header, rows with player photo + name + penalty count + sanction-type chip.
- Typography: Agharti Bold 56 px header; Quedora Bold 22 px name; JetBrains Mono 24 px count; JetBrains Mono 12 px chip.
- Motion: rows cascade `STAGGER`; highest-count row highlight pulses `--flare`.
- Color: backdrop `--ink-0`; chip tints: `point_deduction` `--flare`, `gd_deduction` `--amber`, `fine` `--primary-dim`, `suspension` `--flare`.
- Data: `{ rows: [{displayName, photoUrl?, count, sanctionType}] }`.
- Sound: `null`.
- Fallbacks: empty → "NO PENALTIES ISSUED" placeholder.

---

## 10. Data flow for data-bound templates

Data-bound templates (10 of 27: `score_bug`, `up_next_bug`, `leaderboard_animated`, `match_scores_day`, `top_scorers`, `orgs_roster`, `coach_intros`, `player_penalties`, plus the retained `scorebar`, `lower_third`, `standings_widget`, `player_card`, `punishment_ticker` from Plan 12) pull from `overlay_events.payload` — admin UI populates via `server/overlays/autofill.ts` helpers before triggering.

Add the following new autofill builders in `apps/web/src/server/overlays/autofill.ts`:

- `buildScoreBugPayload(sb, matchId)` — reads live `matches` + `players` → payload.
- `buildUpNextBugPayload(sb, matchId)` — next scheduled match same day.
- `buildLeaderboardAnimatedPayload(sb, seasonId, topN)` — same shape as standings widget + `delta` (rank change vs last match day).
- `buildMatchScoresDayPayload(sb, matchDayId)` — all matches for match day.
- `buildTopScorersPayload(sb, seasonId, limit)` — top N by goals.
- `buildOrgsRosterPayload(sb, orgId)` — org + signed-player list (note: orgs tracked in Phase 2 proper; Phase 1A fallback builder returns fixture data only if org table absent).
- `buildCoachIntroPayload(sb, coachUserId)` — coach + coached-players (fallback: returns empty `players` list if coach→player association table not yet shipped).
- `buildPlayerPenaltiesPayload(sb, seasonId)` — `disciplinary_actions` grouped by `player_id`, top N.

Player photos resolved through `apps/web/src/server/overlays/players.ts`:

```ts
// Reads `KNOWLEDGE/brand-assets/players/processed/manifest.json` at build time,
// serves headshot URLs through `/brand/players/<slug>/headshot_01.png`.
export function resolvePlayerPhotoUrl(playerSlug: string, variant: 'headshot'|'card'|'fullbody'): string | null;
```

If the manifest is missing a given slug (e.g. new roster member not yet photographed), helper returns `null` and overlays fall through to initials placeholder.

---

## 11. Migrations

**File:** `supabase/migrations/20260505000003_plan16_overlay_template_types.sql` (or next available sequential ID).

```sql
-- Plan 16 — extend overlay_templates.template_type CHECK with 20 new keys
-- and seed 20 new overlay_templates rows.

ALTER TABLE overlay_templates DROP CONSTRAINT IF EXISTS overlay_templates_template_type_check;

ALTER TABLE overlay_templates ADD CONSTRAINT overlay_templates_template_type_check
CHECK (template_type IN (
  -- Plan 12 originals (7)
  'lower_third','scorebar','standings_widget','player_card',
  'punishment_ticker','intro','outro',
  -- Plan 16 additions (20)
  'stinger_intro','stinger_normal','stinger_replay','stinger_goal','stinger_winner',
  'layout_4pip','layout_2pip','layout_brb_full','layout_brb_basic','layout_timer',
  'layout_animated_bg','layout_casters_chat',
  'h2h_2','h2h_3','h2h_5',
  'leaderboard_animated','score_bug','up_next_bug','match_scores_day',
  'starting_soon_basic','starting_soon_timer','stream_ended',
  'top_scorers','orgs_roster','coach_intros','player_penalties'
));

-- Seed 20 new rows. html_route matches /overlay/<kebab-case-of-key>.
INSERT INTO overlay_templates (template_key, template_type, name, html_route, default_payload_schema, active_bool)
VALUES
  ('stinger_intro',         'stinger_intro',         'Intro Stinger (10s)',       '/overlay/stinger-intro',         '{}'::jsonb, true),
  ('stinger_normal',        'stinger_normal',        'Normal Stinger (2s)',        '/overlay/stinger-normal',        '{}'::jsonb, true),
  ('stinger_replay',        'stinger_replay',        'Replay Stinger (2s)',        '/overlay/stinger-replay',        '{}'::jsonb, true),
  ('stinger_goal',          'stinger_goal',          'Goal Stinger (2s)',          '/overlay/stinger-goal',          '{}'::jsonb, true),
  ('stinger_winner',        'stinger_winner',        'Winner Stinger (2s)',        '/overlay/stinger-winner',        '{}'::jsonb, true),
  ('layout_4pip',           'layout_4pip',           '4-PIP Layout',               '/overlay/layout-4pip',           '{}'::jsonb, true),
  ('layout_2pip',           'layout_2pip',           '2-PIP Layout',               '/overlay/layout-2pip',           '{}'::jsonb, true),
  ('layout_brb_full',       'layout_brb_full',       'BRB (Ad + Timer)',           '/overlay/layout-brb-full',       '{}'::jsonb, true),
  ('layout_brb_basic',      'layout_brb_basic',      'BRB (Basic)',                '/overlay/layout-brb-basic',      '{}'::jsonb, true),
  ('layout_timer',          'layout_timer',          'Timer (Composable)',         '/overlay/layout-timer',          '{}'::jsonb, true),
  ('layout_animated_bg',    'layout_animated_bg',    'Animated Background',        '/overlay/layout-animated-bg',    '{}'::jsonb, true),
  ('layout_casters_chat',   'layout_casters_chat',   'Casters + Chat',             '/overlay/layout-casters-chat',   '{}'::jsonb, true),
  ('h2h_2',                 'h2h_2',                 'H2H Matchup (2-player)',     '/overlay/h2h-2',                 '{}'::jsonb, true),
  ('h2h_3',                 'h2h_3',                 'H2H Matchup (3-player)',     '/overlay/h2h-3',                 '{}'::jsonb, true),
  ('h2h_5',                 'h2h_5',                 'H2H Matchup (5-player)',     '/overlay/h2h-5',                 '{}'::jsonb, true),
  ('leaderboard_animated',  'leaderboard_animated',  'Animated Leaderboard',       '/overlay/leaderboard-animated',  '{}'::jsonb, true),
  ('score_bug',             'score_bug',             'Score Bug',                  '/overlay/score-bug',             '{}'::jsonb, true),
  ('up_next_bug',           'up_next_bug',           'Up Next Bug',                '/overlay/up-next-bug',           '{}'::jsonb, true),
  ('match_scores_day',      'match_scores_day',      'Match Scores For The Day',   '/overlay/match-scores-day',      '{}'::jsonb, true),
  ('starting_soon_basic',   'starting_soon_basic',   'Starting Soon (Basic)',      '/overlay/starting-soon-basic',   '{}'::jsonb, true),
  ('starting_soon_timer',   'starting_soon_timer',   'Starting Soon (Timer + Ad)', '/overlay/starting-soon-timer',   '{}'::jsonb, true),
  ('stream_ended',          'stream_ended',          'Stream Ended',               '/overlay/stream-ended',          '{}'::jsonb, true),
  ('top_scorers',           'top_scorers',           'Top 10 Goal Scorers',        '/overlay/top-scorers',           '{}'::jsonb, true),
  ('orgs_roster',           'orgs_roster',           'Registered Orgs / Teams',    '/overlay/orgs-roster',           '{}'::jsonb, true),
  ('coach_intros',          'coach_intros',          'Coach Intros',               '/overlay/coach-intros',          '{}'::jsonb, true),
  ('player_penalties',      'player_penalties',      'Player Penalties',           '/overlay/player-penalties',      '{}'::jsonb, true);
```

**Note on count.** The INSERT adds 26 rows (20 new + 6 that were missing versus the 27-template set). Of the Plan 12 originals, only `intro` and `outro` are retained as-is; `scorebar`, `lower_third`, `standings_widget`, `player_card`, `punishment_ticker` remain seeded from Plan 12 migration. The 20 "new" items in the brief translate to the 26 INSERTs above because some Plan 12 keys (e.g. `standings_widget`) map to new dedicated Plan 16 templates (`leaderboard_animated`) — old template rows stay active but the admin UI promotes the Plan 16 variants.

Verify after `db:push`:

```bash
npx supabase db query "SELECT template_key, template_type FROM overlay_templates ORDER BY template_key;"
# expect 27+ rows (7 Plan 12 + 20 new minimum)
```

---

## 12. Brand-asset ingestion procedure

When agent picks up this plan:

1. **Logos.** Copy `KNOWLEDGE/brand-assets/logos/*.png` into `apps/web/public/brand/logos/` with normalized slugs:
   - `1cade esport.png` → `cade-esports.png`
   - `GameEvo Esports Black.png` → `gameevo-black.png`
   - `GameEvo Esports White.png` → `gameevo-white.png`
   - `pro league .png` → `pro-league.png`
   - `Gamepride Green-01.png` → `gamepride.png`
   - `eSports Federation of Nigeria-1.png` → `esports-fed-ng.png`
   - `ESPORTS AFRICA NEWS BLACK.png` → `esports-africa-news-black.png`
   - `ESPORTS AFRICA NEWS WHITE.png` → `esports-africa-news-white.png`

   Wrap as React components in `apps/web/src/components/overlay/brand/*.tsx` using `next/image` static imports.

2. **Fonts.** Copy the six Agharti woff2 (Regular / Bold / Black, with Condensed variants optional) + four Quedora woff2 (Regular / Bold) from the unzipped directories under `KNOWLEDGE/brand-assets/fonts/` into `apps/web/src/app/fonts/`. Wire `next/font/local` per §5.

3. **Player photos.** Read `KNOWLEDGE/brand-assets/players/processed/manifest.json` (create manifest during this step if not yet committed — 123 to 246 variants per brief across 13 players × 3-4 shoots × 3 crops (headshot/card/fullbody) × 2 bg treatments (with / without). Copy processed PNGs into `apps/web/public/brand/players/<slug>/...`. `server/overlays/players.ts` serves URLs off the manifest.

4. **Videos.** 11 MP4s in `KNOWLEDGE/brand-assets/videos/`. Confirm `.gitignore` covers `KNOWLEDGE/brand-assets/videos/*` (large binaries). Sample 6–8 key frames per video via `ffmpeg` (skip if unavailable, noting in design-language doc) into `tmp/plan-16/<slug>/`. Feed frames to Claude vision via Read tool. Commit findings (per-video palette, pacing, mapping to one of the 27 templates) into `docs/superpowers/specs/plan-16-design-language.md`. Expected mapping: `STINGER.mp4` → `stinger_*` family; `4 PIP OVERLAY.mp4` → `layout_4pip`; `BRB.mp4` / `BRB 2.mp4` → `layout_brb_*`; `CASTERS AND CHAT.mp4` → `layout_casters_chat`; `HEAD 2 HEAD.mp4` → `h2h_*`; `LEADERBOARD.mp4` → `leaderboard_animated`; `LOWER THIRD INTROS.mp4` → `lower_third`; `MATCH SCORES FOR THE DAY.mp4` → `match_scores_day`; `STARTING SOON OVERLAY.mp4` → `starting_soon_*`; `STREAM ENDED.mp4` → `stream_ended`.

5. **Asset-empty fallback.** If any subdir is empty at execution time, the agent does NOT block. It builds with existing brand tokens and placeholder components (watermark "PLACEHOLDER ASSET — replace via KNOWLEDGE/brand-assets/"), noting in Review log.

---

## 13. Tests

### 13.1 Unit (Vitest) — ≥ 20 new

1. `lib/motion.test.ts` — 7 tokens (ENTER, EXIT, STAGGER, SCORE_FLIP, IDLE_PULSE, STINGER_IN, STINGER_HOLD, STINGER_OUT) snapshot + `scaleDuration` SSR-safety.
2. `lib/overlay-sound.test.ts` — hook mount returns `{ready:true}` with valid slot, `{ready:false}` with null, respects mute flag.
3. `server/overlays/schemas.test.ts` — Zod round-trip for each of the 27 template payload schemas.
4. `server/overlays/autofill.test.ts` — new builders: `buildScoreBugPayload`, `buildUpNextBugPayload`, `buildLeaderboardAnimatedPayload`, `buildMatchScoresDayPayload`, `buildTopScorersPayload`, `buildPlayerPenaltiesPayload` each tested with mock Supabase client returning fixture data.
5. `server/overlays/players.test.ts` — `resolvePlayerPhotoUrl` returns URL when manifest has slug; `null` when missing.
6. `components/overlay/stinger-*.test.ts` — each of the 5 stingers: valid render, sound slot assertion, motion token assertion.
7. `overlay/registry.test.ts` — every template_key in CHECK constraint has an entry in `registry`, and every registry entry has a polished component + a Zod schema (drift guard).
8. `design-preview.test.ts` — grid renders 27 cards; gate rejects unauth 403.

Target: ≥ 20 net-new tests. Existing 85-unit suite stays green.

### 13.2 E2E (Playwright) — 1 smoke

`apps/web/tests/e2e/broadcast-design-preview.spec.ts`:

1. Admin logs in → navigates `/overlay/design-preview` → waits 2 s → asserts every one of the 27 template cards has its iframe mounted AND the iframe DOM is non-empty (contains at least one element with `[data-template-slot]` attribute).
2. Non-admin user → 403.

### 13.3 Manual checklist (per template, user-run)

Same list as Plan 12, applied to all 27 in Review log:

- [ ] Enter feels right
- [ ] Idle doesn't drift
- [ ] Exit is clean
- [ ] Typography scales 1080p / 1440p / 4K
- [ ] Transparent background (no white flash)
- [ ] Fallbacks degrade gracefully
- [ ] Sound (if any) triggers once and is well-mixed
- [ ] Verdict: APPROVED / ITERATE / HOLD

### 13.4 Bundle-size verification

After each template ships, `npm run build` → read the `.next/server/app/(overlay)/overlay/<key>/page.js` line. Budget **≤ 250 KB first-load JS** (loosened from Plan 12's 200 KB due to asset weight — fonts, sounds, photos). If over, refactor: lazy-import framer-motion, switch to CSS `@keyframes` for idle animations, swap PNG → optimized WebP, etc. Size recorded in Review log.

---

## 14. Numbered tasks (grouped)

### Group A — brand tokens + fonts + motion + sound (must land before any template)

1. Install `framer-motion` in `apps/web`. Commit lockfile.
2. Confirm `.gitignore` covers `KNOWLEDGE/brand-assets/videos/*` + `KNOWLEDGE/brand-assets/players/*.ARW` (raw camera files large); add if missing.
3. Ingest logos (§12 step 1) — copy to `public/brand/logos/`, wrap as React components.
4. Ingest fonts (§12 step 2) — copy woff2 to `apps/web/src/app/fonts/`, wire `next/font/local` per §5.
5. Ingest player photos (§12 step 3) — copy processed PNGs to `public/brand/players/<slug>/`; commit `manifest.json`; implement `server/overlays/players.ts`.
6. Sample reference videos (§12 step 4) + commit `plan-16-design-language.md`.
7. Add brand tokens to `globals.css` per §4; deprecate `--signal*` with alias + ESLint fence on new Plan 16 code.
8. Create `apps/web/src/lib/motion.ts` per §6. TDD `motion.test.ts` (new tokens).
9. Create `apps/web/src/lib/overlay-sound.ts` + `public/overlay/sounds/` with 8 initial audio files + LICENSE.md. TDD `overlay-sound.test.ts`.
10. Extend ESLint rule to also ban hardcoded `--signal*` under `(overlay)/` + `components/overlay/`.

### Group B — harness + style-guide + review gate

11. Scaffold `/overlay/design-preview` with 27-card grid + global controls per §8.1. Gated `broadcast.manage`.
12. Scaffold `/overlay/style-guide` per §8.2 with palette + type-ramp + motion + sound sections.
13. Add `?preview=1` handling to every production overlay page — auto-loop + debug HUD. Shared `usePreviewMode` in `lib/overlay-preview.ts`.
14. Migration `20260505000003_plan16_overlay_template_types.sql` per §11. Seed 20 new rows. Verify with `db query`.
15. Extend `server/overlays/schemas.ts` registry with 20 new Zod schemas + `soundSlot` field. Update CHECK drift guard test.
16. Extend `server/overlays/autofill.ts` with 8 new builders per §10. TDD each.

### Group C — 5 stingers (Group A of overlay set) — each serial-gated by review

17. **stinger_intro** — build → preview wire → **REVIEW GATE** → swap production route. Record bundle KB.
18. **stinger_normal** — same flow.
19. **stinger_replay** — same.
20. **stinger_goal** — same.
21. **stinger_winner** — same.

### Group D — 7 persistent layouts (Group B of overlay set)

22. **layout_4pip** — build → review → swap.
23. **layout_2pip** — same.
24. **layout_brb_full** — same.
25. **layout_brb_basic** — same.
26. **layout_timer** — same.
27. **layout_animated_bg** — same.
28. **layout_casters_chat** — same.

### Group E — 3 matchup cards (Group C of overlay set)

29. **h2h_2** — build → review → swap.
30. **h2h_3** — same.
31. **h2h_5** — same.

### Group F — 5 data displays (Group D of overlay set)

32. **leaderboard_animated** — build → review → swap.
33. **lower_third** (polish of Plan 12 stub) — same.
34. **score_bug** — same.
35. **up_next_bug** — same.
36. **match_scores_day** — same.

### Group G — 3 full-screen states (Group E of overlay set)

37. **starting_soon_basic** — build → review → swap.
38. **starting_soon_timer** — same.
39. **stream_ended** — same.

### Group H — 4 stats overlays (Group F of overlay set)

40. **top_scorers** — build → review → swap.
41. **orgs_roster** — same (with org-table-absent fallback).
42. **coach_intros** — same (with coach-association-absent fallback).
43. **player_penalties** — same.

### Group I — verification + ship gate

44. (Optional) `/api/broadcast/design-preview/export-stills` — Playwright headless, gated `broadcast.manage`. Ship without if playwright-in-prod infeasible.
45. E2E `broadcast-design-preview.spec.ts` per §13.2.
46. Update `README.md` Broadcast section: 27 overlay URLs, `?preview=1` format, motion-token + sound-slot reference, font licence note.
47. Verification gate: `npm run test` (≥ 105 pass — 85 existing + 20 Plan 16), `npm run lint`, `npm run build` (bundle ≤ 250 KB per overlay page), `npm run e2e`, `npm run audit:smoke`. Record each command's output in Review section.
48. Append Plan 16 lessons to `tasks/lessons.md`. Populate Review log with final `APPROVED` sha for all 27 templates.

---

## 15. Acceptance criteria

- [ ] 27 Review log rows all read `APPROVED` with a git sha.
- [ ] Every production `/overlay/<key>` ≤ 250 KB first-load JS at 1080p60 target.
- [ ] Sound enabled and well-mixed on every stinger + timer overlay.
- [ ] `/overlay/design-preview` renders all 27 cards + 6 group headers.
- [ ] `/overlay/style-guide` renders palette (all §4 tokens) + type ramp (Agharti + Quedora + JetBrains Mono) + 7 motion tokens live demos + 8 sound samples.
- [ ] Every overlay accepts `?preview=1` with auto-loop + debug HUD.
- [ ] `lib/motion.ts` sole source of durations + easings; ESLint-enforced.
- [ ] `--signal*` CSS vars deprecated (alias in place, no new Plan 16 code uses them).
- [ ] `overlay_templates.template_type` CHECK extended; 20+ new rows seeded.
- [ ] Logos + player photos + fonts ingested from `KNOWLEDGE/brand-assets/`.
- [ ] `plan-16-design-language.md` committed with per-video palette + pacing.
- [ ] `npm run test` + `lint` + `build` + `e2e` + `audit:smoke` all green.
- [ ] README Broadcast section updated.

---

## 16. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Bundle bloat past 250 KB per overlay from 27 templates + fonts + photos | High | Medium | Per-overlay bundle is independent (Next route-split); photos served via `next/image` not bundled; fonts subsetted by `next/font/local`; framer-motion tree-shaken via `LazyMotion` + `m` components. Record size per template in Review log. |
| Sound licensing — Freesound CC-BY attribution missed, YouTube claim | Medium | High | `public/overlay/sounds/LICENSE.md` commits per-file attribution. Style-guide page surfaces credits. If any file lacks clear licence, substitute with a Tone.js synth. |
| Agharti / Quedora font licence questioned | Low | Medium | Zip filenames embed purchase timestamp (envato-style). Commit a `LICENSE.txt` in `apps/web/src/app/fonts/` mirroring the font seller's terms. Fallback build flag `NEXT_PUBLIC_BROADCAST_FONTS=licensed|ofl`. |
| Player photo manifest missing slugs (new roster) → initials placeholder frequency | Medium | Low | Initials placeholder is styled as a first-class state, not a fallback. Verified on each card in preview page. |
| Face-detection absent → awkward crops on rotated / angled photos | Medium | Low | Photos in `KNOWLEDGE/brand-assets/players/processed/` are already hand-composed by the `_process.py` pipeline. Manifest declares crop box. No ML needed. |
| 60 fps budget with 4+ simultaneous stingers on preview page | Low | Medium | Preview page runs one iframe per card but pauses off-screen iframes via `IntersectionObserver`; production never runs two stingers concurrently. |
| Framer-motion SSR hydration mismatch | Medium | Medium | `"use client"` on every overlay; `initial={false}` on idle components; `m.div` + `LazyMotion`. |
| `?preview=1` leaks into production stream | Low | High | HUD visible only when `NEXT_PUBLIC_OVERLAY_DEBUG=1`; operator docs warn. |
| Visual regression across template updates | High | Medium | Out of scope (Phase 3). Mitigation: per-template Review log re-signed when changed; preview page used manually. |
| Logos only available as PNG → 4K aliasing | Medium | Low | `next/image` density-aware; upload SVGs later and swap loader. |
| Reference videos too large to commit | High | None (already gitignored) | Confirm `.gitignore`. |
| Orgs / coach-association tables absent in Phase 1A | High | Low | Autofill builders return skeletal payloads with empty lists; overlays render placeholder state. Templates still ship; real data arrives Phase 2. |

---

## 17. Out of scope (reiterated)

- Visual regression tooling (Percy, Chromatic, Playwright snapshot diff) — Phase 3.
- AR / 3D overlays (WebGL, three.js, Spine) — not on roadmap.
- Sponsor rotation / dynamic ad scheduling — ad slot is a static URL in payload.
- Multi-language overlay copy — en-NG single locale.
- Runtime template authoring UI — seed-only per Plan 12.
- Face detection / ML cropping of player photos — manifest-declared crops only.
- vMix Data Sources / NDI / green-screen keying — different integration.
- Real-time co-editing of queued overlays.
- **Paystack / any payment surface** — per CLAUDE.md.

---

## 18. Critical files

- `apps/web/src/lib/motion.ts` — motion tokens (7)
- `apps/web/src/lib/overlay-sound.ts` — `useOverlaySound` hook
- `apps/web/src/lib/overlay-preview.ts` — `usePreviewMode` hook
- `apps/web/src/app/globals.css` — brand tokens + deprecated `--signal*` aliases
- `apps/web/src/app/layout.tsx` — `next/font/local` wiring for Agharti + Quedora
- `apps/web/src/app/fonts/` — ingested woff2 files
- `apps/web/src/components/overlay/brand/` — logo React wrappers
- `apps/web/src/components/overlay/` — 27 polished template components (subfolder per key)
- `apps/web/src/app/(overlay)/overlay/design-preview/page.tsx` — review harness (27 cards)
- `apps/web/src/app/(overlay)/overlay/style-guide/page.tsx` — tokens reference
- `apps/web/src/app/(overlay)/overlay/<key>/page.tsx` × 27 — production pages
- `apps/web/src/app/api/broadcast/design-preview/export-stills/route.ts` — optional stills endpoint
- `apps/web/src/server/overlays/schemas.ts` — 27 Zod schemas with `soundSlot`
- `apps/web/src/server/overlays/autofill.ts` — extended builders (§10)
- `apps/web/src/server/overlays/players.ts` — photo URL resolver
- `apps/web/public/brand/logos/` — ingested PNGs
- `apps/web/public/brand/players/<slug>/` — processed player photos
- `apps/web/public/overlay/sounds/` — 8 audio files + LICENSE.md
- `supabase/migrations/20260505000003_plan16_overlay_template_types.sql`
- `docs/superpowers/specs/plan-16-design-language.md` — reference-video findings
- `README.md` — operator docs

---

## 19. Review log (populated per template before production ship)

| Template | Ver | Bundle KB | Verdict | Approver | Git sha | Notes |
|----------|-----|-----------|---------|----------|---------|-------|
| stinger_intro        | — | — | — | — | — | — |
| stinger_normal       | — | — | — | — | — | — |
| stinger_replay       | — | — | — | — | — | — |
| stinger_goal         | — | — | — | — | — | — |
| stinger_winner       | — | — | — | — | — | — |
| layout_4pip          | — | — | — | — | — | — |
| layout_2pip          | — | — | — | — | — | — |
| layout_brb_full      | — | — | — | — | — | — |
| layout_brb_basic     | — | — | — | — | — | — |
| layout_timer         | — | — | — | — | — | — |
| layout_animated_bg   | — | — | — | — | — | — |
| layout_casters_chat  | — | — | — | — | — | — |
| h2h_2                | — | — | — | — | — | — |
| h2h_3                | — | — | — | — | — | — |
| h2h_5                | — | — | — | — | — | — |
| leaderboard_animated | — | — | — | — | — | — |
| lower_third          | — | — | — | — | — | — |
| score_bug            | — | — | — | — | — | — |
| up_next_bug          | — | — | — | — | — | — |
| match_scores_day     | — | — | — | — | — | — |
| starting_soon_basic  | — | — | — | — | — | — |
| starting_soon_timer  | — | — | — | — | — | — |
| stream_ended         | — | — | — | — | — | — |
| top_scorers          | — | — | — | — | — | — |
| orgs_roster          | — | — | — | — | — | — |
| coach_intros         | — | — | — | — | — | — |
| player_penalties     | — | — | — | — | — | — |

**Verdict values:** `APPROVED` (production ship green-lit), `ITERATE: <note>` (revise in preview), `HOLD` (block until dependency lands).

Production stub swap is ONLY permitted with a row reading `APPROVED` + a real git sha. This is the audit trail for the review-first workflow.
