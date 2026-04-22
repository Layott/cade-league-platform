# Plan 22 — CADE Player Card (FUT-style, fresh art)

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Active
**Depends on:** Plan 16 (broadcast surface) shipped, Plan 21 (FC roster + photo manifest) photo pipeline complete, Plan 18 (real H2H pairings) for context only.

---

## 1. Goal + Success Criteria

**Goal.** Ship a single reusable React component — `<CadePlayerCard>` — that
renders a recognisable FUT-style player card (rating top-left, position chip
under it, photo top-right, name strip, 2x3 stats grid, badge row at the
bottom edge) using **only CADE-original art**: SVG gradients, our brand
tokens, our studio headshots.

The component ships **standalone** in this plan; consumer wire-ups are
deliberately deferred to keep the existing broadcast overlay, schemas, and
public profile page untouched. Future consumers:

1. `/overlay/player-card` broadcast overlay (Plan 16 stub → real card) —
   deferred. Schema migration to add FUT props handled in a follow-up so
   the existing `playerCardSchema` shape is not disturbed.
2. Public `/players/[id]` profile page — deferred (additive section).
3. `/admin/squads/[id]` review preview — Plan 21 hook, not blocking.
4. A future "weekend roster" rotation overlay (one card per match day).

**Success criteria (each demonstrable end-to-end before plan complete):**

1. `apps/web/src/components/players/CadePlayerCard.tsx` exists, fully typed,
   renders all 7 rarities (`gold | silver | bronze | totw | hero | icon |
   cade-special`) at all 4 sizes (`sm 240 | md 320 | lg 480 | xl 640`).
2. Story / harness page `/overlay/storybook/cade-player-card` (admin-gated
   via `broadcast.manage`) renders the 28 rarity x size variants AND a row
   showing the real 13 CADE players (manifest-driven).
3. 13 transparent-background headshots copied into
   `apps/web/public/players/<slug>/headshot_<NN>.png` via idempotent
   `scripts/sync-player-photos.mjs`.
4. `apps/web/src/components/players/cadeCardSlug.test.ts` covers slug
   derivation + URL builder (5 cases). Vitest green.
5. E2E `apps/web/tests/e2e/cade-player-card-storybook.spec.ts` — opens the
   story page as admin, asserts 7 rarity tags + 13 real player names + at
   least one rating chip in the DOM. Playwright green.
6. `next build` clean, `npm run lint` clean, `npm test` green.
7. **Deferred (follow-up plan):** wire into `/overlay/player-card`,
   extend `playerCardSchema` with FUT props, surface the card on
   `/players/[id]`. Out of Plan 22's scope to keep existing surfaces
   (broadcast overlay schema, public profile, vitest config) untouched.

---

## 2. Visual reference list (REFERENCES ONLY — not assets)

These community card creators establish the **layout grammar** users
recognise. We study proportions only; we **do not** copy gradients, fonts,
or any pixel asset:

- **Futbin** (futbin.com) — community FUT card maker, decade of iteration.
- **FUT.GG** (fut.gg) — modern card creator + builder.
- **FUTWIZ** (futwiz.com) — long-running stat / SBC site.
- **WeFUT** (wefut.com) — card creator with rarity catalogue.
- **FutGraphics** (futgraphics.com) — public card-art templates.
- Various Figma "FUT card" community templates.

Layout grammar extracted (functional facts, not copyrightable expression):

- Aspect ratio 2:3 portrait.
- Rating numeral top-left, position chip immediately below.
- Photo top-right, transparent edges blending into card background.
- Name strip mid-lower third, full width, condensed bold.
- 2 columns x 3 rows of stats (number above 3-letter label) below the name.
- Optional badge row (club / nation / league) along bottom edge.

We **do not** ship: EA logo, FIFA wordmark, ULTIMATE TEAM mark, EA's exact
colour ramps, any cached EA texture. All visuals are reimplemented from
scratch using the CADE brand palette (`--primary` `#6bcd06`, `--secondary`
`#fe036d`, ink ramp from `globals.css`).

---

## 3. Component contract

```ts
type CadePlayerCardProps = {
  // Player identity
  displayName: string;
  gamerTag?: string;
  jerseyNumber?: number;
  // FUT-equivalent rating + position
  rating: number;            // 0-99
  position:
    | "GK" | "CB" | "LB" | "RB"
    | "CDM" | "CM" | "CAM"
    | "LM" | "RM" | "LW" | "RW"
    | "ST" | "CF";
  // Photos
  photoUrl: string;          // transparent-bg PNG
  // 6 outfield stats (0-99). For GK, override labels via isGoalkeeper.
  stats: {
    pac: number; sho: number; pas: number;
    dri: number; def: number; phy: number;
  };
  // Optional badges
  clubLogoUrl?: string;
  nationFlagUrl?: string;
  leagueLogoUrl?: string;
  // Visual
  rarity?: "gold" | "silver" | "bronze" | "totw" | "hero" | "icon" | "cade-special";
  size?: "sm" | "md" | "lg" | "xl";   // 240 / 320 / 480 / 640 wide
  animate?: boolean;        // motion enter + idle pulse on rating chip
  // Position-specific stat label override (GK uses DIV/HAN/KIC/REF/SPE/POS)
  isGoalkeeper?: boolean;
};
```

Implementation notes:

- Aspect ratio locked to 2:3. Width drives height via `aspect-ratio: 2/3`.
- Background: SVG gradient (`<linearGradient>` + `<radialGradient>`) with a
  diagonal sheen overlay. Per rarity:
  - **gold** — warm gold ramp (`#f5d061 → #b6802b`) + CADE primary tint.
  - **silver** — chalk ramp (`#e8e9ec → #6b7280`).
  - **bronze** — copper ramp (`#c98a4b → #6b3a18`).
  - **totw** — black + warm gold accent (`#0a0a0a → #1a1305 + #d4a017`).
  - **hero** — red ramp (`#ff5b3b → #781a08`).
  - **icon** — beige + soft gold (`#f5e8c8 → #b89855`).
  - **cade-special** — `--secondary` `#fe036d` + black with primary glints.
- Rating: top-left, Agharti-Black, ~24% of card width (font-size
  `clamp`-based on container width via CSS variables).
- Position chip: under rating, Quedora-Bold uppercase.
- Photo: top-right, transparent PNG, slight forward tilt (`rotate(-2deg)`)
  on top edge, scales with the card.
- Name strip: lower third, full-width, Agharti condensed, centred, single
  hairline divider above + below.
- Stats: 2x3 grid (rows-first ordering: PAC SHO / PAS DRI / DEF PHY for
  outfield; DIV HAN / KIC REF / SPE POS for GK).
- Badge row: 3 slots (club / nation / league). Hidden if all three absent.
  Individually omits a slot if its URL is missing.
- All metrics consume CSS vars from `globals.css` so brand updates
  propagate.

---

## 4. Card rarities

| Rarity         | Background                              | Trim          | Best fit                  |
|----------------|-----------------------------------------|---------------|---------------------------|
| gold           | gold ramp + primary tint                | white text    | regular Elite player      |
| silver         | chalk ramp                              | dark text     | reserve / second team     |
| bronze         | copper ramp                             | white text    | rookie / preseason call-up|
| totw           | black + gold accent                     | gold text     | Match Day MVP             |
| hero           | red ramp                                | white text    | hat-trick / clutch perf   |
| icon           | beige + soft gold                       | dark text     | retired / hall of fame    |
| cade-special   | `--secondary` pink + black + primary    | white text    | season MVP / launch promo |

Default rarity: `gold`.

---

## 5. Animation tokens

All motion routed through `apps/web/src/lib/motion.ts`:

- Card mount: `ENTER` token — `scale 0.86 -> 1`, `opacity 0 -> 1`.
- Rating chip idle pulse (when `animate=true`): `IDLE_PULSE` token —
  subtle opacity / scale loop on the rating numeral.
- Photo hover parallax: pure CSS transition (no inline duration literal —
  uses a CSS custom property `--card-hover-ms` set in
  `CadePlayerCard.module.css`-equivalent inline style block).

When `animate=false`, the component renders a static frame (production
overlay routes default `animate=false` unless they explicitly opt in).

---

## 6. Photo handling

Source assets: `KNOWLEDGE/brand-assets/players/processed/<slug>/headshot_<NN>_nobg.png`
(transparent background).

Distribution: `scripts/sync-player-photos.ts` (Node, idempotent) reads the
manifest at `KNOWLEDGE/brand-assets/players/processed/manifest.json` and
copies each player's `headshot_<NN>_nobg.png` files into
`apps/web/public/players/<slug>/headshot_<NN>.png`, preserving pose
indices. The card consumes URLs of the form
`/players/<slug>/headshot_<NN>.png`.

`xl` size (640 px wide) consumes the 512 sq headshot natively; smaller
sizes downscale via `next/image` `sizes` hint.

---

## 7. Tests

- **Unit (Vitest):**
  `apps/web/src/components/players/cadeCardSlug.test.ts` — slug derivation
  + URL builder (5 cases). The original plan included a JSX render test
  (`CadePlayerCard.test.tsx`) but the project's `vitest.config.ts` does
  not currently install `@vitejs/plugin-react`, so the React render test
  cannot parse `.tsx` files through Vite. Dropped the render test rather
  than mutate the shared vitest config; visual coverage routes through
  the storybook page + the E2E spec instead. To re-enable the render
  test, add `@vitejs/plugin-react` to `apps/web/package.json` and add
  `plugins: [react()]` to `vitest.config.ts`.
- **E2E (Playwright):**
  `apps/web/tests/e2e/cade-player-card-storybook.spec.ts` — admin login,
  open `/overlay/storybook/cade-player-card`, assert 7 rarity tags + 13
  real player display names + at least one rating chip in DOM.

---

## 8. Numbered tasks

1. Write this spec.
2. Build `scripts/sync-player-photos.mjs`. Idempotent; user runs once.
3. Build `apps/web/src/components/players/CadePlayerCard.tsx` (component + per-rarity SVG palette + animation hooks).
4. Build `apps/web/src/components/players/cadeCardSlug.ts` + `.test.ts` (slug helper + 5 unit cases).
5. Build story page under `apps/web/src/app/(overlay)/overlay/storybook/cade-player-card/` (admin-gated server shell + client toggles). Folder is `storybook/` not `_storybook/` because App Router treats `_*` as private.
6. Write E2E `apps/web/tests/e2e/cade-player-card-storybook.spec.ts`.
7. Verify locally — `npm run lint`, `npm run test`, `npm run build`.
8. Commit per slice. Co-author line. Push.

**Deferred to follow-up plan (do NOT touch in Plan 22):**

- Mutating `playerCardSchema` in `apps/web/src/server/overlays/schemas.ts`.
- Wiring `<CadePlayerCard>` into `/overlay/player-card/page.tsx`.
- Wiring `<CadePlayerCard>` into `/players/[id]/page.tsx`.
- Mutating `apps/web/vitest.config.ts` (would need `@vitejs/plugin-react`).
- Mutating `apps/web/src/server/overlays/schemas.test.ts`.

---

## 9. Verification gate

- `npm run lint` clean.
- `npm run test` green (4 new cases on top of the existing 112).
- `npm run build` clean (1 new route: `/overlay/storybook/cade-player-card`).
- `npm run e2e` green (1 new spec on top of existing).
- Manual: open `http://localhost:3030/overlay/storybook/cade-player-card` after admin login, eyeball the 28 grid + 13 real players row.

---

## 10. Legal posture

- **Layout proportions are functional fact**, not copyrightable. FUT card
  layout (2:3 portrait, rating top-left, photo top-right, stat grid bottom)
  is a generic team-sport TCG layout — same fundamentals as Topps, Panini,
  every NBA / NFL / FIFA card since the 1980s.
- **Background gradients + colour ramps are reimplemented from scratch**
  using OUR brand tokens. Visually familiar genre, not pixel-copy of EA's
  "FIFA 26 gold gradient".
- **Player photos are our own studio shoots**, processed by us, released
  for league use.
- **Stat numbers are either our own ratings** (assigned by the LOC) OR a
  Plan 21 lookup against `fc26_players` metadata (sourced from public
  Kaggle dumps under their license terms).
- **No EA logo, FIFA wordmark, "ULTIMATE TEAM" mark, club crest, or
  national flag belonging to a third party** is shipped by Plan 22.
- **DMCA risk: low.** Every community FUT site (Futbin, FUT.GG, FUTWIZ,
  WeFUT, FutGraphics) ships card creators in this style without
  enforcement; the only enforced surface is the EA wordmark / logo, which
  we do not use.

---

## 11. Out of scope

- Printing physical cards.
- NFT minting.
- Animated backgrounds beyond a simple SVG sheen.
- Dynamic per-card chemistry / link art.
- A card editor UI (admins set rating + stats via DB or future tooling).
- Multi-language card front (en-NG only for now).

---

## 12. Review log

| Template          | Status   | Approver | Git sha | Notes |
|-------------------|----------|----------|---------|-------|
| cade-player-card  | DRAFT    | —        | —       | initial scaffold |
