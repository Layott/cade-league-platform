# Plan — Unify Design + Builder under one editor with live-data slots

**Status:** DRAFT. Plan only. No code yet.
**Author:** ladilawalt + Claude Opus 4.7
**Goal:** One admin surface (`/admin/broadcast/v2/builder`) edits BOTH the 27 shipped branded overlays AND user-authored designs. Builder gains a Data Layer that binds individual layers to live feeds (leaderboard, scores, partner roster, player photos, etc.). Design route becomes a redirect.

---

## 1. Why

Today two routes do overlapping work:

| Route | Edits | Outputs | Live data |
|---|---|---|---|
| `/admin/broadcast/v2/design` | 27 shipped overlays — tokens, text elements, partner strip, animations, photo selections | Mutates rows in 8 tables; SSR route reads on render | Yes — hand-coded `update()` in each static HTML |
| `/admin/broadcast/v2/builder` | User-authored scenes — Konva canvas, PSD import, keyframes | Publishes to `/overlay/v2/user/<slug>` | No — only static authored content |

Admin has to switch routes + mental models. Builder can't touch shipped overlays. Design can't compose new ones. Everything position/size/animation-related is duplicated UI between the two.

**Target:** one editor for everything; data binding is first-class so a Builder layer can read `leaderboard.rows[2].displayName` natively.

---

## 2. Scope

### IN scope

1. Single editor surface (Builder UI superset).
2. Builder library lists shipped overlays alongside user designs.
3. Data-slot system: every layer optionally binds to a typed feed/field.
4. Migration of 27 shipped overlay element catalogs → Builder scene tree projection (one-time backfill).
5. Reuse existing DB tables — no double bookkeeping.
6. AI Regenerate, player photo selections, partner-strip layout, animations panel all fold into the unified inspector.
7. History + revert preserved.
8. Design route 301 → Builder.

### OUT of scope (defer)

- Replacing the 27 hand-coded HTML runtimes with a Builder-rendered canvas. Preserve the static HTML output; Builder UI just AUTHORS into it.
- New PSD-import flow for shipped overlays (they're already designed; admins just tune them).
- Real-time multi-cursor collaboration.
- Per-tenant / per-org overlays (currently single league).

---

## 3. Current data model (snapshot)

### Design-side tables

```
overlay_template_variants     — per (overlay_key, variant_id); active flag
overlay_design_tokens         — CSS variables (bg-color, font-display, accent-color, …)
overlay_text_elements         — per (overlay_key, variant_id, element_id); content + typography + position + width/height
overlay_partner_strip_layout  — per (overlay_key, variant_id); anchor/x/y/scale/orientation
overlay_partner_logos         — global logo roster
overlay_partner_logo_overrides — per (overlay_key, variant_id, partner_key) visible/sort
overlay_element_animations    — per (overlay_key, variant_id, element_id, anim_phase); type/duration/easing
overlay_design_history        — append-only token snapshots for revert
player_photo_selections       — per (player_id, overlay_key | NULL); chosen pose
```

### Builder-side tables

```
overlay_user_designs          — top-level designs; title, slug, kind, settings JSON
  ↳ scenes (nested in design JSON or sibling table) — scene tree
  ↳ layers (nested) — id, type, transform, content, animation tracks
overlay_user_assets           — uploads (fonts, images, video)
overlay_user_asset_history    — version log
```

### Runtime layer

```
apps/web/public/overlays/v2/<key>/index.html       — static, hand-coded; 27 shipped
apps/web/public/overlays/v2/user/<slug>/index.html — Builder-generated
apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx
  — INITIAL_FETCH_PATH per overlay_key  (which endpoint to hit)
  — REALTIME_KEY_EVENTS  (which Realtime events repaint)
  — passes payload via postMessage to iframe's update()
```

---

## 4. Target data model

### New tables

#### `overlay_scenes`

One row per (overlay_key, variant_id). Holds the scene tree projection for both shipped overlays AND user designs (currently only Builder uses scenes; we extend to shipped).

```sql
CREATE TABLE overlay_scenes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overlay_key     text NOT NULL,
  variant_id      text NOT NULL DEFAULT 'default',
  scene_tree      jsonb NOT NULL,   -- nested layer tree
  scene_kind      text NOT NULL CHECK (scene_kind IN ('shipped', 'user')),
  user_design_id  uuid REFERENCES overlay_user_designs(id),  -- nullable; only for kind='user'
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,
  set_by          uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX overlay_scenes_unique
  ON overlay_scenes (overlay_key, variant_id) WHERE deleted_at IS NULL;
```

For shipped overlays the `scene_tree` mirrors the HTML's structure — every `data-element-id`-tagged element becomes a layer node. The layer's `data_binding` (see below) carries the slot wire so the existing static HTML's `update()` can read the binding at runtime.

#### `overlay_data_feeds`

Catalog of feeds the runtime can resolve. Drives the Data picker UI.

```sql
CREATE TABLE overlay_data_feeds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key       text NOT NULL UNIQUE,   -- 'leaderboard', 'score_bug', 'cover_up_stats', ...
  display_label  text NOT NULL,          -- 'Live Leaderboard'
  source_kind    text NOT NULL CHECK (source_kind IN ('api', 'static', 'computed')),
  api_path       text,                   -- '/api/broadcast/sessions/:id/leaderboard'
  realtime_event text,                   -- 'standings.changed' (nullable; static feeds skip)
  schema         jsonb NOT NULL,         -- typed schema of the payload (field tree)
  created_at     timestamptz DEFAULT now()
);
```

Seed rows cover all known feeds:

```
('leaderboard',         'Live Leaderboard',       'api', '/api/broadcast/sessions/:sessionId/leaderboard',          'standings.changed',  {…shape…}),
('score_bug',           'Score Bug (2-player)',   'api', '/api/broadcast/sessions/:sessionId/scorebug',              'score.changed',      {…}),
('match_scores_day',    'Match Scores Day',       'api', '/api/broadcast/sessions/:sessionId/match-scores-day',       'score.changed',      {…}),
('top_scorers',         'Top Scorers',            'api', '/api/broadcast/sessions/:sessionId/top-scorers',            'match.ended',        {…}),
('orgs',                'Orgs Standings',         'api', '/api/broadcast/v2/sessions/:sessionId/orgs',                NULL,                  {…}),
('coaches',             'Coach Intros',           'api', '/api/broadcast/v2/sessions/:sessionId/coaches',             NULL,                  {…}),
('penalties',           'Penalty Shootout',       'api', '/api/broadcast/v2/sessions/:sessionId/penalties',           'standings.changed',  {…}),
('h2h_2',               'H2H 2-player',           'api', '/api/broadcast/sessions/:sessionId/h2h?key=04-h2h-2',       'standings.changed',  {…}),
('h2h_3',               'H2H 3-player',           'api', '/api/broadcast/sessions/:sessionId/h2h?key=05-h2h-3',       'standings.changed',  {…}),
('h2h_5',               'H2H 5-player',           'api', '/api/broadcast/sessions/:sessionId/h2h?key=06-h2h-5',       'standings.changed',  {…}),
('player_squads',       '13 Player Squads',       'api', '/api/broadcast/v2/sessions/:sessionId/player-squads',       'fcdb.refreshed',     {…}),
('cover_up_stats',      'Cover-up Stats Bundle',  'api', '/api/broadcast/sessions/:sessionId/cover-up-stats',         NULL,                  {…}),
('partner_roster',      'Sponsor Logo Roster',    'static', NULL,                                                     NULL,                  {…}),
('player_photo',        'Per-player Photo URL',   'computed', NULL,                                                   NULL,                  {…}),
('season_meta',         'Season Name + Week',     'computed', NULL,                                                   NULL,                  {…}),
('match_clock',         'Live Match Clock',       'computed', NULL,                                                   NULL,                  {…}),
```

### Extended Builder layer shape

```ts
type BuilderLayer = {
  id: string;
  type: 'text' | 'image' | 'shape' | 'video' | 'group' | 'slot';
  transform: { x, y, w, h, rotation, opacity, zIndex };
  // Static content (default if no data_binding):
  text?: string;
  src?: string;
  // Style:
  style: { fontFamily?, fontSize?, fontWeight?, color?, letterSpacing?, lineHeight?, textAlign?, ... };
  // Animation (mirrors overlay_element_animations rows):
  animations?: {
    entry?: AnimationConfig;
    exit?: AnimationConfig;
    continuous?: AnimationConfig;
  };
  // NEW — data binding:
  data_binding?: {
    feed_key: string;             // 'leaderboard'
    index_path?: string;          // 'rows[2]' or 'home'
    field_path: string;           // 'displayName' / 'pts' / 'photoUrl'
    fallback?: string;            // design-time placeholder
    transformer?: 'uppercase' | 'lowercase' | 'pts_suffix' | ... ;
  };
  // For shipped overlays — points back to existing element_id so the bridge can target same DOM:
  shipped_element_id?: string;    // 'pr-blurb-1', 'partners-strip', etc.
  // For grouped layers (e.g. h2h cards):
  children?: BuilderLayer[];
};
```

### Compatibility bridge

Add nullable column `slot_binding jsonb` to `overlay_text_elements`. When set, runtime's update() reads it to populate the element from the active feed payload. When NULL (default), behaviour stays static — backward compat preserved.

```sql
ALTER TABLE overlay_text_elements
  ADD COLUMN slot_binding jsonb;
```

Schema mirrors `BuilderLayer.data_binding`. The unified editor writes both places when editing a shipped overlay's element.

---

## 5. Runtime contract

### Two render paths coexist

| Path | Source | Used by |
|---|---|---|
| Static HTML | `apps/web/public/overlays/v2/<key>/index.html` (hand-coded for the 27) | Shipped overlays — unchanged |
| Builder-rendered | `apps/web/public/overlays/v2/user/<slug>/index.html` (generated on publish) | User designs |

### Data-binding resolver in static HTML

Bootstrap script extension (already injected into all 27 HTMLs) gains a `applySlotBindings(payload, feedKey)` function:

```js
// Wave 3 — data-slot resolver (added 2026-05-23)
function applySlotBindings(payload, feedKey) {
  // bindings is the rows from overlay_text_elements + scene_tree projection
  // serialised into a global window.__cadeSlotBindings = [
  //   { element_id: 'pr-blurb-1', feed_key: 'leaderboard', index_path: 'rows[0]', field_path: 'narrative', transformer: null, fallback: 'Untouched at the top' },
  //   { element_id: 'pr-card-1-name', feed_key: 'leaderboard', index_path: 'rows[0]', field_path: 'displayName', transformer: 'uppercase', ... },
  //   ...
  // ];
  if (!window.__cadeSlotBindings) return;
  for (const b of window.__cadeSlotBindings) {
    if (b.feed_key !== feedKey) continue;
    const node = document.querySelector('[data-element-id="' + b.element_id + '"]');
    if (!node) continue;
    let v = resolvePath(payload, b.index_path, b.field_path);
    if (v == null) v = b.fallback;
    if (b.transformer) v = applyTransformer(v, b.transformer);
    if (node.tagName === 'IMG') node.src = v;
    else node.textContent = v;
  }
}
```

`window.__cadeSlotBindings` is SSR-injected by the overlay page route from the slot_binding columns. update() in each shipped HTML calls `applySlotBindings(data, feedKeyForThisOverlay)` BEFORE its existing custom update logic — so admin-bound slots win, hand-coded fallbacks remain for slots without bindings.

### Builder-rendered user overlays

Same resolver inlined into the generated HTML. Builder serialiser walks the scene tree, emits `<div data-element-id="...">` per layer, and emits a `window.__cadeSlotBindings = [...]` literal for any layer with `data_binding`.

---

## 6. Editor UI (target)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Overlay Builder · CADE League                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌──────────────────────────────┐ ┌────────────────────┐ │
│ │  LIBRARY        │ │  CANVAS                      │ │  INSPECTOR         │ │
│ │  ───────────────│ │                              │ │  ───────────────── │ │
│ │  [+ New Design] │ │                              │ │  Layer: pr-blurb-1 │ │
│ │                 │ │                              │ │                    │ │
│ │  SHIPPED        │ │     (live iframe preview)    │ │  > Text            │ │
│ │  ▸ 01-brb       │ │                              │ │    Content:        │ │
│ │  ▸ 04-h2h-2     │ │                              │ │    [Untouched...]  │ │
│ │  ▸ 22-power-..  │ │                              │ │  > Style           │ │
│ │  ...            │ │                              │ │    Font / Size /   │ │
│ │                 │ │                              │ │    Color           │ │
│ │  USER DESIGNS   │ │                              │ │  > Transform       │ │
│ │  ▸ my-design-1  │ │                              │ │    Pos X / Y       │ │
│ │  ▸ test-stinger │ │                              │ │    W / H / Rot     │ │
│ │                 │ │                              │ │  > Animation       │ │
│ │                 │ │                              │ │    Entry/Exit/...  │ │
│ │                 │ │                              │ │  > Data ⚡          │ │
│ │                 │ │                              │ │    Feed: Leaderb.  │ │
│ │                 │ │                              │ │    Row: rank 1     │ │
│ │                 │ │                              │ │    Field: narrative│ │
│ │                 │ │                              │ │    [Unbind]        │ │
│ ├─────────────────┴──────────────────────────────────┴────────────────────┤ │
│ │  LAYER TREE                                                              │ │
│ │  ▸ canvas                                                                │ │
│ │    ▸ pr-grid                                                             │ │
│ │      ▸ pr-card-1 (group) [bound: leaderboard.rows[0]]                    │ │
│ │        • pr-card-1-name      [bound: .displayName · uppercase]           │ │
│ │        • pr-card-1-pts       [bound: .pts · pts_suffix]                  │ │
│ │        • pr-blurb-1          [bound: .narrative]                         │ │
│ │      ▸ pr-card-2 (group) [bound: leaderboard.rows[1]]                    │ │
│ │      ...                                                                 │ │
│ │    ▸ partners-strip          [bound: partner_roster.logos[]]             │ │
│ │    ▸ logo-cade               [static · CADE Esports logo]                │ │
│ │    ▸ logo-pro                [static · ESOCCER Pro League]               │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Inspector panels (per layer)

1. **Text/Content** — current content + AI Regenerate button (for AI-eligible slots)
2. **Style** — typography (font / weight / size / spacing / line height / color / align / opacity)
3. **Transform** — position (x/y), size (w/h), rotation, zIndex
4. **Animation** — entry/exit/continuous picker (anim type + duration + delay + easing + iteration)
5. **Data ⚡** — feed picker, index path, field path, transformer, fallback. UI tree-pickable from the feed catalog.
6. **History** — last 20 mutations, revert per-layer

### Library list

Shipped section is read-only structurally (can't delete or rename) — admins can only edit layer style/content/anim/binding. User Designs section keeps existing CRUD.

### Cross-overlay tools (left rail)

- Partner roster manager (still useful across overlays)
- Player photo manager (per-overlay pose selection)
- Token catalog editor (CSS vars)
- Template variants (active variant pivot)

---

## 7. Migration / rollout phases

### Phase 0 — Spec freeze + agreement

This file. User signs off. No code.

### Phase 1 — Schema additions (1 PR, ~half day)

- Migration adds `overlay_scenes`, `overlay_data_feeds`, `slot_binding` column on `overlay_text_elements`.
- Seed feed catalog with all 16 feeds from the existing `OverlayDataInjector.INITIAL_FETCH_PATH` map.
- No UI yet. No behaviour change.

### Phase 2 — Scene-tree projection backfill (1 PR, ~1 day)

- Script reads each shipped HTML, finds every `data-element-id`, builds the projected scene tree, writes one `overlay_scenes` row per overlay_key.
- Also reads `overlay_text_elements`, `overlay_partner_strip_layout`, `overlay_element_animations` and folds into each layer's animation/style maps.
- Idempotent — re-running rebuilds the projection.
- Static HTML untouched.

### Phase 3 — Slot binding resolver in bootstrap (1 PR, ~half day)

- Extend `apps/web/scripts/_extend-bootstrap-script.mjs` BOOTSTRAP with `applySlotBindings()` function + reads `window.__cadeSlotBindings`.
- SSR overlay route serializes `slot_binding`-tagged rows into a `<script>window.__cadeSlotBindings = [...]</script>` block.
- Existing static HTML `update()` calls applySlotBindings first, then runs its hand-coded logic for unbound elements.
- Behaviour: when admin hasn't bound any slot, NOTHING changes. When admin binds `pr-blurb-1` to `leaderboard.rows[0].narrative`, the resolver overwrites the hand-coded path.

### Phase 4 — Builder UI: library + canvas + inspector (1-2 PRs, ~3-4 days)

- Builder library lists shipped overlays alongside user designs (new section header).
- Click a shipped overlay → opens canvas view with read-only structural tree from scene projection.
- Canvas = iframe preview of the static HTML at `/overlays/v2/<key>/index.html?preview=1`. Click on element in canvas → highlight in tree + open inspector.
- Inspector panels:
  - Style (existing Design knobs)
  - Transform (existing pos/size knobs)
  - Animation (existing animations picker)
  - Data slot picker (NEW)
- All save actions route through existing tables (overlay_text_elements / animations / strip) + write to `slot_binding` for the Data panel.

### Phase 5 — Data slot picker UI (1 PR, ~1-2 days)

- Tree picker for feed → index → field → transformer
- Reads `overlay_data_feeds` catalog
- Live preview shows resolved value when an active session is bound
- Validation: index_path matches a known array in feed schema; field_path matches a known field

### Phase 6 — Builder serialiser for user designs (1 PR, ~1 day)

- For user designs only: extend the builder publish action to emit `window.__cadeSlotBindings = [...]` into the generated HTML so user-authored layers can also bind feeds.

### Phase 7 — Design route deprecation (1 PR, ~half day)

- `/admin/broadcast/v2/design` → 301 redirect to `/admin/broadcast/v2/builder`
- `AdminSubnav` updates
- Update CLAUDE.md §15 to point at the unified surface

### Phase 8 — Cleanup (optional, post-launch)

- Remove `OverlayDesignEditor.tsx` (replaced)
- Audit + delete unused exports from design/actions.ts
- Update specs that reference the old route

---

## 8. Feed catalog (initial seed)

| feed_key | source | api_path (replace `:sessionId`) | realtime | schema fields |
|---|---|---|---|---|
| `leaderboard` | api | `/api/broadcast/sessions/:sessionId/leaderboard` | `standings.changed` | `rows[]: { rank, displayName, slug, pts, gd, p, w, d, l, gf, ga, narrative, photoUrl, orgLogoUrl, sanctions }` |
| `match_scores_day` | api | `/api/broadcast/sessions/:sessionId/match-scores-day` | `score.changed`, `match.ended` | `matches[]: { home, away, homeScore, awayScore, status, slot, lane }` |
| `top_scorers` | api | `/api/broadcast/sessions/:sessionId/top-scorers` | `match.ended` | `pads[]: { rank, displayName, goals, photoUrl }` |
| `orgs` | api | `/api/broadcast/v2/sessions/:sessionId/orgs` | — | `orgs[]: { name, logoUrl, totalPoints, roster[] }` |
| `coaches` | api | `/api/broadcast/v2/sessions/:sessionId/coaches` | — | `slots[]: { name, tagline, photoUrl }` (1..3) |
| `penalties` | api | `/api/broadcast/v2/sessions/:sessionId/penalties` | `standings.changed` | `home, away, homePens, awayPens, outcomeLine` |
| `h2h_2`/`h2h_3`/`h2h_5` | api | `/api/broadcast/sessions/:sessionId/h2h?key=...` | `standings.changed` | `players[]: { ... up to 5 players with full stats }` |
| `score_bug` | api | `/api/broadcast/sessions/:sessionId/scorebug` | `score.changed` | `home: { name, score, slug, photoUrl }, away: same, clock, status` |
| `up_next` | api | `/api/broadcast/sessions/:sessionId/up-next` | `match.ended` | `home, away, time, slot, lane` |
| `player_squads` | api | `/api/broadcast/v2/sessions/:sessionId/player-squads` | `fcdb.refreshed` | `players[]: { displayName, starters[], subs[], chemistry }` |
| `cover_up_stats` | api | `/api/broadcast/sessions/:sessionId/cover-up-stats` | — | `streaks[], biggestMargins[], goalfests[], orgs[], didYouKnow, powerRankings[]` |
| `partner_roster` | static | — | — | `logos[]: { partnerKey, label, alt, fileUrl }` |
| `player_photo` | computed | — | — | resolves per-(player × overlay) via existing resolver |
| `season_meta` | computed | — | — | `seasonName, week, year` |
| `match_clock` | computed | — | — | `minutes, half` |

---

## 9. Risks

1. **Hand-coded HTML divergence.** Each shipped overlay has unique CSS (marquee, halftone, chevrons, SVG, masks). The scene tree projection captures STRUCTURE but the visual fidelity stays in CSS. If admin changes positionXPx in Builder, it must reach the SAME CSS variable / data attribute path the existing bootstrap reads. Mitigation: project layers from `data-element-id`-tagged elements only; non-tagged decorative elements stay invisible to Builder.
2. **Animation parity.** Some shipped overlays use CSS @keyframes hand-authored (partner marquee scroll, chevron fade, bg-drift). Builder's animation picker only covers preset types. Solution: surface `custom-css` animType (already supported in bootstrap) in Builder; existing CSS animations stay untouched as "author defaults" outside the design system.
3. **Data binding overwrite.** Once admin binds `pr-blurb-1` to `leaderboard.rows[0].narrative`, the static HTML's hand-coded blurb fallback never shows on stream. Need clear UI signal "this is auto-fed by leaderboard". Unbind option present.
4. **Backward compat invariant.** Default state (no admin overrides, no bindings) MUST render byte-identical to today. Phase 1 + 2 are no-op; Phase 3 only activates when slot_binding is non-null.
5. **Sub-overlays variable shapes.** h2h-2 vs h2h-3 vs h2h-5 differ in player count. Builder canvas should pick a representative shape per overlay (no auto-resizing array layers yet).
6. **History UX.** Per-layer revert is finer-grained than the current per-overlay snapshot. Either keep snapshot-level revert OR extend `overlay_design_history` to track per-layer deltas. Recommend snapshot-level for v1, per-layer for v2.
7. **AI Regenerate.** Currently per-slot (pr-blurb, dyk-detail, etc.). Move into the Data panel as "AI Suggest" CTA only for slots with text content + a known brief. Slots with binding skip the button (binding wins).
8. **Player photo selections.** Currently per-(player × overlay). Stays in the Cross-overlay tools panel (NOT per-layer) so admin can re-pose a player across all overlays in one place.

---

## 10. Decision points (need user input before Phase 1)

1. **Scene projection granularity.** Project ALL DOM elements or only `data-element-id`-tagged ones?
   - Recommend: tagged only. Non-tagged decoration (halftone, chevrons, dividers) stays invisible to Builder.
2. **Slot binding precedence.** When both `slot_binding` AND `overlay_text_elements.content` (admin-typed text) are set, which wins?
   - Recommend: binding wins. UI shows a chip "🔗 bound" beside the content field when binding is active; field becomes read-only with binding's resolved value as preview.
3. **Per-layer vs per-snapshot history.** v1 = per-snapshot (current Design model). v2 = per-layer deltas.
   - Recommend: per-snapshot for v1; revisit after dogfooding.
4. **Data feed schema versioning.** Feeds will evolve. Versioned schemas in `overlay_data_feeds.schema` or unversioned and accept additive fields only?
   - Recommend: unversioned + additive-only convention. Note in field comments.
5. **Builder canvas — direct manipulation or iframe-only?**
   - **iframe-only (recommended for v1):** preview is the actual static HTML; click in iframe is messaged to parent to select layer; inspector is the editing surface. Lower fidelity drag but ZERO risk of canvas/runtime drift.
   - **Direct manipulation in Konva canvas:** rich drag UX but Konva and HTML CSS won't render identically — divergence risk.
6. **Naming.** "Branded Overlays" + "User Designs" two top-level groups in library? Or merge?
   - Recommend: separate top-level groups with the same card UI; visual separator + label.

---

## 11. Estimated effort

| Phase | Eng days | Risk |
|---|---|---|
| 1. Schema migrations | 0.5 | low |
| 2. Scene-tree backfill script | 1 | medium (HTML parsing) |
| 3. Slot resolver in bootstrap | 0.5 | low |
| 4. Builder UI surface + canvas | 3 | medium (iframe wiring) |
| 5. Data slot picker UI | 2 | medium (tree picker UX) |
| 6. Builder serialiser for user designs | 1 | low |
| 7. Design route deprecation + AdminSubnav | 0.5 | low |
| **Total** | **8.5 days** | |

Add ~2 days buffer for integration + smoke testing across the 27 shipped overlays. **~2 weeks single-engineer.**

---

## 12. Acceptance criteria

- [ ] `/admin/broadcast/v2/builder` lists 27 shipped overlays + N user designs in one library.
- [ ] Clicking a shipped overlay shows a canvas + layer tree + inspector.
- [ ] Style/Transform/Animation panels in inspector mutate the same DB tables Design currently uses (zero data migration on admin saves).
- [ ] Data panel can bind a layer to any feed + index + field, with live preview.
- [ ] Once bound, the live overlay populates the layer from the active feed payload on next render + Realtime event.
- [ ] Existing live broadcasts (no admin changes) render byte-identical to pre-merge.
- [ ] `/admin/broadcast/v2/design` 301 → builder root.
- [ ] All 50+ existing tests still pass.
- [ ] CLAUDE.md §15 + Plan-57 spec updated.

---

## 13. Notes for future work

- A "Preview with mock data" toggle in the inspector so admins can rehearse animations without an active broadcast session.
- Bulk binding via templates: "Bind all pr-card-*-name elements to leaderboard.rows[*].displayName" with auto-indexing.
- Per-(role × overlay) lock so non-admin staff can edit copy but not transforms.
- Export/import scene as JSON for sharing across leagues (if multi-tenant ever ships).
