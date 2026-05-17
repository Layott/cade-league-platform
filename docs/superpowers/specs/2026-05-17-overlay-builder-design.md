# Overlay Builder (visual drag-drop canvas + PSD editing + live data binding)

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-05-17
**Status:** Draft — approved for plan decomposition
**Supersedes:** N/A (greenfield feature; extends 2026-04-29 design system rather than replacing)
**Related:** 2026-04-29 overlay design system, 2026-04-26 overlay design process/prompt, CLAUDE.md §14 (overlay HTML contract), §15 (design system tokens)

---

## 1. Goal + Success Criteria

**Goal:** Let admins (and `design` / `production` roles) author wholly new broadcast overlays from scratch on the website — no engineering, no Claude prompts, no HTML knowledge. Cover the full design-software primitive surface (shapes / typography / colors / gradients / effects / shadows / filters), bind any element to live data feeds (standings / score / scorers / H2H / match / custom text), control entry / exit / loop animations per element (preset by default, advanced keyframe timeline opt-in), import + edit PSDs in browser via embedded Photopea, and reuse any uploaded asset (logos, images, fonts, PSDs) at any dimension across designs. Saved designs auto-register as new entries in `overlay_template_variants` under a `user-<slug>` namespace and render through a new dynamic route at `/overlay/v2/user/[slug]` that satisfies the CLAUDE.md §14 HTML contract identically to the existing built-in 27 overlays.

**Success criteria (each demonstrable end-to-end before plan is complete):**

1. An admin opens `/admin/broadcast/v2/builder`, clicks **New Design**, drops a rectangle, a text element, an image (uploaded logo), and a data-slot ("Standings Rank 1 Name"), positions and styles them, picks an entry animation, clicks **Save**. The design appears in the broadcast control panel under a new **Custom** tab within 5 seconds.
2. The OBS browser source pointed at `/overlay/v2/user/<slug>?demo=1` renders the design with the chosen layout, fonts, colors, effects, and animations, paints exactly once on `show` (no continuous-loop regression), and exits with the chosen exit animation.
3. The standings data slot auto-updates within 3 seconds when `standings.changed` fires in Realtime, matching the existing 12 auto-update overlays' contract (CLAUDE.md §14 matrix).
4. The admin uploads a 50 MB PSD, clicks **Open in Photopea**, edits a layer in the embedded Photopea iframe, hits Save in Photopea. The PSD is updated server-side and a flat PNG + per-layer PNG sprites are written to `overlay_user_assets` for canvas re-use. All round-trip in under 60 seconds for a 50 MB PSD.
5. The admin creates a **sequence** design with 3 scenes (intro → main → outro), each with a different duration and a fade transition. The OBS source plays all three scenes in order on a single `show` trigger.
6. A non-admin user (e.g. `coach` role) gets 403 on every builder route, mutation, and asset endpoint.
7. CSS validation rejects unsafe style JSON (e.g. `url(http://evil.example.com/...)`, `expression(...)`, `@import`, `behavior:`) at save time; existing `_shared/css-validator.ts` extended to cover the new style surface.
8. Custom keyframe animations go through existing `animations/sanitize_keyframes.ts`; rejection messages surface in the editor UI.
9. CSP header on `/overlay/v2/user/[slug]` blocks external script / image / connect; OBS browser source still renders correctly with `'self'` + `data:` + `blob:` allowed.
10. Append-only `overlay_user_design_history` snapshot is written on every save; admin can revert to any prior snapshot.
11. The full `npm run test` + `npm run lint` + `npm run build` + `npm --workspace apps/web run e2e` + `npm run e2e:visual-regression` pass after Wave 1A ships.

**Pre-flight (human action):**
- Confirm no existing admin route at `/admin/broadcast/v2/builder` (one-time grep).
- Confirm `overlay.design.manage` perm seeded for `admin`, `design`, `production` roles in `role_permissions` table (already shipped per CLAUDE.md §15).
- Confirm Photopea iframe embed API still available and CSP-compatible (smoke at `https://www.photopea.com/api/` before Wave 2B).

---

## 2. Scope Discipline

**In scope (all waves):**

- 6 new tables under `overlay_user_*` namespace (designs / scenes / elements / assets / fonts / history).
- 1 new Supabase Storage bucket `overlay-user-assets` (signed URLs for editor, public CDN for whitelisted published designs).
- 1 new admin route `/admin/broadcast/v2/builder` + sub-routes (`/<slug>/edit`, `/<slug>/psd`, `/assets`, `/fonts`).
- 1 new dynamic public-overlay route `/overlay/v2/user/[slug]/page.tsx` serving rendered HTML.
- 1 new server module tree `apps/web/src/server/overlays/builder/` (canvas-state validators, JSON→HTML compiler, asset uploader, font validator, PSD parser wrapper, Photopea bridge handler).
- Extension of existing `_shared/css-validator.ts` to cover the new style surface.
- Extension of `overlay_template_variants` to accept `overlay_key` values matching pattern `user-[a-z0-9-]+`.
- Photopea iframe integration via official postMessage API.
- ≥50 new unit tests + ≥4 new E2E specs + visual regression baselines for ≥3 reference user designs.

**Out of scope (deferred / explicitly NOT built):**

- **Built-in 27 overlays remain hardcoded.** The builder does not retrofit existing overlays — it adds a parallel authoring track.
- **Coach / team-manager / player authoring.** Locked to admin / design / production. Broader rollout = follow-up plan.
- **AI-assisted layout suggestions** ("make this look like a sports broadcast"). Future.
- **Vector path editing inside Photopea** ‒ Photopea handles that natively, but our canvas builder only supports SVG path import / drawing (no node editing).
- **Real-time multi-user collaboration** on the same design (Figma-style cursors). Out of scope.
- **Export to PNG / MP4 / GIF.** Designs render as live HTML only — operators can capture via OBS recording if they want a static export.
- **Mobile authoring.** Desktop only. Tablet works incidentally if pointer + window size allow but is not a target.
- **Per-user / per-team design libraries.** All designs live in one shared admin library.
- **Versioning across `overlay_template_variants` (admin marks v2 of a user design as active).** Snapshot-only revert via `overlay_user_design_history`. Multi-variant per user-slug is a follow-up if needed.

---

## 3. Data Model

All tables get `created_at`, `updated_at`, `created_by`, soft-delete `deleted_at`, audit trigger via `public.attach_audit('<table>')`. RLS attached and gates writes on `overlay.design.manage` perm via existing `hasPermAsync()` middleware.

### 3.1 `overlay_user_designs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text UNIQUE | `[a-z0-9-]+`, generated from title, mutable |
| `title` | text NOT NULL | |
| `description` | text | optional |
| `mode` | text NOT NULL CHECK IN ('single','sequence') | |
| `status` | text NOT NULL CHECK IN ('draft','published') DEFAULT 'draft' | published → visible in broadcast control panel |
| `canvas_width` | int NOT NULL DEFAULT 1920 | locked to 1920 in MVP, schema-ready for other targets |
| `canvas_height` | int NOT NULL DEFAULT 1080 | locked to 1080 in MVP |
| `created_by` | uuid FK users(id) | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

Index: `(slug)` unique, `(status, deleted_at)` partial for published listing.

### 3.2 `overlay_user_design_scenes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `design_id` | uuid FK overlay_user_designs(id) ON DELETE CASCADE | |
| `order_index` | int NOT NULL | 0-based |
| `name` | text | optional label |
| `duration_ms` | int NOT NULL DEFAULT 5000 | how long scene shows in sequence mode |
| `transition_in` | text CHECK IN ('cut','fade','slide-left','slide-right','slide-up','slide-down') DEFAULT 'fade' | |
| `transition_out` | text CHECK IN ('cut','fade','slide-left','slide-right','slide-up','slide-down') DEFAULT 'fade' | |
| `deleted_at` | timestamptz | |

Partial unique index: `(design_id, order_index) WHERE deleted_at IS NULL`.

Single-mode designs get exactly 1 scene row (enforced by app code, not schema constraint — keeps schema simple).

### 3.3 `overlay_user_design_elements`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `scene_id` | uuid FK overlay_user_design_scenes(id) ON DELETE CASCADE | |
| `parent_group_id` | uuid FK overlay_user_design_elements(id) NULL | for grouping; NULL = top-level |
| `element_type` | text NOT NULL CHECK IN ('rect','ellipse','line','polygon','path','text','image','psd-layer','data-slot','group') | |
| `z_index` | int NOT NULL | layer order within scene |
| `locked` | bool NOT NULL DEFAULT false | UI lock; ignored at render |
| `visible` | bool NOT NULL DEFAULT true | hide at render |
| `transform` | jsonb NOT NULL DEFAULT '{}'::jsonb | `{x, y, width, height, rotation, scale_x, scale_y, opacity}` |
| `style` | jsonb NOT NULL DEFAULT '{}'::jsonb | fill, stroke, shadow stack, filter stack, gradient, font-family, font-size, etc. — schema in `apps/web/src/server/overlays/builder/style-schema.ts` |
| `content` | jsonb | type-specific payload: text string, image asset_id, path d, polygon points |
| `binding` | jsonb | data-slot config: `{feed, field_path, template_string, transform}` |
| `animation` | jsonb | `{entry: {type, duration_ms, delay_ms, easing}, exit: {...}, loop: {...}, advanced_timeline: [...]}` |
| `deleted_at` | timestamptz | |

Index: `(scene_id, z_index)`.

### 3.4 `overlay_user_assets`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `asset_type` | text CHECK IN ('image','psd','font') NOT NULL | |
| `file_path` | text NOT NULL | Supabase Storage path |
| `mime_type` | text NOT NULL | |
| `original_filename` | text NOT NULL | |
| `width` | int | NULL for fonts |
| `height` | int | NULL for fonts |
| `size_bytes` | bigint NOT NULL | |
| `owner_user_id` | uuid FK users(id) | for accounting only — assets are shared in admin library |
| `psd_layer_index` | int | populated on per-layer PNG sprites extracted from a PSD via ag-psd |
| `psd_parent_asset_id` | uuid FK overlay_user_assets(id) | for layer sprites, points back to the original PSD asset |
| `flat_png_asset_id` | uuid FK overlay_user_assets(id) | for PSD assets, points to the flat-rendered PNG |
| `deleted_at` | timestamptz | |

Index: `(asset_type, deleted_at)`, `(psd_parent_asset_id)`.

### 3.5 `overlay_user_design_fonts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `family_name` | text NOT NULL | as parsed from font file |
| `weight` | int NOT NULL DEFAULT 400 | |
| `style` | text NOT NULL CHECK IN ('normal','italic') DEFAULT 'normal' | |
| `format` | text NOT NULL CHECK IN ('ttf','otf','woff','woff2') | |
| `asset_id` | uuid FK overlay_user_assets(id) NOT NULL | |
| `woff2_asset_id` | uuid FK overlay_user_assets(id) | server-converted woff2 for browser; nullable until conversion runs |
| `deleted_at` | timestamptz | |

Unique partial: `(family_name, weight, style) WHERE deleted_at IS NULL`.

### 3.6 `overlay_user_design_history`

Append-only. Mutation blocked via `overlay_user_design_history_block_mutation()` trigger (same pattern as `overlay_design_history`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `design_id` | uuid FK | |
| `snapshot` | jsonb NOT NULL | full design + scenes + elements serialized |
| `created_by` | uuid FK users(id) | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `note` | text | optional admin label ("before partner-strip swap") |

Index: `(design_id, created_at DESC)`.

### 3.7 Extension to `overlay_template_variants`

The existing table accepts arbitrary `overlay_key` strings. No schema migration needed — Wave 1A inserts rows with `overlay_key LIKE 'user-%'` and a new `html_path` value of `/overlay/v2/user/<slug>` (a server-rendered route, not a static file). A `kind` column distinguishes:

- `kind = 'static'` (existing) — points at a static HTML file under `apps/web/public/overlays/v2/<key>/index.html`.
- `kind = 'dynamic'` (new) — server route handles render. `html_path` interpreted as a Next.js route, not a filesystem path.

Migration adds the `kind` column with default `'static'` and backfills existing rows.

---

## 4. Server Module

`apps/web/src/server/overlays/builder/`

| File | Purpose |
|---|---|
| `designs.ts` | CRUD: `createDesign`, `updateDesign`, `publishDesign`, `softDeleteDesign`, `listDesigns`, `getDesign`. Each wraps `enforceAuthedWrite` + `hasPermAsync('overlay.design.manage')`. |
| `scenes.ts` | Scene CRUD, scene reorder, scene clone. |
| `elements.ts` | Element CRUD with style validation (`style-validator.ts`), binding validation (`binding-validator.ts`), animation validation (`animation-validator.ts`). |
| `style-schema.ts` | Zod schema for element `style` JSON. Branches per `element_type`. |
| `style-validator.ts` | Combines style-schema + extended `_shared/css-validator.ts` checks. Returns either parsed value or array of human-readable error strings. |
| `binding-validator.ts` | Validates feed names + field paths against the registry. Template-string parser blocks `${eval(...)}`, JS expressions, fetches; only `${feed.field}` interpolation allowed. |
| `animation-validator.ts` | Validates preset animation params + reroutes `custom-css` keyframes through existing `animations/sanitize_keyframes.ts`. |
| `compiler.ts` | `compileDesignToHtml(design, sceneIndex)`. Takes design JSON + a target scene index, returns full §14-contract HTML string: `<!DOCTYPE html><html lang="en">` + meta + `<style>` blocks + `<body>` with all elements + bootstrap + observer + Realtime data injector. Used by the dynamic route's `page.tsx`. |
| `bootstrap-template.ts` | Canonical bootstrap script literal injected into every compiled output. Reuses the shape of the existing v2 bootstrap (postMessage receiver, `cade-visible` gate, demo guard, Realtime subscribe). |
| `assets.ts` | Asset CRUD: upload (multipart → Supabase Storage), list, soft-delete. Size + MIME enforced. |
| `psd-parser.ts` | Wraps `ag-psd`. Inputs a PSD blob, outputs flat PNG bytes + per-layer PNG sprites with metadata (layer name, blend mode, opacity, x/y/w/h). Async — runs in a server action with progress reporting via Supabase Realtime. |
| `photopea-bridge.ts` | Receives postMessage from Photopea iframe, validates payload, stores resulting PSD bytes back to `overlay_user_assets`, regenerates flat PNG + sprites. |
| `fonts.ts` | Font CRUD. On upload, runs `fontkit` to extract family / weight / style, runs ttf2woff2 conversion server-side, stores woff2 alongside original. |
| `history.ts` | `snapshotDesign(designId, note?)`, `revertToSnapshot(snapshotId)`. Snapshots are append-only — `revertToSnapshot` writes a NEW row to `overlay_user_design_history` with a `revert_of` pointer (added to schema in Wave 1A) and overwrites the live tables from the snapshot payload. |
| `registry.ts` | `listUserDesigns()` for broadcast control panel. Joins `overlay_user_designs.status='published'` against `overlay_template_variants` rows where `kind='dynamic'`. |

Co-located tests for each (`*.test.ts`). All tests mock Supabase client per CLAUDE.md testing strategy.

---

## 5. Admin UI

### 5.1 `/admin/broadcast/v2/builder` (library)

- Lists existing designs in card grid: thumbnail (rendered preview), title, status badge (draft / published), last edited.
- Top-right: **New Design** button (single-mode default; toggle for sequence mode in modal).
- Sub-tabs: **Designs · Assets · Fonts** (assets and fonts have their own simpler list views; upload buttons; usage counts).

### 5.2 `/admin/broadcast/v2/builder/[slug]/edit` (canvas editor)

Layout (all panels resizable / collapsible via `react-resizable-panels`):

```
+----------------------------------------------------------+
| Top bar: title input · status · Save · Publish · Revert  |
+--+-----------------------------------------------------+--+
|  |                                                       | |
|  | Canvas (1920x1080 scaled to fit, react-konva Stage)   | |
|  |  - Drag-drop from left panel                          | |
|  |  - Selection + transform handles                      | |
|  |  - Alignment guides (Wave 1B)                         | |
|T |                                                       |P|
|o |                                                       |r|
|o |                                                       |o|
|l |                                                       |p|
|b |                                                       |e|
|a |                                                       |r|
|r |                                                       |t|
|  |                                                       |i|
|  |                                                       |e|
|  |                                                       |s|
|  +-----------------------------------------------------+ |
|  | Layers panel (collapsible bottom)                   | |
|  | + Timeline panel (collapsible, only if advanced anim)| |
+--+-----------------------------------------------------+--+
```

- **Toolbar (left, ~60 px wide):** select / rect / ellipse / line / polygon / path-pen (Wave 1C) / text / image / data-slot / Photopea / undo / redo.
- **Properties panel (right, ~320 px wide):** style + transform + binding + animation tabs. Tab visibility depends on selection (data-slot adds a "Binding" tab; group hides "Style").
- **Layers panel (bottom, collapsible):** reorder / lock / hide / group / ungroup / delete. dnd-kit drag.
- **Timeline panel (collapsible bottom, Wave 3B only):** keyframe editor.

State management via `zustand` store at `apps/web/src/state/builder/store.ts` with temporal middleware for undo/redo (max history depth 100). State persists to `localStorage` on every change with debounce — restored on tab reopen if no remote save occurred since.

### 5.3 `/admin/broadcast/v2/builder/[slug]/psd` (Photopea iframe)

Full-page iframe loading `https://www.photopea.com/?template=<signed-url-to-PSD>`. Bridge component listens for `message` events from Photopea, validates origin, persists PSD bytes back via `photopea-bridge.ts` server action, surfaces save status. Close button returns to canvas editor.

### 5.4 Live preview

Right-side dock panel (collapsible toggle on top bar) embeds an iframe pointed at `/overlay/v2/user/<slug>?demo=1&previewState=<base64-zustand-snapshot>`. The route reads `previewState` and overlays it on the persisted design, so the operator sees unsaved changes immediately. Same scaling trick from CLAUDE.md §15 (1920×1080 with `transform: scale(calc(100cqi / 1920px))`).

---

## 6. Runtime Render (`/overlay/v2/user/[slug]/page.tsx`)

Server-only render path. No client `'use client'`:

1. Read `overlay_user_designs` by slug, joined with scenes + elements (cascaded).
2. If `previewState` query param present and request comes from authenticated admin, decode + merge over persisted design (lets the live-preview iframe show unsaved changes).
3. Call `compileDesignToHtml(design, sceneIndex=0)` → returns string.
4. Return as `Response` with `Content-Type: text/html`, no client React.
5. CSP headers via `next.config.js` route-level config OR middleware: `script-src 'self' 'unsafe-inline'`; `connect-src 'self' https://<supabase-project>.supabase.co`; `img-src 'self' data: blob: https://<supabase-storage-cdn>`; `font-src 'self' data:`; `style-src 'self' 'unsafe-inline'`; `frame-ancestors *` (so OBS browser source can embed); `default-src 'none'`.

The compiled HTML satisfies CLAUDE.md §14 contract:

- `<!DOCTYPE html><html lang="en">` + `<meta charset="UTF-8" />` + `<meta name="color-scheme" content="dark" />`.
- `html, body { background: transparent !important; color-scheme: dark; }`, `body { opacity: 1 !important; }`.
- No literal `cade-visible` on `<html>`.
- Every element gated via `body.cade-visible .X { opacity: 1 }` + `body.cade-exiting .X { opacity: 0 }`.
- `cade-visible-gate-observer-v2` MutationObserver injected for every gated element.
- postMessage handler for `{type:'show'|'hide'|'update', data, slot?}` envelope.
- Brand fonts loaded via `@font-face`.
- Asset paths via `/overlay-user-assets/<bucket-path>` (signed URLs for previews, public CDN for published).
- Demo loop guarded by `?demo=1`.
- Body sized 1920×1080, `overflow: hidden`.

The Realtime data injector subscribes to the relevant channels per the data-slot bindings present on the design (e.g. design uses a Standings slot → subscribe to `standings.changed`). Initial-fetch endpoints mirror the existing CLAUDE.md §14 matrix exactly.

---

## 7. Data Binding

### 7.1 Bindable feeds

Reuses the existing initial-fetch + Realtime infrastructure. Builder UI catalog:

| Feed | Initial-fetch endpoint | Realtime keys | Available fields |
|---|---|---|---|
| `standings` | `/api/broadcast/sessions/<id>/leaderboard` | `standings.changed`, `snapshot.captured` | rank, name, P, W, D, L, GF, GA, GD, Pts, badgeUrl, photoUrl |
| `live_score` | (event-driven) | `score.changed` | home_name, away_name, home_score, away_score, minute, clock |
| `top_scorers` | `/api/broadcast/sessions/<id>/top-scorers` | `match.ended`, `standings.changed` | rank, name, goals, photoUrl |
| `h2h` | `/api/broadcast/sessions/<id>/h2h?key=<key>` | `standings.changed` | per-player: name, position, P, W, D, L, GF, GA, GD, Pts, winProbPct |
| `match` | `/api/broadcast/sessions/<id>/match-scores-day` | `score.changed`, `match.ended`, `standings.changed` | current match metadata |
| `match_day` | `/api/broadcast/sessions/<id>/match-day` | `match.ended` | list of upcoming fixtures |
| `custom_text` | (operator-driven via broadcast control panel) | `custom_text.<slot_id>.changed` | string |

Each catalog entry has typed `field_path` autocomplete in the binding UI.

### 7.2 Slot Insert (default)

Sidebar `📊 Data` lists categorized slot presets (one entry per `(feed, field_path)` combination plus a few composites like "Top 3 standings table"). User clicks → an element appears pre-styled and pre-bound. Same `element_type` as manual (text or image), no special handling.

### 7.3 Manual Bind

Properties panel **Binding** tab on any text or image element. User picks feed → field. Text supports template strings: `${standings[0].name} (${standings[0].points} pts)`. Parser allowlist limited to `${feed.path}` interpolations — no JS expressions, no method calls, no operators inside braces.

### 7.4 Binding resolution at render

Server-side: `compiler.ts` walks elements, finds those with `binding` populated, emits JS in the bootstrap that subscribes to the relevant Realtime channels and listens for initial-fetch hydration. Same pattern as the existing 12 auto-update overlays — extracted into a single shared bootstrap fragment.

Image bindings resolve `photoUrl` per element via the existing `apps/web/src/server/overlays/player-photos/resolver.ts` (per-overlay → global → legacy → pose 1). Variant kind (headshot / card / fullbody) configurable per data-slot via a new field in the binding JSON (default headshot for image slots).

---

## 8. Animation

### 8.1 Preset mode (default, ships Wave 1A)

Per-element dropdown for entry / exit / loop. Animation types: `slide-left`, `slide-right`, `slide-up`, `slide-down`, `fade`, `scale`, `rotate`, `bounce`, `pulse`, `glow`, `shake`, `flip`, `custom-css` (existing §15.B types).

Inputs: `duration_ms`, `delay_ms`, `easing` (named curve dropdown + custom cubic-bezier).

Stored in `overlay_user_design_elements.animation` JSON. Server emits `@keyframes` + per-element `animation:` rules at compile time, identical compilation path to existing `overlay_element_animations` table — same sanitizer, same keyframe builder.

### 8.2 Advanced timeline mode (Wave 3B)

Click "Timeline" in properties panel → bottom timeline opens. Per-element track with draggable keyframes per property (opacity, x, y, scale_x, scale_y, rotation, color, filter). Bezier easing handle between keyframes.

Stored under `animation.advanced_timeline` array: `[{ property, keyframes: [{ time_ms, value, easing_out }, ...] }]`. Compiler converts to `@keyframes` blocks.

Preset and advanced modes are mutually exclusive per (element, phase). Switching to advanced clears preset for that phase and vice versa.

---

## 9. PSD Workflow

### 9.1 Upload-only path (Wave 2A)

1. Admin uploads PSD via `/admin/broadcast/v2/builder/assets` (or directly from canvas via "Place PSD" toolbar action).
2. Server action runs `ag-psd` to parse: extracts layer tree, flattens to PNG (full canvas size), and writes one PNG sprite per layer (cropped to layer bounds, transparent BG).
3. PSD bytes stored at `overlay-user-assets/psd/<uuid>.psd`. Flat PNG at `overlay-user-assets/psd/<uuid>-flat.png`. Per-layer sprites at `overlay-user-assets/psd/<uuid>-layer-<n>.png` with metadata in `overlay_user_assets` (one row per sprite, `psd_parent_asset_id` set to the parent PSD's id).
4. Builder UI's **Place PSD** flow lists the layers; user picks individual layers to drop onto canvas as image elements, or picks "Flatten" to drop the single composite PNG.

### 9.2 Photopea iframe path (Wave 2B)

1. Admin opens an existing PSD asset → clicks "Open in Photopea" → routes to `/admin/broadcast/v2/builder/[slug]/psd?assetId=<id>`.
2. The page loads `<iframe src="https://www.photopea.com/?s=app#open=<signed-storage-url>">`. Photopea downloads the PSD from the signed URL.
3. Admin edits in Photopea.
4. On save, our bridge sends Photopea a postMessage `app.activeDocument.saveToOE()` requesting a PSD export. Photopea responds with PSD bytes via postMessage.
5. Bridge validates payload size and MIME, writes new PSD to storage (overwriting the asset, soft-deleting prior version into history if changed), re-runs `psd-parser.ts` to regenerate flat PNG + sprites.
6. Status surfaces in our admin UI: "Saving... Done." with progress for large files.

### 9.3 Size + memory enforcement

- Hard cap 100 MB per PSD (server rejects above).
- Soft warn 50 MB in UI ("Files this large may load slowly").
- PSD parsing offloaded from request thread via Vercel background function or queued via Supabase Queues — under 30 s for 50 MB PSDs, under 2 min for 100 MB.
- Flat PNG generation downsampled to canvas resolution (1920×1080 max) — sprites preserved at original-layer resolution up to per-layer max dimension.

---

## 10. Asset Library

`/admin/broadcast/v2/builder/assets` lists all assets across types. Filter chips: image / PSD / font. Each card shows thumbnail, dimensions, size, original filename, count of designs using it, soft-delete button.

Upload limits:

- Images: PNG, JPG, WebP, sanitized SVG. Cap 10 MB.
- PSDs: cap 100 MB.
- Fonts: TTF, OTF, WOFF, WOFF2. Cap 5 MB.

Assets are shared across the entire admin team — no per-user library. Soft-delete hides from picker but does not break designs already using the asset (designs preserve `asset_id` references and resolve as broken-image placeholders if asset is hard-deleted, which we never do via UI).

SVG sanitization: strip `<script>`, `on*` attributes, `<foreignObject>`, external `href` references; whitelist tags via `svg-sanitizer` (npm `dompurify`'s SVG profile).

Custom fonts: on upload, fontkit parses family / weight / style. Server-side ttf2woff2 conversion runs in background. UI lists the font in the family picker once woff2 conversion completes (~2-5 s for typical fonts).

---

## 11. Sub-Wave Decomposition

Each wave has its own implementation plan written via the `superpowers:writing-plans` skill after this spec is approved. Plans land at `docs/superpowers/plans/2026-05-17-overlay-builder-wave-<N>.md`. Each wave is a separately mergeable PR.

| Wave | Scope | Est. duration |
|---|---|---|
| **1A** | Canvas core (rect/text/image), solid colors, basic drop-shadow, curated fonts, layers panel, undo/redo, save+load, slot-insert data binding, preset animations, render to §14 HTML via `compiler.ts`, new `/overlay/v2/user/[slug]` route, broadcast control panel Custom tab. **First publishable design at end of wave.** | ~3 wk |
| **1B** | Gradients, ellipse / line / polygon shapes, custom font upload, CSS filters (blur / brightness / hue / saturate), multi-stack shadows, manual data bind, alignment guides + snap. | ~3 wk |
| **1C** | Path / pen tool, grouping, multi-select bulk transform, undo polish, copy / paste, keyboard shortcuts. | ~2 wk |
| **2A** | PSD upload + server layer-extract via `ag-psd`, place-as-image flow. | ~1 wk |
| **2B** | Photopea iframe + postMessage bridge + save flow. | ~2 wk |
| **3A** | Multi-scene authoring, sequence runtime + transitions. | ~1.5 wk |
| **3B** | Advanced keyframe timeline editor. | ~3 wk |

Sequential total: ~15-16 weeks. Parallelizable via background agents on independent waves (1A + 2A + 3A can run in parallel after Wave 1A's data model + server module land) → wall-clock ~10-12 weeks.

---

## 12. Security Spine

- All write actions gated on `hasPermAsync('overlay.design.manage')` + `enforceAuthedWrite` rate limit.
- Style JSON validated via `style-validator.ts` (Zod schema + existing `_shared/css-validator.ts` regex pass). Rejects: external `url()`, `expression()`, `@import`, `behavior:`, JavaScript pseudo-protocol, `data:text/html`, position outside canvas bounds.
- Binding template strings parsed via `binding-validator.ts` allowlist. Rejects JS expressions, method calls, operators.
- Animation `custom-css` keyframes through existing `animations/sanitize_keyframes.ts` allowlist.
- Font uploads validated via fontkit (parse must succeed; only TTF / OTF / WOFF / WOFF2 MIME accepted).
- Image uploads sniffed via magic-bytes (npm `file-type`); MIME must match extension.
- SVGs run through DOMPurify SVG profile server-side before storage.
- PSDs only parsed via `ag-psd`; bytes never executed.
- Compiled output server-rendered as static HTML — user cannot inject runtime `<script>`. Bootstrap injected from canonical template literal in `bootstrap-template.ts`.
- CSP header on `/overlay/v2/user/[slug]` (§6) prevents external script / fetch / image.
- Photopea iframe sandboxed via `<iframe sandbox="allow-scripts allow-same-origin" src="...">`. postMessage `event.origin === 'https://www.photopea.com'` checked before processing.
- Audit trail: every design / scene / element / asset row triggers `audit_row_change()`. `overlay_user_design_history` append-only snapshots for revert.
- Storage RLS: `overlay-user-assets` bucket gates reads on `overlay.design.manage` perm via Supabase RLS policy; published designs use a signed-URL-via-route pattern (route checks design.status='published' before serving asset).

---

## 13. Testing

### 13.1 Unit (Vitest)

- `designs.test.ts`, `scenes.test.ts`, `elements.test.ts` — CRUD happy paths + perm denial + soft-delete behavior.
- `style-validator.test.ts` — golden table of valid + invalid style JSON.
- `binding-validator.test.ts` — golden table of valid + invalid template strings.
- `animation-validator.test.ts` — preset + custom-css cases.
- `compiler.test.ts` — given fixture design JSON, assert compiled HTML satisfies §14 contract (regex check for required meta + body + observer).
- `psd-parser.test.ts` — small fixture PSD → assert flat PNG dimensions + per-layer sprite count.
- `photopea-bridge.test.ts` — postMessage payload validation, origin check.
- `assets.test.ts`, `fonts.test.ts` — upload validation, size + MIME enforcement.
- `history.test.ts` — snapshot + revert round-trip.

Target ≥50 new unit tests. All Supabase clients mocked.

### 13.2 E2E (Playwright)

- `overlay-builder-create-design.spec.ts` — login admin → create design → drop 3 elements → save → assert DB rows.
- `overlay-builder-data-binding.spec.ts` — drop Standings slot → publish → fetch `/overlay/v2/user/<slug>` → assert HTML contains expected `data-element-id` + initial standings.
- `overlay-builder-animations.spec.ts` — set entry slide-left + exit fade → render → assert `@keyframes` + animation rules present.
- `overlay-builder-perms.spec.ts` — non-admin gets 403 on all routes + mutations.

### 13.3 Visual regression

Extend `apps/web/tests/e2e/visual-regression-baseline.spec.ts` with ≥3 reference user designs (saved as fixtures), assert <0.1% pixel diff against baselines.

### 13.4 Smoke

`apps/web/scripts/_overlay-builder-smoke.mjs` — generate 100 random valid design JSONs via Zod-aware fuzz, POST → render → assert no compile errors + DOM matches expected element count.

---

## 14. Risks + Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Photopea iframe API changes / breaks | Low | Medium | Smoke test pre-Wave 2B, fall back to upload-only flow if broken, document Photopea version pin in spec |
| PSD parsing OOMs on large files | Medium | Medium | Size cap 100 MB, downsample flat PNG, offload to background function, surface friendly error |
| Visual regression baselines drift | High | Low | Update via `npm run e2e:visual-regression:update` after intentional changes; commit baseline updates in same PR |
| Compiled HTML diverges from §14 contract | High | High | `compiler.test.ts` asserts every required §14 element; visual regression spec catches rendering breaks; manual smoke test before merge per CLAUDE.md §11 |
| Custom keyframes bypass sanitizer | Low | High | Reuse battle-tested existing `animations/sanitize_keyframes.ts`; add explicit test cases covering bypass attempts |
| CSP breaks OBS rendering | Medium | High | E2E spec mounts compiled HTML in headless browser, verifies all elements render + animations fire; manual verification in OBS browser source before each wave ships |
| User uploads malicious SVG | Medium | High | DOMPurify SVG profile server-side; explicit test cases for known SVG XSS payloads |
| Realtime binding for 10+ data slots floods channels | Low | Medium | Compiler dedupes channel subscriptions (one subscribe per channel, not per slot); already done for existing overlays |
| Photopea iframe origin spoofed | Low | High | `event.origin === 'https://www.photopea.com'` strict check; postMessage payload Zod-validated; sandbox attribute restricts iframe capabilities |
| Designer team feedback says "missing X feature" mid-build | High | Low | Sub-waves shipped independently — Wave 1A is usable end-of-wave-1A; gather feedback then; adjust Wave 1B/1C/2/3 scope |

---

## 15. Rollback

Each wave behind a feature flag in `apps/web/src/lib/feature-flags.ts`:

- `overlayBuilder.enabled` — toggle admin route visibility.
- `overlayBuilder.publishEnabled` — gate publish action.
- `overlayBuilder.photopeaEnabled` — gate Photopea iframe route.

If a wave ships breaking the runtime, flip the flag, hide the admin tab, leave data in place (soft-delete only via UI never hard-delete via migration). Existing 27 overlays untouched throughout — built-in broadcast remains operable.

DB migrations: every migration is additive (new tables, new columns with safe defaults). No destructive migration. Rollback by truncating new tables if needed (development only — production rollback prefers feature flag off + leaving data).

---

## 16. Open Questions (resolve before Wave 1A plan)

- **None remaining as of 2026-05-17 brainstorm.** All conceptual decisions locked (see memory `project_overlay_builder_2026_05_17.md`). Implementation plan (writing-plans skill) will surface any additional questions per wave.

---

## 17. Acceptance + Sign-off

Acceptance gates per CLAUDE.md verification discipline:

1. `npm run test` — all unit tests pass.
2. `npm run lint` — clean.
3. `npm run build` — clean production build.
4. `npm --workspace apps/web run e2e` — every E2E spec passes.
5. `npm run e2e:visual-regression` — pixel-diff baselines hold.
6. Manual end-to-end through Chrome browser automation per CLAUDE.md §11: log in as admin, create a design, drop elements, bind data, animate, save, render in OBS browser source, verify all §14 contract pieces present.
7. Live verification through every route from CLAUDE.md §12 post-push table.

Sign-off: only after success criteria 1-11 in §1 above all demonstrate end-to-end.
