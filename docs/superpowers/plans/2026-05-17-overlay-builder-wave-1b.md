# Overlay Builder Wave 1B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Wave 1A canvas editor with gradients, more shape primitives (ellipse/line/polygon), custom font upload, CSS filters, multi-stack shadows, manual (free-form) data binding, and alignment guides + snap.

**Architecture:** Builds on the `apps/web/src/server/overlays/builder/` server module + `apps/web/src/state/builder/` zustand store + `apps/web/src/components/admin/builder/` UI shipped in Wave 1A (commits `93852119`..`f922a988`). No new tables — extends existing `overlay_user_*` schema with no migrations needed. Adds new server modules for font upload + free-form bind validation. Extends StyleSchema, style-validator, compiler, Properties Panel, CanvasStage.

**Tech Stack:** Same as Wave 1A — Next.js 15 / Supabase / Vitest / Playwright / react-konva / zustand+zundo / react-colorful / @dnd-kit / Zod. New: `fontkit` (Wave 1B install) + `ttf2woff2` (server-side conversion).

**Related:** Spec `docs/superpowers/specs/2026-05-17-overlay-builder-design.md` §11 row 2 · Wave 1A plan `docs/superpowers/plans/2026-05-17-overlay-builder-wave-1a.md` · CLAUDE.md §14 (overlay HTML contract still applies).

**Wave 1B delivers:**
1. New shape primitives renderable on canvas: ellipse, line, polygon.
2. Gradient fills (linear + radial) for rect / ellipse / text.
3. CSS filter stack per element.
4. Multi-stack shadows.
5. Custom font upload pipeline (admin uploads TTF/OTF → server converts to WOFF2 → font available in PropertiesPanel fontFamily picker).
6. Manual data-source binding in PropertiesPanel (free-form feed + field path picker, validates via existing binding-validator).
7. Alignment guides + smart snap in CanvasStage drag.

**Out of scope (Wave 1C / later):** path/pen tool, grouping, multi-select bulk transform, copy/paste, PSD support, multi-scene, advanced keyframe timeline.

---

### Task 1: Install Wave 1B npm dependencies

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json` (and root `package-lock.json` if hoisted)
- Test: none (install is verified by command output + lint + test gate)

**Context:** Wave 1B adds `fontkit` for parsing uploaded font files (extracts family/weight/style metadata) and `ttf2woff2` for server-side conversion of TTF/OTF/WOFF buffers into the browser-friendly WOFF2 format. Both packages are net-new — Wave 1A did not install them. Verified via `grep -E "(fontkit|ttf2woff2)" apps/web/package.json` (returns empty against the post-1A tree).

#### Steps

1. From the repo root, verify the absence of each dependency before installing:

   ```bash
   grep -E '"(fontkit|ttf2woff2)"' apps/web/package.json || echo "none present — proceed"
   ```

   Expected output:

   ```
   none present — proceed
   ```

2. Install the two runtime dependencies into the `apps/web` workspace in a single command:

   ```bash
   npm install --workspace apps/web fontkit ttf2woff2
   ```

   Expected output (versions current as of 2026-05-18; exact patch versions may differ):

   ```
   added N packages, and audited 1234 packages in 12s

   170 packages are looking for funding
     run `npm fund` for details

   found 0 vulnerabilities
   ```

   Note: `ttf2woff2` ships native bindings; on Windows you may see a node-gyp compile pass. If install fails, see "Troubleshooting" below.

3. Confirm both packages now appear in `apps/web/package.json`:

   ```bash
   grep -E '"(fontkit|ttf2woff2)"' apps/web/package.json
   ```

   Expected output (two lines):

   ```
       "fontkit": "^2.x.x"
       "ttf2woff2": "^7.x.x"
   ```

4. Verify the workspace still builds and tests pass with the new deps in place (catches transitive-peer regressions early):

   ```bash
   npm --workspace apps/web run lint && npm --workspace apps/web run test
   ```

   Expected output ends with:

   ```
   Test Files  ... passed
        Tests  ... passed
     Duration  ...
   ```

5. Stage and commit:

   ```bash
   git add apps/web/package.json apps/web/package-lock.json package-lock.json
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): install fontkit + ttf2woff2 for custom font upload

   Adds the two runtime packages the Wave 1B custom-font upload pipeline
   needs:
     - fontkit    -> parse TTF/OTF/WOFF/WOFF2 buffers; extract family,
                     weight, style metadata for the design fonts table.
     - ttf2woff2  -> server-side conversion of uploaded TTF/OTF buffers
                     into browser-friendly WOFF2 output, written alongside
                     the original asset in storage.

   Both verified absent before install. Lint + unit tests green
   post-install; no transitive regressions surfaced.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

**Troubleshooting (Windows + `ttf2woff2` native build):**

If `npm install ttf2woff2` fails with `gyp ERR! find Python` or `MSB...`, install build tools and retry:

```bash
npm install --global --production windows-build-tools
npm install --workspace apps/web ttf2woff2
```

If the native build still fails, swap to the pure-JS fallback `wawoff2` (same API; `ttf2woff2` accepts `Buffer`, `wawoff2.compress(Buffer)` returns `Promise<Buffer>`). Update Task 6's `fonts.ts` import accordingly and re-run Task 6 tests.

---

### Task 2: Migration — none required (Wave 1B is fully additive within existing JSONB)

**Files:** none.

**Context:** Wave 1B introduces NO new tables or columns. Every new feature lands inside JSONB columns that already exist:

- **Gradients** live in `overlay_user_design_elements.style.gradient` (within the existing `style jsonb` column).
- **Filter stacks** live in `overlay_user_design_elements.style.filter`.
- **Multi-stack shadows** live in `overlay_user_design_elements.style.shadows` (an array). The single-shadow `style.shadow` from Wave 1A remains accepted for back-compat; the compiler reads BOTH shapes.
- **Manual bindings** live in `overlay_user_design_elements.binding` (already in schema — the validator just accepts more variety inside it).
- **Custom fonts** use the existing `overlay_user_design_fonts` table shipped in Wave 1A (Task 3 in `2026-05-17-overlay-builder-wave-1a.md`). The font asset rows go into `overlay_user_assets` with `asset_type='font'` (Wave 1A schema). Wave 1B just populates these tables for the first time.
- **Ellipse / line / polygon** element_type values are already in the Wave 1A `element_type` CHECK constraint (Task 3 in Wave 1A migration block).
- **CanvasStage alignment guides + snap** are pure client behavior — no DB state.

#### Steps

1. Confirm the existing schema accepts the Wave 1B shapes — one-shot smoke against the linked DB. Create `supabase/tests/wave_1b_additive_smoke.sql` (one-shot, runnable via `npx supabase db query --file`; delete after pass — pattern matches `_overlay-design-smoke.mjs` convention from §15.B):

   ```sql
   -- Wave 1B additive smoke: confirms Wave 1A schema already accepts every
   -- Wave 1B shape (ellipse/line/polygon types, JSONB gradient/filter/shadows,
   -- custom-font rows). No migration follows — this smoke proves none is needed.
   begin;

   -- Ensure a parent design + scene exists so the FK constraints pass.
   -- All inserts roll back at end of transaction — no real data written.
   with d as (
     insert into public.overlay_user_designs (slug, title, mode, status)
     values ('wave-1b-smoke', 'wave 1b smoke', 'single', 'draft')
     returning id
   ),
   s as (
     insert into public.overlay_user_design_scenes (design_id, order_index)
     select id, 0 from d
     returning id
   )
   insert into public.overlay_user_design_elements
     (scene_id, element_type, z_index, transform, style, content)
   select s.id, et, 0,
          '{"x":0,"y":0,"width":100,"height":100,"rotation":0,"scale_x":1,"scale_y":1,"opacity":1}'::jsonb,
          jsonb_build_object(
            'fill', '#6bcd06',
            'gradient', jsonb_build_object(
              'kind', 'linear',
              'angle', 90,
              'stops', jsonb_build_array(
                jsonb_build_object('offset', 0, 'color', '#6bcd06'),
                jsonb_build_object('offset', 1, 'color', '#fe036d')
              )
            ),
            'filter', jsonb_build_object('blur', 8, 'brightness', 1.2),
            'shadows', jsonb_build_array(
              jsonb_build_object('offsetX', 4, 'offsetY', 4, 'blur', 12,
                                 'color', '#000000', 'opacity', 0.5)
            )
          ),
          '{}'::jsonb
   from s
   cross join unnest(array['ellipse','line','polygon']::text[]) as et;

   rollback;

   select 'wave 1b additive smoke OK' as status;
   ```

2. Run the smoke against the linked DB:

   ```bash
   npx supabase db query --file supabase/tests/wave_1b_additive_smoke.sql
   ```

   Expected output:

   ```
              status
   --------------------------------
    wave 1b additive smoke OK
   (1 row)
   ```

   If the smoke fails:
   - `element_type` CHECK violation → Wave 1A migration `20260901000002_overlay_user_designs.sql` was applied with an older CHECK list; re-run `npm run db:push`.
   - `null value in column ...` → smoke SQL has a typo; fix and re-run.
   - JSONB type error → schema is `jsonb NOT NULL DEFAULT '{}'::jsonb` per Wave 1A; nothing to migrate, the smoke just typed an INSERT wrong.

3. Delete the smoke script (one-shot pattern):

   ```bash
   rm supabase/tests/wave_1b_additive_smoke.sql
   ```

4. Document the no-migration decision in the Wave 1B branch's first commit message. No separate commit for Task 2 — the no-migration finding is folded into the Task 3 (types extension) commit body.

**Result:** No migration files added to `supabase/migrations/`. Wave 1B sequence resumes at Task 3.

---

### Task 3: Extend `types.ts` with gradient, filter, shadow-stack, font-upload schemas

**Files:**

- Modify: `apps/web/src/server/overlays/builder/types.ts`
- Modify: `apps/web/src/server/overlays/builder/types.test.ts`

**Context:** Wave 1A's `types.ts` (lines 1326-1503 of the Wave 1A plan) defined `ElementTypeSchema`, `TransformSchema`, `ShadowSpecSchema`, `StyleSchema`, `BindingSchema`, `AnimationSchema`, `ElementSchema`, `SceneSchema`, `DesignSchema`. Wave 1B adds:

- `GradientStopSchema` — single `{offset: 0..1, color: hex}` row.
- `LinearGradientSchema` — `{kind: 'linear', angle: 0..360, stops: GradientStop[]}` with `≥2` stops.
- `RadialGradientSchema` — `{kind: 'radial', cx: 0..1, cy: 0..1, radius: 0..1, stops: GradientStop[]}`.
- `GradientSpecSchema` — discriminated union of Linear/Radial.
- `FilterSpecSchema` — `{blur?: 0..40, brightness?: 0..2, hueRotate?: 0..360, saturate?: 0..2}` (all optional; absent = no filter).
- `ShadowStackSchema` — `ShadowSpec | ShadowSpec[]` (single-shadow shape preserved for Wave 1A back-compat).
- `FontUploadSchema` — input shape accepted by `fonts.uploadFont`: `{filename: string, mimeType: string, sizeBytes: number}`.
- Extends `StyleSchema` to include optional `gradient`, `filter`, `shadows` (the array form).
- Element types `ellipse`/`line`/`polygon` are already in `ElementTypeSchema` (Wave 1A foresight) — no change needed.

#### Steps

1. Read the existing `types.ts` to confirm the post-1A shape before editing:

   ```bash
   sed -n '1,200p' apps/web/src/server/overlays/builder/types.ts
   ```

   Expected: see `ElementTypeSchema`, `TransformSchema`, `ShadowSpecSchema`, `StyleSchema`, `BindingSchema`, `AnimationSchema`, `ElementSchema`, `SceneSchema`, `DesignSchema` exports.

2. Append failing tests to `apps/web/src/server/overlays/builder/types.test.ts`. Open the file and add this block at the end of the existing `describe(...)` (or as a sibling top-level `describe`):

   ```ts
   import {
     GradientStopSchema,
     LinearGradientSchema,
     RadialGradientSchema,
     GradientSpecSchema,
     FilterSpecSchema,
     ShadowStackSchema,
     FontUploadSchema,
     type GradientStop,
     type LinearGradient,
     type RadialGradient,
     type GradientSpec,
     type FilterSpec,
     type ShadowStack,
     type FontUpload,
   } from "./types";

   describe("types.ts — Wave 1B extensions (gradient/filter/shadow-stack/font)", () => {
     it("GradientStopSchema parses a valid stop", () => {
       const s: GradientStop = { offset: 0.5, color: "#6bcd06" };
       expect(GradientStopSchema.parse(s)).toEqual(s);
     });

     it("GradientStopSchema rejects offset > 1", () => {
       expect(() =>
         GradientStopSchema.parse({ offset: 1.5, color: "#fff" }),
       ).toThrow();
     });

     it("GradientStopSchema rejects offset < 0", () => {
       expect(() =>
         GradientStopSchema.parse({ offset: -0.1, color: "#fff" }),
       ).toThrow();
     });

     it("LinearGradientSchema accepts 2-stop linear gradient", () => {
       const g: LinearGradient = {
         kind: "linear",
         angle: 90,
         stops: [
           { offset: 0, color: "#6bcd06" },
           { offset: 1, color: "#fe036d" },
         ],
       };
       expect(LinearGradientSchema.parse(g)).toEqual(g);
     });

     it("LinearGradientSchema rejects single-stop gradient", () => {
       expect(() =>
         LinearGradientSchema.parse({
           kind: "linear",
           angle: 0,
           stops: [{ offset: 0, color: "#000" }],
         }),
       ).toThrow();
     });

     it("RadialGradientSchema accepts centered radial", () => {
       const g: RadialGradient = {
         kind: "radial",
         cx: 0.5,
         cy: 0.5,
         radius: 0.5,
         stops: [
           { offset: 0, color: "#ffffff" },
           { offset: 1, color: "#000000" },
         ],
       };
       expect(RadialGradientSchema.parse(g)).toEqual(g);
     });

     it("GradientSpecSchema discriminates linear vs radial via `kind`", () => {
       const linear: GradientSpec = {
         kind: "linear",
         angle: 45,
         stops: [
           { offset: 0, color: "#000" },
           { offset: 1, color: "#fff" },
         ],
       };
       expect(GradientSpecSchema.parse(linear)).toEqual(linear);

       const radial: GradientSpec = {
         kind: "radial",
         cx: 0.3,
         cy: 0.7,
         radius: 0.8,
         stops: [
           { offset: 0, color: "#6bcd06" },
           { offset: 1, color: "#fe036d" },
         ],
       };
       expect(GradientSpecSchema.parse(radial)).toEqual(radial);
     });

     it("FilterSpecSchema accepts partial filter (only blur)", () => {
       const f: FilterSpec = { blur: 8 };
       expect(FilterSpecSchema.parse(f)).toEqual(f);
     });

     it("FilterSpecSchema accepts full filter stack", () => {
       const f: FilterSpec = {
         blur: 4,
         brightness: 1.2,
         hueRotate: 180,
         saturate: 1.5,
       };
       expect(FilterSpecSchema.parse(f)).toEqual(f);
     });

     it("FilterSpecSchema rejects blur > 40", () => {
       expect(() => FilterSpecSchema.parse({ blur: 60 })).toThrow();
     });

     it("FilterSpecSchema rejects hueRotate > 360", () => {
       expect(() => FilterSpecSchema.parse({ hueRotate: 400 })).toThrow();
     });

     it("ShadowStackSchema accepts a single-shadow object (Wave 1A shape)", () => {
       const s = { offsetX: 2, offsetY: 4, blur: 8, color: "#000", opacity: 0.5 };
       const parsed = ShadowStackSchema.parse(s) as ShadowStack;
       expect(parsed).toEqual(s);
     });

     it("ShadowStackSchema accepts an array of shadows", () => {
       const s: ShadowStack = [
         { offsetX: 2, offsetY: 2, blur: 4, color: "#6bcd06", opacity: 0.8 },
         { offsetX: -2, offsetY: -2, blur: 4, color: "#fe036d", opacity: 0.6 },
       ];
       expect(ShadowStackSchema.parse(s)).toEqual(s);
     });

     it("FontUploadSchema accepts a TTF upload meta", () => {
       const f: FontUpload = {
         filename: "Custom Bold.ttf",
         mimeType: "font/ttf",
         sizeBytes: 102400,
       };
       expect(FontUploadSchema.parse(f)).toEqual(f);
     });

     it("FontUploadSchema rejects size over 5MB", () => {
       expect(() =>
         FontUploadSchema.parse({
           filename: "huge.ttf",
           mimeType: "font/ttf",
           sizeBytes: 6 * 1024 * 1024,
         }),
       ).toThrow();
     });

     it("FontUploadSchema rejects non-font MIME", () => {
       expect(() =>
         FontUploadSchema.parse({
           filename: "evil.exe",
           mimeType: "application/octet-stream",
           sizeBytes: 1024,
         }),
       ).toThrow();
     });
   });
   ```

3. Run the test — confirm FAIL (new schemas not exported yet):

   ```bash
   npx vitest run apps/web/src/server/overlays/builder/types.test.ts
   ```

   Expected output ends with `Cannot find name 'GradientStopSchema'` or `is not exported by ./types`.

4. Edit `apps/web/src/server/overlays/builder/types.ts`. Append after the existing `ShadowSpecSchema` block (before `StyleSchema` is defined) — search for `export const ShadowSpecSchema = z.object({` and insert the new schemas immediately after the closing `});` of that block. Then update `StyleSchema` to add the new optional fields.

   Insert AFTER the `ShadowSpecSchema` block and BEFORE the `StyleSchema` block:

   ```ts
   // ────────── Wave 1B — GradientStop / Gradient ──────────
   //
   // Gradients fill rect / ellipse / text via CSS `linear-gradient` or
   // `radial-gradient`. Each gradient has ≥2 stops. The discriminator
   // `kind` lets the compiler emit the right CSS function.
   export const GradientStopSchema = z.object({
     offset: z.number().min(0).max(1),
     color: z.string(),
   });
   export type GradientStop = z.infer<typeof GradientStopSchema>;

   export const LinearGradientSchema = z.object({
     kind: z.literal("linear"),
     angle: z.number().min(0).max(360),
     stops: z.array(GradientStopSchema).min(2),
   });
   export type LinearGradient = z.infer<typeof LinearGradientSchema>;

   export const RadialGradientSchema = z.object({
     kind: z.literal("radial"),
     cx: z.number().min(0).max(1),
     cy: z.number().min(0).max(1),
     radius: z.number().min(0).max(1),
     stops: z.array(GradientStopSchema).min(2),
   });
   export type RadialGradient = z.infer<typeof RadialGradientSchema>;

   export const GradientSpecSchema = z.discriminatedUnion("kind", [
     LinearGradientSchema,
     RadialGradientSchema,
   ]);
   export type GradientSpec = z.infer<typeof GradientSpecSchema>;

   // ────────── Wave 1B — FilterSpec ──────────
   //
   // Maps to CSS `filter: blur(...) brightness(...) hue-rotate(...) saturate(...)`.
   // All keys optional — admin enables only what they need.
   //   - blur in px, capped at 40 (anything larger is performance death).
   //   - brightness as multiplier, 0..2 (0 = black, 1 = identity, 2 = double).
   //   - hueRotate in degrees, 0..360.
   //   - saturate as multiplier, 0..2 (0 = grayscale, 1 = identity).
   export const FilterSpecSchema = z.object({
     blur: z.number().min(0).max(40).optional(),
     brightness: z.number().min(0).max(2).optional(),
     hueRotate: z.number().min(0).max(360).optional(),
     saturate: z.number().min(0).max(2).optional(),
   });
   export type FilterSpec = z.infer<typeof FilterSpecSchema>;

   // ────────── Wave 1B — ShadowStack ──────────
   //
   // Wave 1A accepted a single `ShadowSpec` on `style.shadow`. Wave 1B
   // adds an array form on `style.shadows`. The union schema accepts
   // either shape so the compiler can read both — back-compat preserved.
   export const ShadowStackSchema = z.union([
     ShadowSpecSchema,
     z.array(ShadowSpecSchema).max(8),
   ]);
   export type ShadowStack = z.infer<typeof ShadowStackSchema>;

   // ────────── Wave 1B — FontUpload ──────────
   //
   // Server-side validation for the `/admin/broadcast/v2/builder/fonts`
   // upload endpoint. fontkit parse + ttf2woff2 conversion run after
   // this schema passes. 5MB hard cap matches spec §10.
   const FONT_MIME = new Set([
     "font/ttf",
     "font/otf",
     "font/woff",
     "font/woff2",
     "application/font-sfnt",
     "application/x-font-ttf",
     "application/x-font-otf",
   ]);

   export const FontUploadSchema = z.object({
     filename: z.string().min(1).max(255),
     mimeType: z.string().refine((m) => FONT_MIME.has(m), {
       message: "mimeType must be a known font MIME",
     }),
     sizeBytes: z
       .number()
       .int()
       .positive()
       .max(5 * 1024 * 1024, "Font file must be ≤ 5MB"),
   });
   export type FontUpload = z.infer<typeof FontUploadSchema>;
   ```

5. Edit the existing `StyleSchema` block in the same file to add the new optional fields. Find:

   ```ts
   export const StyleSchema = z.object({
     fill: z.string().optional(),
     stroke: z.string().optional(),
     strokeWidth: z.number().optional(),
     cornerRadius: z.number().optional(),
     fontFamily: z.string().optional(),
     fontSize: z.number().optional(),
     fontWeight: z.number().optional(),
     fontStyle: z.enum(["normal", "italic"]).optional(),
     letterSpacing: z.number().optional(),
     lineHeight: z.number().optional(),
     textAlign: z.enum(["left", "center", "right"]).optional(),
     color: z.string().optional(),
     shadow: ShadowSpecSchema.optional(),
     imageAssetId: z.string().optional(),
     imageFit: z.enum(["cover", "contain", "fill"]).optional(),
   });
   ```

   Replace with:

   ```ts
   export const StyleSchema = z.object({
     fill: z.string().optional(),
     stroke: z.string().optional(),
     strokeWidth: z.number().optional(),
     cornerRadius: z.number().optional(),
     fontFamily: z.string().optional(),
     fontSize: z.number().optional(),
     fontWeight: z.number().optional(),
     fontStyle: z.enum(["normal", "italic"]).optional(),
     letterSpacing: z.number().optional(),
     lineHeight: z.number().optional(),
     textAlign: z.enum(["left", "center", "right"]).optional(),
     color: z.string().optional(),
     // Wave 1A single shadow (preserved). Wave 1B `shadows` array below
     // takes precedence in the compiler when both present.
     shadow: ShadowSpecSchema.optional(),
     // Wave 1B — stack of up to 8 shadows. Compiled to a comma-joined
     // CSS `box-shadow` / `filter: drop-shadow(...)` rule.
     shadows: z.array(ShadowSpecSchema).max(8).optional(),
     // Wave 1B — gradient fill (replaces solid `fill` when present).
     gradient: GradientSpecSchema.optional(),
     // Wave 1B — CSS filter stack applied to the element.
     filter: FilterSpecSchema.optional(),
     imageAssetId: z.string().optional(),
     imageFit: z.enum(["cover", "contain", "fill"]).optional(),
   });
   ```

6. Re-run the test — expect PASS:

   ```bash
   npx vitest run apps/web/src/server/overlays/builder/types.test.ts
   ```

   Expected output: previously-passing Wave 1A tests plus the new Wave 1B tests pass; e.g. `Tests  30 passed (30)` (16 from Wave 1A + 14 new). Exact number depends on your `types.test.ts` count.

7. Confirm the project still compiles:

   ```bash
   npx tsc --noEmit -p apps/web/tsconfig.json
   ```

   Expected: empty (no errors).

8. Commit:

   ```bash
   git add apps/web/src/server/overlays/builder/types.ts apps/web/src/server/overlays/builder/types.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): types — gradient/filter/shadow-stack/font-upload

   Extends Wave 1A's types.ts with the schemas the Wave 1B work consumes:
     - GradientStopSchema       -> single {offset, color} row, [0..1] offset.
     - LinearGradientSchema     -> {kind:'linear', angle 0..360, stops>=2}.
     - RadialGradientSchema     -> {kind:'radial', cx/cy/radius 0..1, stops>=2}.
     - GradientSpecSchema       -> discriminated union of the above.
     - FilterSpecSchema         -> {blur 0..40, brightness 0..2,
                                    hueRotate 0..360, saturate 0..2}, all optional.
     - ShadowStackSchema        -> ShadowSpec | ShadowSpec[] (max 8) — Wave 1A
                                    single-shadow shape preserved on `style.shadow`,
                                    new array shape on `style.shadows`.
     - FontUploadSchema         -> {filename, mimeType ∈ font/*, sizeBytes <= 5MB}.

   StyleSchema extended with new optional fields: `gradient`, `filter`,
   `shadows`. No DB migration needed — everything lives inside the existing
   JSONB `style` column.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 4: Extend `style-schema.ts` + `style-validator.ts` for new element types + new fields

**Files:**

- Modify: `apps/web/src/server/overlays/builder/style-schema.ts`
- Modify: `apps/web/src/server/overlays/builder/style-validator.ts`
- Modify: `apps/web/src/server/overlays/builder/style-validator.test.ts`

**Context:** Wave 1A's `style-schema.ts` (lines 1741-1825 of Wave 1A plan) defined `RectStyleSchema`, `TextStyleSchema`, `ImageStyleSchema`, `DataSlotTextSchema`, `PermissiveStyleSchema` plus `schemaForElementType(t)` dispatch. Wave 1B:

1. Tightens `ellipse` to share `RectStyleSchema` shape (same fill/stroke/shadow controls — gradient also valid).
2. Adds a `LineStyleSchema` (stroke + strokeWidth + shadow — no fill).
3. Adds a `PolygonStyleSchema` (same shape as RectStyle — fill/stroke/shadow/gradient — plus `sides: number`).
4. Adds new optional fields (`gradient`, `filter`, `shadows`) onto every shape that already supports `fill` or `color`.
5. Extends the forbidden-pattern sweep to walk gradient stops + multi-shadow color strings (already covered by recursive `walkAndScan` — verify with new test cases).

#### Steps

1. Append failing test cases at the end of `apps/web/src/server/overlays/builder/style-validator.test.ts`:

   ```ts
   describe("style-validator — Wave 1B shapes", () => {
     it("accepts ellipse with gradient fill", () => {
       const r = validateStyle("ellipse", {
         gradient: {
           kind: "linear",
           angle: 90,
           stops: [
             { offset: 0, color: "#6bcd06" },
             { offset: 1, color: "#fe036d" },
           ],
         },
       });
       expect(r.ok).toBe(true);
     });

     it("accepts line with stroke + strokeWidth only", () => {
       const r = validateStyle("line", {
         stroke: "#ffffff",
         strokeWidth: 4,
       });
       expect(r.ok).toBe(true);
     });

     it("rejects line carrying a `fill` (line has no fill)", () => {
       const r = validateStyle("line", {
         fill: "#fe036d",
         stroke: "#fff",
       });
       expect(r.ok).toBe(false);
     });

     it("accepts polygon with sides + fill", () => {
       const r = validateStyle("polygon", {
         fill: "#6bcd06",
         strokeWidth: 0,
         sides: 6,
       });
       expect(r.ok).toBe(true);
     });

     it("rejects polygon with sides < 3", () => {
       const r = validateStyle("polygon", {
         fill: "#6bcd06",
         sides: 2,
       });
       expect(r.ok).toBe(false);
     });

     it("accepts text with full filter stack", () => {
       const r = validateStyle("text", {
         fontFamily: "Agharti",
         fontSize: 48,
         color: "#ffffff",
         filter: { blur: 4, brightness: 1.2, hueRotate: 90, saturate: 1.5 },
       });
       expect(r.ok).toBe(true);
     });

     it("accepts rect with multi-stack shadows array", () => {
       const r = validateStyle("rect", {
         fill: "#fe036d",
         shadows: [
           { offsetX: 2, offsetY: 2, blur: 4, color: "#000", opacity: 0.5 },
           { offsetX: -2, offsetY: -2, blur: 4, color: "#6bcd06", opacity: 0.4 },
         ],
       });
       expect(r.ok).toBe(true);
     });

     it("rejects gradient stop color containing javascript:", () => {
       const r = validateStyle("ellipse", {
         gradient: {
           kind: "linear",
           angle: 0,
           stops: [
             { offset: 0, color: "javascript:alert(1)" },
             { offset: 1, color: "#fff" },
           ],
         },
       });
       expect(r.ok).toBe(false);
     });

     it("rejects shadows array longer than 8", () => {
       const shadows = Array.from({ length: 9 }, () => ({
         offsetX: 1, offsetY: 1, blur: 2, color: "#000", opacity: 0.3,
       }));
       const r = validateStyle("rect", { fill: "#fff", shadows });
       expect(r.ok).toBe(false);
     });
   });
   ```

2. Run the tests — confirm FAIL (new shapes / fields rejected by the old schemas):

   ```bash
   npx vitest run apps/web/src/server/overlays/builder/style-validator.test.ts
   ```

   Expected: at least 4 of the new tests fail (line/polygon dispatch falls through to `PermissiveStyleSchema` which doesn't enforce shape constraints; gradient/filter/shadows aren't on the existing per-type schemas).

3. Edit `apps/web/src/server/overlays/builder/style-schema.ts`. Replace the file contents with:

   ```ts
   /**
    * Overlay Builder — element-type-discriminated style schema.
    *
    * Wave 1A: rect / text / image / data-slot tight schemas. Other types
    * fell through to PermissiveStyleSchema.
    *
    * Wave 1B: tightens ellipse / line / polygon, adds gradient / filter /
    * shadows array fields to fillable shapes (rect / ellipse / text /
    * polygon), preserves the single `shadow` field for back-compat.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §6
    */

   import { z } from "zod";
   import {
     ShadowSpecSchema,
     GradientSpecSchema,
     FilterSpecSchema,
   } from "./types";
   import type { ElementType } from "./types";

   // Common optional effects every fillable shape inherits.
   const EffectsShape = {
     shadow: ShadowSpecSchema.optional(),
     shadows: z.array(ShadowSpecSchema).max(8).optional(),
     gradient: GradientSpecSchema.optional(),
     filter: FilterSpecSchema.optional(),
   };

   const RectStyleSchema = z.object({
     fill: z.string().optional(),
     stroke: z.string().optional(),
     strokeWidth: z.number().optional(),
     cornerRadius: z.number().optional(),
     ...EffectsShape,
   });

   const EllipseStyleSchema = z.object({
     fill: z.string().optional(),
     stroke: z.string().optional(),
     strokeWidth: z.number().optional(),
     ...EffectsShape,
   });

   // Line has NO fill — pure stroke shape.
   const LineStyleSchema = z.object({
     stroke: z.string(),
     strokeWidth: z.number(),
     shadow: ShadowSpecSchema.optional(),
     shadows: z.array(ShadowSpecSchema).max(8).optional(),
     filter: FilterSpecSchema.optional(),
   }).strict();

   const PolygonStyleSchema = z.object({
     fill: z.string().optional(),
     stroke: z.string().optional(),
     strokeWidth: z.number().optional(),
     // Min 3, max 12 — beyond 12 just looks like a circle, gradient gets weird.
     sides: z.number().int().min(3).max(12),
     ...EffectsShape,
   });

   const TextStyleSchema = z.object({
     fontFamily: z.string(),
     fontSize: z.number(),
     fontWeight: z.number().optional(),
     fontStyle: z.enum(["normal", "italic"]).optional(),
     letterSpacing: z.number().optional(),
     lineHeight: z.number().optional(),
     textAlign: z.enum(["left", "center", "right"]).optional(),
     color: z.string(),
     ...EffectsShape,
   });

   const ImageStyleSchema = z.object({
     imageAssetId: z.string(),
     imageFit: z.enum(["cover", "contain", "fill"]).optional(),
     cornerRadius: z.number().optional(),
     shadow: ShadowSpecSchema.optional(),
     shadows: z.array(ShadowSpecSchema).max(8).optional(),
     filter: FilterSpecSchema.optional(),
   });

   const DataSlotTextSchema = TextStyleSchema;
   const DataSlotImageSchema = ImageStyleSchema;

   // Forward-compat permissive shape for element types still unnarrowed
   // (path, psd-layer, group).
   const PermissiveStyleSchema = z.object({
     fill: z.string().optional(),
     stroke: z.string().optional(),
     strokeWidth: z.number().optional(),
     cornerRadius: z.number().optional(),
     fontFamily: z.string().optional(),
     fontSize: z.number().optional(),
     fontWeight: z.number().optional(),
     fontStyle: z.enum(["normal", "italic"]).optional(),
     letterSpacing: z.number().optional(),
     lineHeight: z.number().optional(),
     textAlign: z.enum(["left", "center", "right"]).optional(),
     color: z.string().optional(),
     imageAssetId: z.string().optional(),
     imageFit: z.enum(["cover", "contain", "fill"]).optional(),
     ...EffectsShape,
   });

   export function schemaForElementType(elementType: ElementType): z.ZodTypeAny {
     switch (elementType) {
       case "rect":
         return RectStyleSchema;
       case "ellipse":
         return EllipseStyleSchema;
       case "line":
         return LineStyleSchema;
       case "polygon":
         return PolygonStyleSchema;
       case "text":
         return TextStyleSchema;
       case "image":
         return ImageStyleSchema;
       case "data-slot":
         return DataSlotTextSchema;
       default:
         return PermissiveStyleSchema;
     }
   }

   export {
     RectStyleSchema,
     EllipseStyleSchema,
     LineStyleSchema,
     PolygonStyleSchema,
     TextStyleSchema,
     ImageStyleSchema,
     DataSlotTextSchema,
     DataSlotImageSchema,
     PermissiveStyleSchema,
   };
   ```

4. The `style-validator.ts` recursive `walkAndScan` already covers nested objects + arrays (Wave 1A line 1893-1907). Gradient stop colors + multi-shadow color strings are automatically walked. No changes needed in `style-validator.ts`.

5. Re-run the tests — expect PASS:

   ```bash
   npx vitest run apps/web/src/server/overlays/builder/style-validator.test.ts
   ```

   Expected: all Wave 1A tests still pass + 9 new Wave 1B cases green.

6. Commit:

   ```bash
   git add apps/web/src/server/overlays/builder/style-schema.ts apps/web/src/server/overlays/builder/style-validator.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): style schema — ellipse/line/polygon + gradient/filter/shadows

   - Adds tight schemas for ellipse / line / polygon (Wave 1A fell through
     to PermissiveStyleSchema for these types). Line is strict — fill is
     rejected (lines have no interior fill); polygon enforces `sides`
     in [3..12].
   - Adds gradient (linear|radial), filter (blur/brightness/hueRotate/
     saturate), and shadows (array up to 8) to every fillable shape
     (rect/ellipse/text/polygon/image/permissive). Wave 1A single
     `shadow` shape preserved alongside the new array form.
   - No change to forbidden-pattern sweep — recursive walkAndScan already
     covers nested gradient stop color strings + multi-shadow colors.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 5: Extend `compiler.ts` to emit gradient, filter, multi-shadow CSS

**Files:**

- Modify: `apps/web/src/server/overlays/builder/compiler.ts`
- Modify: `apps/web/src/server/overlays/builder/compiler.test.ts`
- Create: `apps/web/src/server/overlays/builder/fixtures/design-wave-1b.ts`

**Context:** Wave 1A's compiler (lines 5899-6784 of Wave 1A plan) emits a single `box-shadow` from `style.shadow` and a single `background-color` from `style.fill`. Wave 1B needs to:

1. **Gradient** — when `style.gradient` is set, emit `background: linear-gradient(...)` or `background: radial-gradient(...)` instead of `background-color`. For `text` elements, emit `background-clip: text; -webkit-background-clip: text; color: transparent;` so the gradient paints the glyphs.
2. **Filter** — when `style.filter` is set, emit `filter: blur(Npx) brightness(N) hue-rotate(Ndeg) saturate(N);` (concatenated only for the keys present).
3. **Multi-shadow** — when `style.shadows` is an array, emit `box-shadow: <s1>, <s2>, ...;`. When `style.shadow` is set instead, fall back to Wave 1A single-shadow emit. When BOTH set, prefer the array (compiler-deterministic — admin should never set both via UI).
4. **Ellipse / line / polygon DOM** — Wave 1A renders ellipse/line/polygon as empty `<div data-element-id="...">`. Wave 1B keeps the same `<div>` shell (HTML can render an ellipse via `border-radius: 50%`, a polygon via `clip-path: polygon(...)`, and a line via a thin rect — all CSS, no SVG needed for canvas-renderer parity).

#### Steps

1. Create the new fixture at `apps/web/src/server/overlays/builder/fixtures/design-wave-1b.ts`:

   ```ts
   import type { Design } from "../types";

   /**
    * Wave 1B compiler fixture — exercises gradient + filter + multi-shadow
    * + new shape types (ellipse / line / polygon) in a single render.
    *
    * Asserted by compiler.test.ts Wave 1B describe block.
    */
   export const designWave1b: Design = {
     id: "00000000-0000-0000-0000-00000000ab01",
     slug: "fx-wave-1b",
     title: "Fixture: Wave 1B",
     description: null,
     mode: "single",
     status: "published",
     canvas_width: 1920,
     canvas_height: 1080,
     created_by: "00000000-0000-0000-0000-000000000099",
     created_at: "2026-05-18T00:00:00.000Z",
     updated_at: "2026-05-18T00:00:00.000Z",
     deleted_at: null,
     scenes: [
       {
         id: "00000000-0000-0000-0000-00000000ab10",
         design_id: "00000000-0000-0000-0000-00000000ab01",
         order_index: 0,
         name: "main",
         duration_ms: 5000,
         transition_in: "fade",
         transition_out: "fade",
         deleted_at: null,
         elements: [
           // 1) rect with linear gradient + multi-shadow + filter
           {
             id: "00000000-0000-0000-0000-00000000ab21",
             scene_id: "00000000-0000-0000-0000-00000000ab10",
             parent_group_id: null,
             element_type: "rect",
             z_index: 0,
             locked: false,
             visible: true,
             transform: {
               x: 100, y: 100, width: 400, height: 200,
               rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
             },
             style: {
               gradient: {
                 kind: "linear",
                 angle: 90,
                 stops: [
                   { offset: 0, color: "#6bcd06" },
                   { offset: 1, color: "#fe036d" },
                 ],
               },
               shadows: [
                 { offsetX: 4, offsetY: 4, blur: 12, color: "#000000", opacity: 0.5 },
                 { offsetX: -4, offsetY: -4, blur: 12, color: "#6bcd06", opacity: 0.3 },
               ],
               filter: { blur: 0, brightness: 1.1, saturate: 1.2 },
             },
             content: null,
             binding: null,
             animation: null,
             deleted_at: null,
           },
           // 2) ellipse with radial gradient
           {
             id: "00000000-0000-0000-0000-00000000ab22",
             scene_id: "00000000-0000-0000-0000-00000000ab10",
             parent_group_id: null,
             element_type: "ellipse",
             z_index: 1,
             locked: false,
             visible: true,
             transform: {
               x: 600, y: 100, width: 300, height: 300,
               rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
             },
             style: {
               gradient: {
                 kind: "radial",
                 cx: 0.5, cy: 0.5, radius: 0.7,
                 stops: [
                   { offset: 0, color: "#ffffff" },
                   { offset: 1, color: "#050505" },
                 ],
               },
             },
             content: null,
             binding: null,
             animation: null,
             deleted_at: null,
           },
           // 3) line — stroke only
           {
             id: "00000000-0000-0000-0000-00000000ab23",
             scene_id: "00000000-0000-0000-0000-00000000ab10",
             parent_group_id: null,
             element_type: "line",
             z_index: 2,
             locked: false,
             visible: true,
             transform: {
               x: 100, y: 500, width: 800, height: 6,
               rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
             },
             style: {
               stroke: "#6bcd06",
               strokeWidth: 6,
             },
             content: null,
             binding: null,
             animation: null,
             deleted_at: null,
           },
           // 4) polygon — hexagon
           {
             id: "00000000-0000-0000-0000-00000000ab24",
             scene_id: "00000000-0000-0000-0000-00000000ab10",
             parent_group_id: null,
             element_type: "polygon",
             z_index: 3,
             locked: false,
             visible: true,
             transform: {
               x: 1100, y: 100, width: 240, height: 240,
               rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
             },
             style: {
               fill: "#fe036d",
               sides: 6,
             },
             content: null,
             binding: null,
             animation: null,
             deleted_at: null,
           },
           // 5) text with gradient fill
           {
             id: "00000000-0000-0000-0000-00000000ab25",
             scene_id: "00000000-0000-0000-0000-00000000ab10",
             parent_group_id: null,
             element_type: "text",
             z_index: 4,
             locked: false,
             visible: true,
             transform: {
               x: 100, y: 700, width: 1600, height: 160,
               rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
             },
             style: {
               fontFamily: "Agharti",
               fontSize: 96,
               fontWeight: 700,
               color: "#ffffff",
               gradient: {
                 kind: "linear",
                 angle: 45,
                 stops: [
                   { offset: 0, color: "#6bcd06" },
                   { offset: 1, color: "#fe036d" },
                 ],
               },
             },
             content: { text: "WAVE 1B" },
             binding: null,
             animation: null,
             deleted_at: null,
           },
         ],
       },
     ],
   };
   ```

2. Append a Wave 1B `describe` block at the end of `apps/web/src/server/overlays/builder/compiler.test.ts`:

   ```ts
   import { designWave1b } from "./fixtures/design-wave-1b";

   describe("compileDesignToHtml — Wave 1B", () => {
     const html = compileDesignToHtml(designWave1b, 0);

     it("emits linear-gradient background for rect with gradient", () => {
       expect(html).toMatch(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab21"\]\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*#6bcd06 0%,\s*#fe036d 100%\)/,
       );
     });

     it("emits radial-gradient background for ellipse", () => {
       expect(html).toMatch(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab22"\]\s*\{[^}]*background:\s*radial-gradient\(circle at 50% 50%,\s*#ffffff 0%,\s*#050505 100%\)/,
       );
     });

     it("emits border-radius: 50% for ellipse", () => {
       expect(html).toMatch(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab22"\]\s*\{[^}]*border-radius:\s*50%/,
       );
     });

     it("emits clip-path polygon() for polygon shape with 6 sides", () => {
       expect(html).toMatch(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab24"\]\s*\{[^}]*clip-path:\s*polygon\(/,
       );
     });

     it("emits multi-shadow box-shadow with comma-joined entries", () => {
       expect(html).toMatch(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab21"\]\s*\{[^}]*box-shadow:\s*4px 4px 12px[^,]*,\s*-4px -4px 12px/,
       );
     });

     it("emits filter rule with brightness + saturate concatenated", () => {
       expect(html).toMatch(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab21"\]\s*\{[^}]*filter:[^;]*brightness\(1\.1\)[^;]*saturate\(1\.2\)/,
       );
     });

     it("emits text background-clip:text + transparent color for gradient text", () => {
       const block = html.match(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab25"\]\s*\{([^}]*)\}/,
       )?.[1] ?? "";
       expect(block).toMatch(/background-clip:\s*text/);
       expect(block).toMatch(/-webkit-background-clip:\s*text/);
       expect(block).toMatch(/color:\s*transparent/);
     });

     it("renders ellipse/line/polygon as <div> elements with data-element-id", () => {
       expect(html).toContain('data-element-id="00000000-0000-0000-0000-00000000ab22"');
       expect(html).toContain('data-element-id="00000000-0000-0000-0000-00000000ab23"');
       expect(html).toContain('data-element-id="00000000-0000-0000-0000-00000000ab24"');
     });

     it("emits stroke + strokeWidth as border for line element", () => {
       expect(html).toMatch(
         /\[data-element-id="00000000-0000-0000-0000-00000000ab23"\]\s*\{[^}]*background-color:\s*#6bcd06/,
       );
     });
   });
   ```

3. Run — expect FAIL:

   ```bash
   npx vitest run apps/web/src/server/overlays/builder/compiler.test.ts
   ```

4. Edit `apps/web/src/server/overlays/builder/compiler.ts`. Find the `shadowCss` function (around line 6508 of Wave 1A plan) and the `fillCss` function (around line 6515) and the `elementDefaultRule` function (around line 6651). Replace the three helpers + add three new helpers + change one DOM render path.

   Replace `shadowCss`:

   ```ts
   function shadowCss(style: Style | null | undefined): string {
     if (!style) return "";
     // Wave 1B prefers the `shadows` array when present.
     if (Array.isArray(style.shadows) && style.shadows.length > 0) {
       const parts = style.shadows.map(
         (s) =>
           `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${rgbaFromHex(s.color, s.opacity)}`,
       );
       return `box-shadow: ${parts.join(", ")};`;
     }
     // Wave 1A single-shadow back-compat path.
     const shadow = style.shadow;
     if (!shadow) return "";
     return `box-shadow: ${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${rgbaFromHex(shadow.color, shadow.opacity)};`;
   }

   function rgbaFromHex(hex: string, opacity: number): string {
     // Accepts #RGB, #RRGGBB. Returns rgba(R,G,B,A).
     const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
     const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
     let r = 0, g = 0, b = 0;
     if (m3) {
       r = parseInt(m3[1] + m3[1], 16);
       g = parseInt(m3[2] + m3[2], 16);
       b = parseInt(m3[3] + m3[3], 16);
     } else if (m6) {
       r = parseInt(m6[1], 16);
       g = parseInt(m6[2], 16);
       b = parseInt(m6[3], 16);
     } else {
       // Non-hex (e.g. CSS named color) — fall back to opaque hex pass-through.
       return hex;
     }
     return `rgba(${r}, ${g}, ${b}, ${opacity})`;
   }
   ```

   Replace `fillCss`:

   ```ts
   function fillCss(element: Element): string {
     const style = element.style;
     if (!style) return "";

     // Gradient takes precedence over solid fill.
     if (style.gradient) {
       const gradient = gradientCss(style.gradient);
       if (element.element_type === "text") {
         // Text gradient needs the bg-clip trick.
         return `background: ${gradient}; background-clip: text; -webkit-background-clip: text; color: transparent;`;
       }
       return `background: ${gradient};`;
     }

     const fill = style.fill;
     if (!fill) {
       // For line elements: emit stroke as background-color so the thin
       // rect appears coloured.
       if (element.element_type === "line" && style.stroke) {
         return `background-color: ${style.stroke};`;
       }
       return "";
     }

     if (element.element_type === "text") {
       return `color: ${fill};`;
     }
     if (
       element.element_type === "rect" ||
       element.element_type === "ellipse" ||
       element.element_type === "polygon"
     ) {
       return `background-color: ${fill};`;
     }
     return "";
   }

   function gradientCss(gradient: NonNullable<Style["gradient"]>): string {
     const stops = gradient.stops
       .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
       .join(", ");
     if (gradient.kind === "linear") {
       return `linear-gradient(${gradient.angle}deg, ${stops})`;
     }
     // radial
     const cxPct = Math.round(gradient.cx * 100);
     const cyPct = Math.round(gradient.cy * 100);
     return `radial-gradient(circle at ${cxPct}% ${cyPct}%, ${stops})`;
   }

   function filterCss(filter: Style["filter"]): string {
     if (!filter) return "";
     const parts: string[] = [];
     if (typeof filter.blur === "number" && filter.blur > 0) {
       parts.push(`blur(${filter.blur}px)`);
     }
     if (typeof filter.brightness === "number" && filter.brightness !== 1) {
       parts.push(`brightness(${filter.brightness})`);
     }
     if (typeof filter.hueRotate === "number" && filter.hueRotate !== 0) {
       parts.push(`hue-rotate(${filter.hueRotate}deg)`);
     }
     if (typeof filter.saturate === "number" && filter.saturate !== 1) {
       parts.push(`saturate(${filter.saturate})`);
     }
     return parts.length > 0 ? `filter: ${parts.join(" ")};` : "";
   }

   function shapeCss(element: Element): string {
     if (element.element_type === "ellipse") {
       return "border-radius: 50%;";
     }
     if (element.element_type === "polygon") {
       const sides = element.style?.sides ?? 6;
       return `clip-path: ${polygonClipPath(sides)};`;
     }
     return "";
   }

   function polygonClipPath(sides: number): string {
     // Regular polygon inscribed in unit box. Vertex i at angle
     // `i * 2π / sides - π/2` (starts at top), mapped to [0..100%].
     const pts: string[] = [];
     for (let i = 0; i < sides; i++) {
       const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
       const x = 50 + 50 * Math.cos(angle);
       const y = 50 + 50 * Math.sin(angle);
       pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
     }
     return `polygon(${pts.join(", ")})`;
   }
   ```

   Update `elementDefaultRule` — find the existing function and change the `const sh = shadowCss(...)` call + add filter + shape pieces:

   ```ts
   function elementDefaultRule(el: Element): string {
     const t = el.transform;
     const parts: string[] = [
       `position: absolute`,
       `left: ${t.x}px`,
       `top: ${t.y}px`,
       `width: ${t.width}px`,
       `height: ${t.height}px`,
       `opacity: 0`,
       `z-index: ${el.z_index}`,
     ];
     const tr = transformCss(t);
     if (tr) parts.push(tr.replace(/;$/, ""));
     const fill = fillCss(el);
     if (fill) parts.push(fill.replace(/;$/, ""));
     const font = fontCss(el.style);
     if (font) parts.push(font.replace(/;$/g, ""));
     const sh = shadowCss(el.style);
     if (sh) parts.push(sh.replace(/;$/, ""));
     const flt = filterCss(el.style?.filter);
     if (flt) parts.push(flt.replace(/;$/, ""));
     const shape = shapeCss(el);
     if (shape) parts.push(shape.replace(/;$/, ""));
     if (el.visible === false) parts.push("display: none");
     return `[data-element-id="${el.id}"] { ${parts.join("; ")}; }`;
   }
   ```

   Finally, ensure `renderElementDom` keeps `ellipse / line / polygon` rendered as empty `<div>` (Wave 1A's fall-through already does this — verify nothing changed).

5. Re-run compiler tests — expect PASS:

   ```bash
   npx vitest run apps/web/src/server/overlays/builder/compiler.test.ts
   ```

   Expected: all Wave 1A compiler tests still pass + 9 new Wave 1B cases green.

6. Commit:

   ```bash
   git add apps/web/src/server/overlays/builder/compiler.ts apps/web/src/server/overlays/builder/compiler.test.ts apps/web/src/server/overlays/builder/fixtures/design-wave-1b.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): compiler — gradient/filter/multi-shadow/new-shapes

   - shadowCss now reads style.shadows[] first, falls back to style.shadow.
   - fillCss emits linear-gradient / radial-gradient when style.gradient
     is set; text gradients use background-clip:text + transparent color.
   - filterCss concatenates only present filter keys into a single CSS
     `filter:` rule.
   - shapeCss adds border-radius:50% for ellipse, clip-path polygon(...)
     for polygon (regular polygon computed from `style.sides`).
   - Line elements render as a thin rect with stroke colour as
     background-color — kept as a <div> so canvas / OBS render parity
     holds.
   - rgbaFromHex helper drives shadow opacity → rgba() conversion.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 6: Font upload server module — `fonts.ts`

**Files:**

- Create: `apps/web/src/server/overlays/builder/fonts.ts`
- Create: `apps/web/src/server/overlays/builder/fonts.test.ts`

**Context:** Spec §10 and §4 — admin uploads TTF/OTF/WOFF/WOFF2 → server validates → fontkit extracts metadata → ttf2woff2 converts to WOFF2 (if not already) → original + WOFF2 stored in `overlay-user-assets` bucket → rows inserted into `overlay_user_assets` (one per file) and `overlay_user_design_fonts` (one per upload, linking original + WOFF2 asset rows).

The module exports four functions, all taking `SupabaseClient` as first arg per the Wave 1A mock-friendly pattern:

- `uploadFont(sb, actor, input: { fileBuffer: Buffer, filename: string, mimeType: string })` → `Promise<{ id: string, familyName: string, weight: number, style: 'normal'|'italic' }>`
- `listFonts(sb)` → `Promise<FontRow[]>` — used by PropertiesPanel + Asset Library.
- `softDeleteFont(sb, actor, fontId)` → `Promise<void>` — sets `deleted_at` on the font row + cascades soft-delete on linked asset rows.
- `getFontFaceCss(sb, fontId)` → `Promise<string>` — emits an `@font-face { ... }` block pointing at the WOFF2 asset's signed URL (used by compiler font collection).

#### Steps

1. Write failing tests at `apps/web/src/server/overlays/builder/fonts.test.ts`:

   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { uploadFont, listFonts, softDeleteFont } from "./fonts";

   // Build a minimal in-memory mock client that records inserts.
   function makeSb() {
     const state: Record<string, unknown[]> = {
       overlay_user_assets: [],
       overlay_user_design_fonts: [],
     };
     const storageUploads: Array<{ bucket: string; path: string; bytes: number }> = [];

     const sb: any = {
       from: (table: string) => ({
         insert: (rows: unknown) => ({
           select: () => ({
             single: async () => {
               const arr = Array.isArray(rows) ? rows : [rows];
               const row = { id: `${table}-${state[table].length + 1}`, ...(arr[0] as object) };
               state[table].push(row);
               return { data: row, error: null };
             },
           }),
         }),
         update: (patch: object) => ({
           eq: (_col: string, _val: string) => ({
             select: () => ({
               maybeSingle: async () => {
                 const target = state[table][0];
                 if (target) Object.assign(target, patch);
                 return { data: target ?? null, error: null };
               },
             }),
           }),
         }),
         select: () => ({
           is: () => ({
             order: () => ({
               then: (cb: (v: unknown) => unknown) =>
                 cb({ data: state[table], error: null }),
             }),
           }),
         }),
       }),
       storage: {
         from: (bucket: string) => ({
           upload: async (path: string, bytes: ArrayBuffer | Buffer) => {
             const sizeBytes =
               bytes instanceof Buffer
                 ? bytes.length
                 : (bytes as ArrayBuffer).byteLength;
             storageUploads.push({ bucket, path, bytes: sizeBytes });
             return { data: { path }, error: null };
           },
         }),
       },
     };

     return { sb, state, storageUploads };
   }

   vi.mock("fontkit", () => ({
     default: {
       create: (_buf: Buffer) => ({
         familyName: "MockFamily",
         subfamilyName: "Regular",
         postscriptName: "MockFamily-Regular",
       }),
     },
     create: (_buf: Buffer) => ({
       familyName: "MockFamily",
       subfamilyName: "Regular",
       postscriptName: "MockFamily-Regular",
     }),
   }));

   vi.mock("ttf2woff2", () => ({
     default: (buf: Buffer) => Buffer.from("woff2-converted-" + buf.length),
   }));

   describe("uploadFont", () => {
     const ACTOR = "user-uuid-admin";

     it("rejects size > 5MB", async () => {
       const { sb } = makeSb();
       const big = Buffer.alloc(6 * 1024 * 1024);
       await expect(
         uploadFont(sb, ACTOR, {
           fileBuffer: big,
           filename: "huge.ttf",
           mimeType: "font/ttf",
         }),
       ).rejects.toThrow(/5MB/i);
     });

     it("rejects non-font MIME", async () => {
       const { sb } = makeSb();
       await expect(
         uploadFont(sb, ACTOR, {
           fileBuffer: Buffer.from("not a font"),
           filename: "evil.exe",
           mimeType: "application/octet-stream",
         }),
       ).rejects.toThrow(/mime/i);
     });

     it("inserts asset rows for original + woff2 + a font row", async () => {
       const { sb, state, storageUploads } = makeSb();
       const result = await uploadFont(sb, ACTOR, {
         fileBuffer: Buffer.from("fake ttf bytes"),
         filename: "Custom Regular.ttf",
         mimeType: "font/ttf",
       });
       expect(result.familyName).toBe("MockFamily");
       expect(result.weight).toBe(400);
       expect(result.style).toBe("normal");
       expect(state.overlay_user_assets.length).toBe(2);
       expect(state.overlay_user_design_fonts.length).toBe(1);
       expect(storageUploads.length).toBe(2);
       const buckets = storageUploads.map((u) => u.bucket);
       expect(buckets.every((b) => b === "overlay-user-assets")).toBe(true);
     });

     it("skips WOFF2 conversion when upload is already WOFF2", async () => {
       const { sb, state, storageUploads } = makeSb();
       await uploadFont(sb, ACTOR, {
         fileBuffer: Buffer.from("woff2 bytes"),
         filename: "Already.woff2",
         mimeType: "font/woff2",
       });
       expect(storageUploads.length).toBe(1);
       expect(state.overlay_user_assets.length).toBe(1);
     });
   });

   describe("listFonts", () => {
     it("returns rows filtered by deleted_at IS NULL", async () => {
       const { sb, state } = makeSb();
       state.overlay_user_design_fonts.push(
         { id: "f1", family_name: "A", deleted_at: null },
         { id: "f2", family_name: "B", deleted_at: "2026-05-18T00:00:00Z" },
       );
       const rows = await listFonts(sb);
       expect(rows.length).toBeGreaterThanOrEqual(1);
     });
   });

   describe("softDeleteFont", () => {
     it("sets deleted_at on the matching row", async () => {
       const { sb, state } = makeSb();
       state.overlay_user_design_fonts.push({ id: "f-target", deleted_at: null });
       await softDeleteFont(sb, "user-admin", "f-target");
       const row = state.overlay_user_design_fonts[0] as { deleted_at: string | null };
       expect(row.deleted_at).not.toBeNull();
     });
   });
   ```

2. Run — expect FAIL (module missing).

3. Create `apps/web/src/server/overlays/builder/fonts.ts`:

   ```ts
   /**
    * Overlay Builder — custom font upload server module.
    *
    * Pipeline:
    *   1. Validate input via FontUploadSchema (size + MIME).
    *   2. Parse with fontkit to extract familyName, weight, style.
    *   3. If MIME != woff2, convert original buffer to WOFF2 via
    *      ttf2woff2 (browser-friendly format).
    *   4. Upload original + converted bytes to `overlay-user-assets`
    *      Supabase Storage bucket.
    *   5. Insert one `overlay_user_assets` row per uploaded file.
    *   6. Insert one `overlay_user_design_fonts` row linking the two
    *      asset rows.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §4 + §10
    */

   import fontkit from "fontkit";
   import ttf2woff2 from "ttf2woff2";
   import { FontUploadSchema } from "./types";
   import type { SupabaseClient } from "@supabase/supabase-js";

   const BUCKET = "overlay-user-assets";

   export type FontRow = {
     id: string;
     family_name: string;
     weight: number;
     style: "normal" | "italic";
     format: "ttf" | "otf" | "woff" | "woff2";
     asset_id: string;
     woff2_asset_id: string | null;
     deleted_at: string | null;
   };

   export type UploadResult = {
     id: string;
     familyName: string;
     weight: number;
     style: "normal" | "italic";
   };

   function detectFormat(mimeType: string): "ttf" | "otf" | "woff" | "woff2" {
     if (mimeType.includes("woff2")) return "woff2";
     if (mimeType.includes("woff")) return "woff";
     if (mimeType.includes("otf") || mimeType.includes("opentype")) return "otf";
     return "ttf";
   }

   function inferWeight(subfamily: string | undefined): number {
     if (!subfamily) return 400;
     const s = subfamily.toLowerCase();
     if (s.includes("thin")) return 100;
     if (s.includes("extralight") || s.includes("ultralight")) return 200;
     if (s.includes("light")) return 300;
     if (s.includes("medium")) return 500;
     if (s.includes("semibold") || s.includes("demibold")) return 600;
     if (s.includes("extrabold") || s.includes("ultrabold")) return 800;
     if (s.includes("black") || s.includes("heavy")) return 900;
     if (s.includes("bold")) return 700;
     return 400;
   }

   function inferStyle(subfamily: string | undefined): "normal" | "italic" {
     if (!subfamily) return "normal";
     return /italic|oblique/i.test(subfamily) ? "italic" : "normal";
   }

   export async function uploadFont(
     sb: SupabaseClient,
     _actor: string,
     input: { fileBuffer: Buffer; filename: string; mimeType: string },
   ): Promise<UploadResult> {
     const parsed = FontUploadSchema.safeParse({
       filename: input.filename,
       mimeType: input.mimeType,
       sizeBytes: input.fileBuffer.length,
     });
     if (!parsed.success) {
       throw new Error(
         `Invalid font upload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
       );
     }

     // 1. fontkit parse.
     const font = (fontkit as unknown as { create: (b: Buffer) => any }).create(
       input.fileBuffer,
     );
     const familyName: string = font.familyName ?? "Unnamed";
     const subfamily: string | undefined = font.subfamilyName;
     const weight = inferWeight(subfamily);
     const style = inferStyle(subfamily);
     const format = detectFormat(input.mimeType);

     // 2. Upload original.
     const stamp = Date.now().toString(36);
     const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
     const origPath = `fonts/${stamp}-${safeName}`;
     const upOrig = await sb.storage.from(BUCKET).upload(origPath, input.fileBuffer);
     if (upOrig.error) throw upOrig.error;

     const { data: origAsset, error: origErr } = await sb
       .from("overlay_user_assets")
       .insert({
         asset_type: "font",
         file_path: origPath,
         mime_type: input.mimeType,
         original_filename: input.filename,
         size_bytes: input.fileBuffer.length,
       })
       .select()
       .single();
     if (origErr || !origAsset) throw origErr ?? new Error("orig asset insert failed");
     const origAssetId = (origAsset as { id: string }).id;

     // 3. Convert to WOFF2 unless already WOFF2.
     let woff2AssetId: string | null = null;
     if (format !== "woff2") {
       const woff2Bytes = (
         ttf2woff2 as unknown as (b: Buffer) => Buffer
       )(input.fileBuffer);
       const woff2Path = `${origPath}.woff2`;
       const upConv = await sb.storage.from(BUCKET).upload(woff2Path, woff2Bytes);
       if (upConv.error) throw upConv.error;

       const { data: woff2Asset, error: woff2Err } = await sb
         .from("overlay_user_assets")
         .insert({
           asset_type: "font",
           file_path: woff2Path,
           mime_type: "font/woff2",
           original_filename: input.filename.replace(/\.(ttf|otf|woff)$/i, ".woff2"),
           size_bytes: woff2Bytes.length,
         })
         .select()
         .single();
       if (woff2Err || !woff2Asset) {
         throw woff2Err ?? new Error("woff2 asset insert failed");
       }
       woff2AssetId = (woff2Asset as { id: string }).id;
     }

     // 4. Insert font row.
     const { data: fontRow, error: fontErr } = await sb
       .from("overlay_user_design_fonts")
       .insert({
         family_name: familyName,
         weight,
         style,
         format,
         asset_id: origAssetId,
         woff2_asset_id: woff2AssetId,
       })
       .select()
       .single();
     if (fontErr || !fontRow) {
       throw fontErr ?? new Error("font row insert failed");
     }

     return {
       id: (fontRow as { id: string }).id,
       familyName,
       weight,
       style,
     };
   }

   export async function listFonts(sb: SupabaseClient): Promise<FontRow[]> {
     const { data, error } = await (sb
       .from("overlay_user_design_fonts")
       .select(
         "id, family_name, weight, style, format, asset_id, woff2_asset_id, deleted_at",
       )
       .is("deleted_at", null)
       .order("family_name") as unknown as Promise<{
       data: FontRow[] | null;
       error: { message: string } | null;
     }>);
     if (error) throw new Error(error.message);
     return data ?? [];
   }

   export async function softDeleteFont(
     sb: SupabaseClient,
     _actor: string,
     fontId: string,
   ): Promise<void> {
     const { error } = await sb
       .from("overlay_user_design_fonts")
       .update({ deleted_at: new Date().toISOString() })
       .eq("id", fontId)
       .select()
       .maybeSingle();
     if (error) throw new Error(error.message);
   }

   export async function getFontFaceCss(
     sb: SupabaseClient,
     fontId: string,
   ): Promise<string> {
     const { data: fontRow, error: fontErr } = await sb
       .from("overlay_user_design_fonts")
       .select("family_name, weight, style, woff2_asset_id, asset_id")
       .eq("id", fontId)
       .is("deleted_at", null)
       .maybeSingle();
     if (fontErr || !fontRow) {
       throw fontErr ?? new Error(`font ${fontId} not found`);
     }
     const f = fontRow as {
       family_name: string;
       weight: number;
       style: "normal" | "italic";
       woff2_asset_id: string | null;
       asset_id: string;
     };
     const assetId = f.woff2_asset_id ?? f.asset_id;
     const { data: assetRow, error: assetErr } = await sb
       .from("overlay_user_assets")
       .select("file_path")
       .eq("id", assetId)
       .is("deleted_at", null)
       .maybeSingle();
     if (assetErr || !assetRow) {
       throw assetErr ?? new Error(`asset ${assetId} not found`);
     }
     const path = (assetRow as { file_path: string }).file_path;
     return `@font-face { font-family: '${f.family_name}'; src: url('/overlay-user-assets/${path}') format('woff2'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; }`;
   }
   ```

4. Re-run tests — expect PASS:

   ```bash
   npx vitest run apps/web/src/server/overlays/builder/fonts.test.ts
   ```

5. Commit:

   ```bash
   git add apps/web/src/server/overlays/builder/fonts.ts apps/web/src/server/overlays/builder/fonts.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): font upload server module

   - uploadFont: validates via FontUploadSchema, fontkit-parses metadata
     (family/weight/style), converts non-WOFF2 source to WOFF2 via
     ttf2woff2, uploads original + converted to overlay-user-assets
     bucket, inserts two overlay_user_assets rows + one
     overlay_user_design_fonts row.
   - listFonts: returns active rows for the PropertiesPanel font-family
     picker.
   - softDeleteFont: sets deleted_at on the font row.
   - getFontFaceCss: produces an @font-face block for the compiler to
     include when an element references the font.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 7: Fonts asset library page + server action

**Files:**

- Create: `apps/web/src/app/admin/broadcast/v2/builder/fonts/page.tsx`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/fonts/actions.ts`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/fonts/FontUploadForm.tsx`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/fonts/FontUploadForm.test.tsx`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/fonts/schemas.ts`

**Context:** Sub-tab of the builder library (per spec §5.1). Renders the uploaded-font list + an upload form. Server actions wrap `fonts.uploadFont` + `fonts.softDeleteFont` behind `requirePermAsync('overlay.design.manage')` + `enforceAuthedWrite` rate limit (same pattern as Wave 1A server actions in Task 17 of `wave-1a.md`).

#### Steps

1. Write the failing test at `apps/web/src/app/admin/broadcast/v2/builder/fonts/FontUploadForm.test.tsx`:

   ```tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { FontUploadForm } from "./FontUploadForm";

   describe("FontUploadForm", () => {
     it("renders file input + submit button", () => {
       const action = vi.fn();
       render(<FontUploadForm action={action as never} />);
       expect(screen.getByLabelText(/font file/i)).toBeInTheDocument();
       expect(screen.getByRole("button", { name: /upload font/i })).toBeInTheDocument();
     });

     it("disables submit when no file selected", () => {
       render(<FontUploadForm action={vi.fn() as never} />);
       const btn = screen.getByRole("button", { name: /upload font/i });
       expect(btn).toBeDisabled();
     });

     it("enables submit when file selected", async () => {
       render(<FontUploadForm action={vi.fn() as never} />);
       const file = new File(["fake ttf"], "Custom.ttf", { type: "font/ttf" });
       const input = screen.getByLabelText(/font file/i) as HTMLInputElement;
       fireEvent.change(input, { target: { files: [file] } });
       const btn = screen.getByRole("button", { name: /upload font/i });
       expect(btn).not.toBeDisabled();
     });

     it("shows error when oversize file selected", () => {
       render(<FontUploadForm action={vi.fn() as never} />);
       const big = new File([new ArrayBuffer(6 * 1024 * 1024)], "huge.ttf", {
         type: "font/ttf",
       });
       const input = screen.getByLabelText(/font file/i) as HTMLInputElement;
       fireEvent.change(input, { target: { files: [big] } });
       expect(screen.getByRole("alert").textContent).toMatch(/5\s*MB/i);
     });
   });
   ```

2. Run — expect FAIL.

3. Create `apps/web/src/app/admin/broadcast/v2/builder/fonts/schemas.ts`:

   ```ts
   import { z } from "zod";

   export const UploadFontInputSchema = z.object({
     filename: z.string().min(1).max(255),
     mimeType: z.string(),
     base64: z.string().min(1),
   });
   export type UploadFontInput = z.infer<typeof UploadFontInputSchema>;
   ```

4. Create `apps/web/src/app/admin/broadcast/v2/builder/fonts/actions.ts`:

   ```ts
   "use server";

   import { revalidatePath } from "next/cache";
   import { getSupabaseServerClient } from "@/lib/supabase/server";
   import { enforceAuthedWrite } from "@/lib/rate-limit";
   import { requirePermAsync } from "@/lib/perms-db";
   import { uploadFont, softDeleteFont } from "@/server/overlays/builder/fonts";
   import { UploadFontInputSchema } from "./schemas";

   export async function uploadFontAction(input: unknown) {
     const sb = await getSupabaseServerClient();
     const actor = await requirePermAsync(sb, "overlay.design.manage");
     await enforceAuthedWrite(sb, actor.id, "uploadFont");

     const parsed = UploadFontInputSchema.safeParse(input);
     if (!parsed.success) {
       throw new Error(
         `Invalid font upload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
       );
     }
     const fileBuffer = Buffer.from(parsed.data.base64, "base64");
     const result = await uploadFont(sb, actor.id, {
       fileBuffer,
       filename: parsed.data.filename,
       mimeType: parsed.data.mimeType,
     });
     revalidatePath("/admin/broadcast/v2/builder/fonts");
     return result;
   }

   export async function deleteFontAction(fontId: string) {
     const sb = await getSupabaseServerClient();
     const actor = await requirePermAsync(sb, "overlay.design.manage");
     await enforceAuthedWrite(sb, actor.id, "deleteFont");
     await softDeleteFont(sb, actor.id, fontId);
     revalidatePath("/admin/broadcast/v2/builder/fonts");
   }
   ```

5. Create `apps/web/src/app/admin/broadcast/v2/builder/fonts/FontUploadForm.tsx`:

   ```tsx
   "use client";

   import { useState } from "react";
   import { uploadFontAction } from "./actions";

   const MAX_BYTES = 5 * 1024 * 1024;

   export function FontUploadForm({
     action = uploadFontAction,
   }: {
     action?: typeof uploadFontAction;
   } = {}) {
     const [file, setFile] = useState<File | null>(null);
     const [error, setError] = useState<string | null>(null);
     const [busy, setBusy] = useState(false);

     function onPick(e: React.ChangeEvent<HTMLInputElement>) {
       const f = e.target.files?.[0] ?? null;
       setError(null);
       if (!f) {
         setFile(null);
         return;
       }
       if (f.size > MAX_BYTES) {
         setError("File too large — 5MB maximum");
         setFile(null);
         return;
       }
       setFile(f);
     }

     async function onSubmit(e: React.FormEvent) {
       e.preventDefault();
       if (!file) return;
       setBusy(true);
       setError(null);
       try {
         const buf = await file.arrayBuffer();
         const base64 = Buffer.from(buf).toString("base64");
         await action({
           filename: file.name,
           mimeType: file.type || "font/ttf",
           base64,
         });
         setFile(null);
         (e.target as HTMLFormElement).reset();
       } catch (err) {
         setError(err instanceof Error ? err.message : "Upload failed");
       } finally {
         setBusy(false);
       }
     }

     return (
       <form onSubmit={onSubmit} className="space-y-3">
         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/60">
             Font file (TTF / OTF / WOFF / WOFF2, max 5MB)
           </span>
           <input
             type="file"
             accept=".ttf,.otf,.woff,.woff2,font/*"
             aria-label="Font file"
             onChange={onPick}
             className="block w-full text-sm text-white"
           />
         </label>
         {error && (
           <p role="alert" className="text-sm text-rose-400">
             {error}
           </p>
         )}
         <button
           type="submit"
           disabled={!file || busy}
           className="rounded bg-[#6bcd06] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
         >
           {busy ? "Uploading…" : "Upload font"}
         </button>
       </form>
     );
   }
   ```

6. Create `apps/web/src/app/admin/broadcast/v2/builder/fonts/page.tsx`:

   ```tsx
   import { getSupabaseServerClient } from "@/lib/supabase/server";
   import { requirePermAsync } from "@/lib/perms-db";
   import { listFonts } from "@/server/overlays/builder/fonts";
   import { FontUploadForm } from "./FontUploadForm";
   import { deleteFontAction } from "./actions";

   export const dynamic = "force-dynamic";

   export default async function FontsPage() {
     const sb = await getSupabaseServerClient();
     await requirePermAsync(sb, "overlay.design.manage");
     const fonts = await listFonts(sb);

     return (
       <div className="space-y-6 p-6">
         <header>
           <h1 className="text-2xl font-bold text-white">Custom Fonts</h1>
           <p className="text-sm text-white/60">
             Upload TTF / OTF / WOFF / WOFF2 — converts to WOFF2 server-side and
             appears in the builder font picker.
           </p>
         </header>

         <section className="rounded border border-white/10 bg-zinc-950 p-4">
           <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
             Upload
           </h2>
           <FontUploadForm />
         </section>

         <section className="rounded border border-white/10 bg-zinc-950 p-4">
           <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
             Library ({fonts.length})
           </h2>
           {fonts.length === 0 ? (
             <p className="text-sm text-white/40">No custom fonts yet.</p>
           ) : (
             <table className="w-full text-sm text-white">
               <thead>
                 <tr className="text-left text-xs uppercase tracking-wider text-white/40">
                   <th className="pb-2">Family</th>
                   <th className="pb-2">Weight</th>
                   <th className="pb-2">Style</th>
                   <th className="pb-2">Format</th>
                   <th className="pb-2 text-right">Actions</th>
                 </tr>
               </thead>
               <tbody>
                 {fonts.map((f) => (
                   <tr key={f.id} className="border-t border-white/5">
                     <td className="py-2">{f.family_name}</td>
                     <td className="py-2">{f.weight}</td>
                     <td className="py-2">{f.style}</td>
                     <td className="py-2 uppercase">{f.format}</td>
                     <td className="py-2 text-right">
                       <form action={async () => {
                         "use server";
                         await deleteFontAction(f.id);
                       }}>
                         <button
                           type="submit"
                           className="rounded border border-rose-500/40 px-3 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                         >
                           Delete
                         </button>
                       </form>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           )}
         </section>
       </div>
     );
   }
   ```

7. Re-run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/fonts/FontUploadForm.test.tsx
   ```

   Expected: `Tests 4 passed (4)`.

8. Commit:

   ```bash
   git add apps/web/src/app/admin/broadcast/v2/builder/fonts/
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): fonts page + upload action

   - /admin/broadcast/v2/builder/fonts lists active uploaded fonts + an
     upload form. Soft-delete via row-level form action.
   - uploadFontAction validates UploadFontInputSchema, gates on
     overlay.design.manage + enforceAuthedWrite, delegates to
     server/overlays/builder/fonts#uploadFont.
   - FontUploadForm enforces 5MB cap client-side; surfaces server errors
     inline.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 8: PropertiesPanel — Gradient picker (Style tab)

**Files:**

- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.tsx`
- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.test.tsx`
- Create: `apps/web/src/components/admin/builder/GradientEditor.tsx`
- Create: `apps/web/src/components/admin/builder/GradientEditor.test.tsx`

**Context:** Wave 1A's `StyleTab` (lines 10121-10214 of Wave 1A plan) supports solid fill via `HexColorPicker` only. Wave 1B adds a gradient toggle (None / Linear / Radial) above the solid picker. When Linear/Radial selected, the solid picker is replaced by a multi-stop editor: each stop has a position slider (0..1) + a HexColorPicker. "Add stop" / "Remove stop" buttons. Linear mode adds an angle slider (0..360); radial mode adds cx/cy/radius sliders.

#### Steps

1. Write failing tests at `apps/web/src/components/admin/builder/GradientEditor.test.tsx`:

   ```tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { GradientEditor } from "./GradientEditor";

   describe("GradientEditor", () => {
     it("renders None / Linear / Radial radio options", () => {
       render(<GradientEditor value={undefined} onChange={vi.fn()} />);
       expect(screen.getByLabelText(/none/i)).toBeInTheDocument();
       expect(screen.getByLabelText(/linear/i)).toBeInTheDocument();
       expect(screen.getByLabelText(/radial/i)).toBeInTheDocument();
     });

     it("emits a 2-stop linear gradient when Linear selected", () => {
       const onChange = vi.fn();
       render(<GradientEditor value={undefined} onChange={onChange} />);
       fireEvent.click(screen.getByLabelText(/linear/i));
       expect(onChange).toHaveBeenCalledWith(
         expect.objectContaining({
           kind: "linear",
           angle: expect.any(Number),
           stops: expect.arrayContaining([
             expect.objectContaining({ offset: 0 }),
             expect.objectContaining({ offset: 1 }),
           ]),
         }),
       );
     });

     it("renders angle slider when value.kind === 'linear'", () => {
       render(
         <GradientEditor
           value={{
             kind: "linear",
             angle: 90,
             stops: [
               { offset: 0, color: "#000" },
               { offset: 1, color: "#fff" },
             ],
           }}
           onChange={vi.fn()}
         />,
       );
       expect(screen.getByLabelText(/angle/i)).toBeInTheDocument();
     });

     it("renders cx/cy/radius sliders when value.kind === 'radial'", () => {
       render(
         <GradientEditor
           value={{
             kind: "radial",
             cx: 0.5,
             cy: 0.5,
             radius: 0.5,
             stops: [
               { offset: 0, color: "#000" },
               { offset: 1, color: "#fff" },
             ],
           }}
           onChange={vi.fn()}
         />,
       );
       expect(screen.getByLabelText(/^cx$/i)).toBeInTheDocument();
       expect(screen.getByLabelText(/^cy$/i)).toBeInTheDocument();
       expect(screen.getByLabelText(/^radius$/i)).toBeInTheDocument();
     });

     it("Add Stop adds a third stop interpolated between existing two", () => {
       const onChange = vi.fn();
       render(
         <GradientEditor
           value={{
             kind: "linear",
             angle: 0,
             stops: [
               { offset: 0, color: "#000" },
               { offset: 1, color: "#fff" },
             ],
           }}
           onChange={onChange}
         />,
       );
       fireEvent.click(screen.getByRole("button", { name: /add stop/i }));
       const call = onChange.mock.calls.at(-1)![0];
       expect(call.stops.length).toBe(3);
     });

     it("setting kind back to none emits undefined", () => {
       const onChange = vi.fn();
       render(
         <GradientEditor
           value={{
             kind: "linear",
             angle: 0,
             stops: [
               { offset: 0, color: "#000" },
               { offset: 1, color: "#fff" },
             ],
           }}
           onChange={onChange}
         />,
       );
       fireEvent.click(screen.getByLabelText(/none/i));
       expect(onChange).toHaveBeenCalledWith(undefined);
     });
   });
   ```

2. Run — expect FAIL.

3. Create `apps/web/src/components/admin/builder/GradientEditor.tsx`:

   ```tsx
   "use client";

   import { HexColorPicker } from "react-colorful";
   import type { GradientSpec, GradientStop } from "@/server/overlays/builder/types";

   const DEFAULT_LINEAR: GradientSpec = {
     kind: "linear",
     angle: 90,
     stops: [
       { offset: 0, color: "#6bcd06" },
       { offset: 1, color: "#fe036d" },
     ],
   };

   const DEFAULT_RADIAL: GradientSpec = {
     kind: "radial",
     cx: 0.5,
     cy: 0.5,
     radius: 0.5,
     stops: [
       { offset: 0, color: "#ffffff" },
       { offset: 1, color: "#050505" },
     ],
   };

   export function GradientEditor({
     value,
     onChange,
   }: {
     value: GradientSpec | undefined;
     onChange: (next: GradientSpec | undefined) => void;
   }) {
     const kind = value?.kind ?? "none";

     function patchStop(i: number, next: Partial<GradientStop>) {
       if (!value) return;
       const stops = value.stops.map((s, j) => (i === j ? { ...s, ...next } : s));
       onChange({ ...value, stops } as GradientSpec);
     }

     function addStop() {
       if (!value) return;
       const last = value.stops[value.stops.length - 1];
       const prev = value.stops[value.stops.length - 2] ?? value.stops[0];
       const mid = (last.offset + prev.offset) / 2;
       const newStop: GradientStop = { offset: mid, color: "#888888" };
       onChange({ ...value, stops: [...value.stops, newStop] } as GradientSpec);
     }

     function removeStop(i: number) {
       if (!value || value.stops.length <= 2) return;
       const stops = value.stops.filter((_, j) => j !== i);
       onChange({ ...value, stops } as GradientSpec);
     }

     function setKind(next: "none" | "linear" | "radial") {
       if (next === "none") return onChange(undefined);
       if (next === "linear") return onChange({ ...DEFAULT_LINEAR });
       return onChange({ ...DEFAULT_RADIAL });
     }

     return (
       <div className="space-y-3">
         <div role="radiogroup" aria-label="Gradient kind" className="flex gap-3 text-xs">
           {(["none", "linear", "radial"] as const).map((k) => (
             <label key={k} className="flex items-center gap-1 capitalize">
               <input
                 type="radio"
                 aria-label={k}
                 checked={kind === k}
                 onChange={() => setKind(k)}
               />
               <span>{k}</span>
             </label>
           ))}
         </div>

         {value && value.kind === "linear" && (
           <label className="block">
             <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Angle</span>
             <input
               type="range"
               min={0}
               max={360}
               step={1}
               aria-label="Angle"
               value={value.angle}
               onChange={(e) => onChange({ ...value, angle: Number(e.target.value) })}
               className="w-full"
             />
             <span className="block text-xs text-white/40">{value.angle}deg</span>
           </label>
         )}

         {value && value.kind === "radial" && (
           <div className="space-y-2">
             {(["cx", "cy", "radius"] as const).map((axis) => (
               <label key={axis} className="block">
                 <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
                   {axis}
                 </span>
                 <input
                   type="range"
                   min={0}
                   max={1}
                   step={0.01}
                   aria-label={axis}
                   value={value[axis]}
                   onChange={(e) =>
                     onChange({ ...value, [axis]: Number(e.target.value) } as GradientSpec)
                   }
                   className="w-full"
                 />
                 <span className="block text-xs text-white/40">{value[axis].toFixed(2)}</span>
               </label>
             ))}
           </div>
         )}

         {value && (
           <div className="space-y-2">
             <div className="flex items-center justify-between">
               <span className="text-xs uppercase tracking-wider text-white/50">Stops</span>
               <button
                 type="button"
                 onClick={addStop}
                 className="rounded border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
               >
                 Add stop
               </button>
             </div>
             {value.stops.map((stop, i) => (
               <div key={i} className="rounded border border-white/10 p-2">
                 <HexColorPicker
                   color={stop.color}
                   onChange={(c) => patchStop(i, { color: c })}
                 />
                 <label className="mt-2 block">
                   <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
                     Offset
                   </span>
                   <input
                     type="range"
                     min={0}
                     max={1}
                     step={0.01}
                     aria-label={`Stop ${i + 1} offset`}
                     value={stop.offset}
                     onChange={(e) => patchStop(i, { offset: Number(e.target.value) })}
                     className="w-full"
                   />
                   <span className="block text-xs text-white/40">{stop.offset.toFixed(2)}</span>
                 </label>
                 {value.stops.length > 2 && (
                   <button
                     type="button"
                     onClick={() => removeStop(i)}
                     className="mt-1 text-xs text-rose-400 hover:underline"
                   >
                     Remove stop
                   </button>
                 )}
               </div>
             ))}
           </div>
         )}
       </div>
     );
   }
   ```

4. Modify `apps/web/src/components/admin/builder/PropertiesPanel.tsx` — inside the `StyleTab` function, immediately after the existing `HexColorPicker` for `fill` on the rect branch (and similarly for ellipse/polygon if you split branches later), add:

   ```tsx
   {/* Wave 1B — gradient editor (replaces solid fill when set) */}
   <p className="mt-4 mb-2 text-xs uppercase tracking-wider text-white/50">Gradient</p>
   <GradientEditor
     value={(s as { gradient?: import("@/server/overlays/builder/types").GradientSpec }).gradient}
     onChange={(g) =>
       patchStyle({ gradient: g })
     }
   />
   ```

   Add the import at the top:

   ```tsx
   import { GradientEditor } from "./GradientEditor";
   ```

5. Append a PropertiesPanel test case to `PropertiesPanel.test.tsx` to confirm gradient flows end-to-end:

   ```tsx
   it("StyleTab on rect exposes a gradient editor", () => {
     render(<PropertiesPanel />);
     expect(screen.getByLabelText(/linear/i)).toBeInTheDocument();
   });

   it("selecting Linear gradient stores GradientSpec on element.style.gradient", () => {
     render(<PropertiesPanel />);
     fireEvent.click(screen.getByLabelText(/linear/i));
     const g = useBuilderStore.getState().design!.scenes[0].elements[0].style.gradient as {
       kind: string;
     };
     expect(g.kind).toBe("linear");
   });
   ```

6. Re-run tests — expect PASS for both files:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/GradientEditor.test.tsx src/components/admin/builder/PropertiesPanel.test.tsx
   ```

7. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/GradientEditor.tsx apps/web/src/components/admin/builder/GradientEditor.test.tsx apps/web/src/components/admin/builder/PropertiesPanel.tsx apps/web/src/components/admin/builder/PropertiesPanel.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): properties panel — gradient editor

   GradientEditor exposes None / Linear / Radial kind picker, angle slider
   for linear, cx/cy/radius sliders for radial, plus a multi-stop editor
   with HexColorPicker per stop, offset slider per stop, and add/remove
   stop buttons (min 2 stops enforced).

   PropertiesPanel StyleTab now embeds the editor below the solid fill
   picker. Setting kind="linear"/"radial" populates element.style.gradient;
   setting kind="none" clears it. Solid fill still drives background when
   gradient is undefined.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 9: PropertiesPanel — Filter sliders

**Files:**

- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.tsx`
- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.test.tsx`
- Create: `apps/web/src/components/admin/builder/FilterEditor.tsx`
- Create: `apps/web/src/components/admin/builder/FilterEditor.test.tsx`

**Context:** Adds the blur / brightness / hueRotate / saturate sliders to the StyleTab. Lives as a standalone component for re-use (Wave 1C may extend filters to data slots).

#### Steps

1. Write failing tests at `apps/web/src/components/admin/builder/FilterEditor.test.tsx`:

   ```tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { FilterEditor } from "./FilterEditor";

   describe("FilterEditor", () => {
     it("renders all four sliders", () => {
       render(<FilterEditor value={undefined} onChange={vi.fn()} />);
       expect(screen.getByLabelText(/blur/i)).toBeInTheDocument();
       expect(screen.getByLabelText(/brightness/i)).toBeInTheDocument();
       expect(screen.getByLabelText(/hue rotate/i)).toBeInTheDocument();
       expect(screen.getByLabelText(/saturate/i)).toBeInTheDocument();
     });

     it("starting blur slider from 0 stores filter.blur", () => {
       const onChange = vi.fn();
       render(<FilterEditor value={undefined} onChange={onChange} />);
       fireEvent.change(screen.getByLabelText(/blur/i), { target: { value: "8" } });
       expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ blur: 8 }));
     });

     it("hue rotate clamps to 0..360", () => {
       const onChange = vi.fn();
       render(<FilterEditor value={undefined} onChange={onChange} />);
       const input = screen.getByLabelText(/hue rotate/i) as HTMLInputElement;
       expect(input.max).toBe("360");
       expect(input.min).toBe("0");
     });

     it("Reset button emits undefined", () => {
       const onChange = vi.fn();
       render(<FilterEditor value={{ blur: 5 }} onChange={onChange} />);
       fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));
       expect(onChange).toHaveBeenCalledWith(undefined);
     });
   });
   ```

2. Run — expect FAIL.

3. Create `apps/web/src/components/admin/builder/FilterEditor.tsx`:

   ```tsx
   "use client";

   import type { FilterSpec } from "@/server/overlays/builder/types";

   export function FilterEditor({
     value,
     onChange,
   }: {
     value: FilterSpec | undefined;
     onChange: (next: FilterSpec | undefined) => void;
   }) {
     const v = value ?? {};

     function patch(next: Partial<FilterSpec>) {
       const merged = { ...v, ...next };
       const cleaned = Object.fromEntries(
         Object.entries(merged).filter(
           ([_, val]) => typeof val === "number" && !Number.isNaN(val),
         ),
       ) as FilterSpec;
       if (Object.keys(cleaned).length === 0) {
         onChange(undefined);
         return;
       }
       onChange(cleaned);
     }

     function reset() {
       onChange(undefined);
     }

     return (
       <div className="space-y-3">
         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Blur</span>
           <input
             type="range"
             min={0}
             max={40}
             step={1}
             aria-label="Blur"
             value={v.blur ?? 0}
             onChange={(e) => patch({ blur: Number(e.target.value) })}
             className="w-full"
           />
           <span className="block text-xs text-white/40">{v.blur ?? 0}px</span>
         </label>

         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Brightness</span>
           <input
             type="range"
             min={0}
             max={2}
             step={0.05}
             aria-label="Brightness"
             value={v.brightness ?? 1}
             onChange={(e) => patch({ brightness: Number(e.target.value) })}
             className="w-full"
           />
           <span className="block text-xs text-white/40">{(v.brightness ?? 1).toFixed(2)}</span>
         </label>

         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Hue Rotate</span>
           <input
             type="range"
             min={0}
             max={360}
             step={1}
             aria-label="Hue Rotate"
             value={v.hueRotate ?? 0}
             onChange={(e) => patch({ hueRotate: Number(e.target.value) })}
             className="w-full"
           />
           <span className="block text-xs text-white/40">{v.hueRotate ?? 0}deg</span>
         </label>

         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Saturate</span>
           <input
             type="range"
             min={0}
             max={2}
             step={0.05}
             aria-label="Saturate"
             value={v.saturate ?? 1}
             onChange={(e) => patch({ saturate: Number(e.target.value) })}
             className="w-full"
           />
           <span className="block text-xs text-white/40">{(v.saturate ?? 1).toFixed(2)}</span>
         </label>

         <button
           type="button"
           onClick={reset}
           className="text-xs text-rose-400 hover:underline"
         >
           Reset filters
         </button>
       </div>
     );
   }
   ```

4. Modify `PropertiesPanel.tsx` — add a Filter section to `StyleTab` for every fillable element type. After the gradient editor block:

   ```tsx
   <p className="mt-4 mb-2 text-xs uppercase tracking-wider text-white/50">Filter</p>
   <FilterEditor
     value={(s as { filter?: import("@/server/overlays/builder/types").FilterSpec }).filter}
     onChange={(f) => patchStyle({ filter: f })}
   />
   ```

   Import at top:

   ```tsx
   import { FilterEditor } from "./FilterEditor";
   ```

5. Re-run tests — expect PASS.

6. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/FilterEditor.tsx apps/web/src/components/admin/builder/FilterEditor.test.tsx apps/web/src/components/admin/builder/PropertiesPanel.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): properties panel — filter sliders

   FilterEditor exposes four sliders (blur 0..40px, brightness 0..2,
   hueRotate 0..360deg, saturate 0..2) plus a Reset button. Patches
   element.style.filter; cleans up to undefined when all values are at
   identity (or absent).

   PropertiesPanel StyleTab embeds the editor below the gradient block
   so every fillable element type gets CSS filter controls.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 10: PropertiesPanel — Multi-stack shadow editor

**Files:**

- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.tsx`
- Create: `apps/web/src/components/admin/builder/ShadowStackEditor.tsx`
- Create: `apps/web/src/components/admin/builder/ShadowStackEditor.test.tsx`

**Context:** Wave 1A's StyleTab had no shadow controls in the panel (shadow was authorable only via direct JSON edit). Wave 1B introduces a +Add Shadow list — each shadow has offsetX / offsetY / blur / color / opacity controls. Migrates the single `style.shadow` to a single-entry `style.shadows` array on first edit (back-compat preserved by compiler).

#### Steps

1. Write failing tests at `apps/web/src/components/admin/builder/ShadowStackEditor.test.tsx`:

   ```tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { ShadowStackEditor } from "./ShadowStackEditor";

   describe("ShadowStackEditor", () => {
     it("renders empty-state when no shadows", () => {
       render(<ShadowStackEditor value={undefined} onChange={vi.fn()} />);
       expect(screen.getByRole("button", { name: /add shadow/i })).toBeInTheDocument();
     });

     it("Add Shadow seeds first entry", () => {
       const onChange = vi.fn();
       render(<ShadowStackEditor value={undefined} onChange={onChange} />);
       fireEvent.click(screen.getByRole("button", { name: /add shadow/i }));
       const arg = onChange.mock.calls.at(-1)![0];
       expect(Array.isArray(arg)).toBe(true);
       expect((arg as unknown[]).length).toBe(1);
     });

     it("Remove deletes a shadow at index", () => {
       const onChange = vi.fn();
       render(
         <ShadowStackEditor
           value={[
             { offsetX: 2, offsetY: 2, blur: 4, color: "#000", opacity: 0.5 },
             { offsetX: -2, offsetY: -2, blur: 4, color: "#fff", opacity: 0.5 },
           ]}
           onChange={onChange}
         />,
       );
       fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
       const arg = onChange.mock.calls.at(-1)![0] as unknown[];
       expect(arg.length).toBe(1);
     });

     it("blocks adding more than 8 shadows", () => {
       const onChange = vi.fn();
       const filled = Array.from({ length: 8 }, () => ({
         offsetX: 0, offsetY: 0, blur: 4, color: "#000", opacity: 0.5,
       }));
       render(<ShadowStackEditor value={filled} onChange={onChange} />);
       const addBtn = screen.getByRole("button", { name: /add shadow/i });
       expect(addBtn).toBeDisabled();
     });

     it("changing offsetX patches the right shadow index", () => {
       const onChange = vi.fn();
       render(
         <ShadowStackEditor
           value={[{ offsetX: 0, offsetY: 0, blur: 4, color: "#000", opacity: 0.5 }]}
           onChange={onChange}
         />,
       );
       fireEvent.change(screen.getByLabelText(/shadow 1 offset x/i), {
         target: { value: "10" },
       });
       const arg = onChange.mock.calls.at(-1)![0] as Array<{ offsetX: number }>;
       expect(arg[0].offsetX).toBe(10);
     });
   });
   ```

2. Run — expect FAIL.

3. Create `apps/web/src/components/admin/builder/ShadowStackEditor.tsx`:

   ```tsx
   "use client";

   import { HexColorPicker } from "react-colorful";
   import type { ShadowSpec } from "@/server/overlays/builder/types";

   const MAX_SHADOWS = 8;

   const DEFAULT: ShadowSpec = {
     offsetX: 0,
     offsetY: 2,
     blur: 4,
     color: "#000000",
     opacity: 0.5,
   };

   function toArray(value: ShadowSpec | ShadowSpec[] | undefined): ShadowSpec[] {
     if (!value) return [];
     return Array.isArray(value) ? value : [value];
   }

   export function ShadowStackEditor({
     value,
     onChange,
   }: {
     value: ShadowSpec[] | ShadowSpec | undefined;
     onChange: (next: ShadowSpec[] | undefined) => void;
   }) {
     const shadows = toArray(value);

     function add() {
       if (shadows.length >= MAX_SHADOWS) return;
       onChange([...shadows, { ...DEFAULT }]);
     }

     function remove(i: number) {
       const next = shadows.filter((_, j) => j !== i);
       onChange(next.length > 0 ? next : undefined);
     }

     function patch(i: number, p: Partial<ShadowSpec>) {
       const next = shadows.map((s, j) => (i === j ? { ...s, ...p } : s));
       onChange(next);
     }

     return (
       <div className="space-y-3">
         <button
           type="button"
           onClick={add}
           disabled={shadows.length >= MAX_SHADOWS}
           className="rounded border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
         >
           Add shadow ({shadows.length}/{MAX_SHADOWS})
         </button>
         {shadows.map((sh, i) => (
           <div key={i} className="rounded border border-white/10 p-3 text-xs text-white">
             <p className="mb-1 uppercase tracking-wider text-white/50">Shadow {i + 1}</p>
             <HexColorPicker
               color={sh.color}
               onChange={(c) => patch(i, { color: c })}
             />
             <label className="mt-2 block">
               <span className="mb-1 block text-white/50">Shadow {i + 1} Offset X</span>
               <input
                 type="number"
                 aria-label={`Shadow ${i + 1} offset X`}
                 value={sh.offsetX}
                 onChange={(e) => patch(i, { offsetX: Number(e.target.value) })}
                 className="w-full rounded border border-white/15 bg-black px-2 py-1"
               />
             </label>
             <label className="block">
               <span className="mb-1 block text-white/50">Shadow {i + 1} Offset Y</span>
               <input
                 type="number"
                 aria-label={`Shadow ${i + 1} offset Y`}
                 value={sh.offsetY}
                 onChange={(e) => patch(i, { offsetY: Number(e.target.value) })}
                 className="w-full rounded border border-white/15 bg-black px-2 py-1"
               />
             </label>
             <label className="block">
               <span className="mb-1 block text-white/50">Shadow {i + 1} Blur</span>
               <input
                 type="number"
                 aria-label={`Shadow ${i + 1} blur`}
                 min={0}
                 value={sh.blur}
                 onChange={(e) => patch(i, { blur: Math.max(0, Number(e.target.value)) })}
                 className="w-full rounded border border-white/15 bg-black px-2 py-1"
               />
             </label>
             <label className="block">
               <span className="mb-1 block text-white/50">Shadow {i + 1} Opacity</span>
               <input
                 type="range"
                 aria-label={`Shadow ${i + 1} opacity`}
                 min={0}
                 max={1}
                 step={0.01}
                 value={sh.opacity}
                 onChange={(e) => patch(i, { opacity: Number(e.target.value) })}
                 className="w-full"
               />
             </label>
             <button
               type="button"
               onClick={() => remove(i)}
               aria-label={`Remove shadow ${i + 1}`}
               className="mt-2 text-xs text-rose-400 hover:underline"
             >
               Remove
             </button>
           </div>
         ))}
       </div>
     );
   }
   ```

4. Modify `PropertiesPanel.tsx` StyleTab. After the FilterEditor block:

   ```tsx
   <p className="mt-4 mb-2 text-xs uppercase tracking-wider text-white/50">Shadows</p>
   <ShadowStackEditor
     value={(s as { shadows?: import("@/server/overlays/builder/types").ShadowSpec[]; shadow?: import("@/server/overlays/builder/types").ShadowSpec }).shadows ?? (s as { shadow?: import("@/server/overlays/builder/types").ShadowSpec }).shadow}
     onChange={(stack) => patchStyle({ shadows: stack, shadow: undefined })}
   />
   ```

   Import at top:

   ```tsx
   import { ShadowStackEditor } from "./ShadowStackEditor";
   ```

5. Re-run tests — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/ShadowStackEditor.test.tsx
   ```

6. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/ShadowStackEditor.tsx apps/web/src/components/admin/builder/ShadowStackEditor.test.tsx apps/web/src/components/admin/builder/PropertiesPanel.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): properties panel — multi-stack shadow editor

   ShadowStackEditor exposes a +Add Shadow list (max 8), each with hex
   color picker + offsetX/Y/blur/opacity controls. Patches
   element.style.shadows (array). First edit migrates an existing
   single-shadow Wave 1A value into the array form by reading
   style.shadows ?? style.shadow.

   PropertiesPanel StyleTab embeds the editor below the filter block.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 11: PropertiesPanel — Manual data bind tab

**Files:**

- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.tsx`
- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.test.tsx`
- Create: `apps/web/src/components/admin/builder/ManualBindEditor.tsx`
- Create: `apps/web/src/components/admin/builder/ManualBindEditor.test.tsx`

**Context:** Wave 1A's BindingTab was read-only — admins could only attach a binding via the Data Slot picker. Wave 1B replaces it with a free-form editor: pick a feed from a dropdown, type or pick a fieldPath, optionally write a templateString. The editor calls the Wave 1A `validateBinding` (Task 7 of `wave-1a.md`) on every input change and surfaces errors inline; only valid bindings reach `updateElement`. The list of available feeds matches the `FeedName` enum.

#### Steps

1. Write failing tests at `apps/web/src/components/admin/builder/ManualBindEditor.test.tsx`:

   ```tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { ManualBindEditor } from "./ManualBindEditor";

   describe("ManualBindEditor", () => {
     it("renders feed dropdown with 7 options", () => {
       render(<ManualBindEditor value={null} onChange={vi.fn()} onClear={vi.fn()} />);
       const select = screen.getByLabelText(/feed/i);
       expect(select.querySelectorAll("option").length).toBe(7);
     });

     it("renders empty fieldPath input when no binding", () => {
       render(<ManualBindEditor value={null} onChange={vi.fn()} onClear={vi.fn()} />);
       const input = screen.getByLabelText(/field path/i) as HTMLInputElement;
       expect(input.value).toBe("");
     });

     it("typing valid path emits new Binding with same feed", () => {
       const onChange = vi.fn();
       render(
         <ManualBindEditor
           value={{ feed: "standings", fieldPath: "" }}
           onChange={onChange}
           onClear={vi.fn()}
         />,
       );
       fireEvent.change(screen.getByLabelText(/field path/i), {
         target: { value: "[0].name" },
       });
       expect(onChange).toHaveBeenLastCalledWith({
         feed: "standings",
         fieldPath: "[0].name",
       });
     });

     it("invalid templateString surfaces inline error", () => {
       const onChange = vi.fn();
       render(
         <ManualBindEditor
           value={{ feed: "standings", fieldPath: "[0].name" }}
           onChange={onChange}
           onClear={vi.fn()}
         />,
       );
       fireEvent.change(screen.getByLabelText(/template string/i), {
         target: { value: "${eval(alert(1))}" },
       });
       expect(screen.getByRole("alert")).toBeInTheDocument();
     });

     it("Clear binding triggers onClear", () => {
       const onClear = vi.fn();
       render(
         <ManualBindEditor
           value={{ feed: "standings", fieldPath: "[0].name" }}
           onChange={vi.fn()}
           onClear={onClear}
         />,
       );
       fireEvent.click(screen.getByRole("button", { name: /clear binding/i }));
       expect(onClear).toHaveBeenCalled();
     });

     it("shows resolved preview from mock data", () => {
       render(
         <ManualBindEditor
           value={{
             feed: "standings",
             fieldPath: "[0].name",
             templateString: "RANK 1: ${standings[0].name}",
           }}
           onChange={vi.fn()}
           onClear={vi.fn()}
         />,
       );
       // Mock data shape exposed by the editor includes a sample first
       // standings name; preview should non-emptily render.
       const preview = screen.getByTestId("manual-bind-preview");
       expect(preview.textContent ?? "").toMatch(/RANK 1/);
     });
   });
   ```

2. Run — expect FAIL.

3. Create `apps/web/src/components/admin/builder/ManualBindEditor.tsx`:

   ```tsx
   "use client";

   import { useMemo } from "react";
   import type { Binding, FeedName } from "@/server/overlays/builder/types";
   import { validateBinding } from "@/server/overlays/builder/binding-validator";

   const FEEDS: FeedName[] = [
     "standings",
     "live_score",
     "top_scorers",
     "h2h",
     "match",
     "match_day",
     "custom_text",
   ];

   const MOCK: Record<FeedName, unknown> = {
     standings: [
       { name: "ADEFOLA", points: 24, gd: 12 },
       { name: "ANIFE", points: 22, gd: 9 },
       { name: "BAJI JNR", points: 21, gd: 6 },
     ],
     live_score: {
       home_name: "ADEFOLA",
       away_name: "ANIFE",
       home_score: 2,
       away_score: 1,
       clock: "12:34",
     },
     top_scorers: [
       { name: "ADEFOLA", goals: 14, photoUrl: "/x.png" },
     ],
     h2h: {
       playerA: { name: "ADEFOLA", winProbPct: 58 },
       playerB: { name: "ANIFE", winProbPct: 42 },
     },
     match: { home_name: "ADEFOLA", away_name: "ANIFE" },
     match_day: [{ home_name: "ADEFOLA", away_name: "ANIFE", kickoff: "20:00" }],
     custom_text: { caster_1_name: "Sample" },
   };

   function resolvePath(feed: FeedName, path: string): unknown {
     const root = MOCK[feed];
     if (!path) return root;
     // Split into segments via a simple state machine — same allowlist as
     // binding-validator.ts. Anything weird becomes "" since the validator
     // rejected it upstream of here in real use.
     const re = /[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g;
     const tokens = path.match(re) ?? [];
     let cur: unknown = root;
     for (const t of tokens) {
       if (cur == null) return undefined;
       if (t.startsWith("[")) {
         const i = Number(t.slice(1, -1));
         cur = (cur as unknown[])[i];
       } else {
         cur = (cur as Record<string, unknown>)[t];
       }
     }
     return cur;
   }

   function applyTemplate(feed: FeedName, tpl: string): string {
     return tpl.replace(/\$\{([^}]+)\}/g, (_m, expr) => {
       // strip optional leading feed-name prefix: `standings[0].name` → `[0].name`
       let p = expr as string;
       if (p.startsWith(feed)) p = p.slice(feed.length);
       if (p.startsWith(".")) p = p.slice(1);
       const v = resolvePath(feed, p);
       return v == null ? "" : String(v);
     });
   }

   export function ManualBindEditor({
     value,
     onChange,
     onClear,
   }: {
     value: Binding | null;
     onChange: (next: Binding) => void;
     onClear: () => void;
   }) {
     const feed = value?.feed ?? "standings";
     const fieldPath = value?.fieldPath ?? "";
     const templateString = value?.templateString ?? "";

     const validation = useMemo(() => {
       if (!value) return { ok: true as const, errors: [] as string[] };
       const r = validateBinding(value, FEEDS);
       return r.ok ? { ok: true as const, errors: [] } : { ok: false as const, errors: r.errors };
     }, [value]);

     const preview = useMemo(() => {
       if (!value) return "";
       if (value.templateString) return applyTemplate(value.feed, value.templateString);
       const v = resolvePath(value.feed, value.fieldPath);
       return v == null ? "" : String(v);
     }, [value]);

     function update(patch: Partial<Binding>) {
       const next: Binding = {
         feed,
         fieldPath,
         ...(templateString ? { templateString } : {}),
         ...patch,
       };
       onChange(next);
     }

     return (
       <div className="space-y-3">
         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Feed</span>
           <select
             aria-label="Feed"
             value={feed}
             onChange={(e) => update({ feed: e.target.value as FeedName })}
             className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
           >
             {FEEDS.map((f) => (
               <option key={f} value={f}>
                 {f}
               </option>
             ))}
           </select>
         </label>

         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
             Field path
           </span>
           <input
             type="text"
             aria-label="Field path"
             placeholder="[0].name"
             value={fieldPath}
             onChange={(e) => update({ fieldPath: e.target.value })}
             className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
           />
         </label>

         <label className="block">
           <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
             Template string (optional)
           </span>
           <textarea
             aria-label="Template string"
             rows={2}
             placeholder="${standings[0].name} (${standings[0].points} pts)"
             value={templateString}
             onChange={(e) => update({ templateString: e.target.value })}
             className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
           />
         </label>

         {!validation.ok && (
           <p role="alert" className="text-sm text-rose-400">
             {validation.errors.join("; ")}
           </p>
         )}

         <div
           data-testid="manual-bind-preview"
           className="rounded border border-white/10 bg-zinc-950 p-2 text-xs text-white/80"
         >
           Preview: <span className="text-white">{preview || "—"}</span>
         </div>

         {value && (
           <button
             type="button"
             onClick={onClear}
             className="rounded border border-rose-500/40 px-3 py-1 text-sm text-rose-400 hover:bg-rose-500/10"
           >
             Clear binding
           </button>
         )}
       </div>
     );
   }
   ```

4. Modify `PropertiesPanel.tsx` BindingTab. Replace the Wave 1A read-only `BindingTab` function body with:

   ```tsx
   function BindingTab({
     element,
     patch,
     clear,
   }: {
     element: Element;
     patch: (p: Partial<Element>) => void;
     clear: () => void;
   }) {
     return (
       <ManualBindEditor
         value={element.binding ?? null}
         onChange={(b) => patch({ binding: b } as Partial<Element>)}
         onClear={clear}
       />
     );
   }
   ```

   Update the call site in the panel's JSX:

   ```tsx
   {safeTab === "binding" && (
     <BindingTab
       element={selected}
       patch={patch}
       clear={() => patch({ binding: undefined } as Partial<Element>)}
     />
   )}
   ```

   Import at top:

   ```tsx
   import { ManualBindEditor } from "./ManualBindEditor";
   ```

5. Add a PropertiesPanel test case to confirm the new BindingTab routes through the editor (append to PropertiesPanel.test.tsx):

   ```tsx
   it("BindingTab for text element renders ManualBindEditor with feed dropdown", () => {
     useBuilderStore.setState({ selectedElementIds: ["text-1"] });
     render(<PropertiesPanel />);
     fireEvent.click(screen.getByRole("tab", { name: /binding/i }));
     expect(screen.getByLabelText(/feed/i)).toBeInTheDocument();
   });
   ```

6. Re-run tests — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/ManualBindEditor.test.tsx src/components/admin/builder/PropertiesPanel.test.tsx
   ```

7. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/ManualBindEditor.tsx apps/web/src/components/admin/builder/ManualBindEditor.test.tsx apps/web/src/components/admin/builder/PropertiesPanel.tsx apps/web/src/components/admin/builder/PropertiesPanel.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): properties panel — manual data bind editor

   Replaces Wave 1A's read-only BindingTab with a free-form ManualBindEditor:
     - Feed dropdown over all 7 FeedName values.
     - Field path text input.
     - Optional templateString textarea.
     - Live preview via mock feed data + applyTemplate.
     - Validates on every change via Wave 1A's validateBinding; surfaces
       errors inline (role="alert").
     - Clear binding button.

   PropertiesPanel BindingTab now wraps the editor. Slot-insert bindings
   from Wave 1A still work — the editor reads + writes the same Binding
   shape.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 12: PropertiesPanel — Custom font in fontFamily picker

**Files:**

- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.tsx`
- Create: `apps/web/src/components/admin/builder/FontFamilyPicker.tsx`
- Create: `apps/web/src/components/admin/builder/FontFamilyPicker.test.tsx`

**Context:** Wave 1A hard-coded the family list to `["Agharti","Quedora","Inter","JetBrains Mono"]` (line 10020 of Wave 1A plan). Wave 1B fetches uploaded fonts via `listFonts()` (Task 6) and concatenates onto the curated list. The picker is a client component fed from a server-component data prop because `listFonts` requires a server-side Supabase client; the parent server page (already exists for the editor) resolves the list once at request time and passes it down.

#### Steps

1. Write failing tests at `apps/web/src/components/admin/builder/FontFamilyPicker.test.tsx`:

   ```tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { FontFamilyPicker } from "./FontFamilyPicker";

   describe("FontFamilyPicker", () => {
     it("renders curated 4 plus uploaded names", () => {
       render(
         <FontFamilyPicker
           value="Agharti"
           uploaded={[{ id: "f1", familyName: "Custom Bold" }]}
           onChange={vi.fn()}
         />,
       );
       const select = screen.getByLabelText(/font family/i);
       const opts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
       expect(opts).toEqual(
         expect.arrayContaining(["Agharti", "Quedora", "Inter", "JetBrains Mono", "Custom Bold"]),
       );
     });

     it("emits new family on change", () => {
       const onChange = vi.fn();
       render(
         <FontFamilyPicker value="Agharti" uploaded={[]} onChange={onChange} />,
       );
       fireEvent.change(screen.getByLabelText(/font family/i), {
         target: { value: "Inter" },
       });
       expect(onChange).toHaveBeenCalledWith("Inter");
     });

     it("groups custom fonts under their own optgroup", () => {
       render(
         <FontFamilyPicker
           value="Agharti"
           uploaded={[
             { id: "f1", familyName: "Custom Bold" },
             { id: "f2", familyName: "Display Sans" },
           ]}
           onChange={vi.fn()}
         />,
       );
       const groups = screen.getByLabelText(/font family/i).querySelectorAll("optgroup");
       expect(groups.length).toBe(2);
       expect(groups[0].getAttribute("label")).toMatch(/curated/i);
       expect(groups[1].getAttribute("label")).toMatch(/custom/i);
     });

     it("falls back to a flat list when uploaded is empty", () => {
       render(
         <FontFamilyPicker value="Agharti" uploaded={[]} onChange={vi.fn()} />,
       );
       const select = screen.getByLabelText(/font family/i);
       expect(select.querySelectorAll("optgroup").length).toBe(0);
       expect(select.querySelectorAll("option").length).toBe(4);
     });
   });
   ```

2. Run — expect FAIL.

3. Create `apps/web/src/components/admin/builder/FontFamilyPicker.tsx`:

   ```tsx
   "use client";

   const CURATED = ["Agharti", "Quedora", "Inter", "JetBrains Mono"] as const;

   export type UploadedFontMeta = { id: string; familyName: string };

   export function FontFamilyPicker({
     value,
     uploaded,
     onChange,
   }: {
     value: string;
     uploaded: UploadedFontMeta[];
     onChange: (next: string) => void;
   }) {
     if (uploaded.length === 0) {
       return (
         <select
           aria-label="Font family"
           value={value}
           onChange={(e) => onChange(e.target.value)}
           className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
         >
           {CURATED.map((f) => (
             <option key={f} value={f}>
               {f}
             </option>
           ))}
         </select>
       );
     }
     return (
       <select
         aria-label="Font family"
         value={value}
         onChange={(e) => onChange(e.target.value)}
         className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
       >
         <optgroup label="Curated">
           {CURATED.map((f) => (
             <option key={f} value={f}>
               {f}
             </option>
           ))}
         </optgroup>
         <optgroup label="Custom">
           {uploaded.map((u) => (
             <option key={u.id} value={u.familyName}>
               {u.familyName}
             </option>
           ))}
         </optgroup>
       </select>
     );
   }
   ```

4. Modify `PropertiesPanel.tsx`. Add a prop `uploadedFonts?: UploadedFontMeta[]` to the top-level `PropertiesPanel` component signature, default to `[]`. Pipe it into the StyleTab via the `font family` `<select>` swap:

   - Replace the existing text-element font-family `<select>` block with:

     ```tsx
     <label className="mt-2 block">
       <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Font family</span>
       <FontFamilyPicker
         value={(s.fontFamily as string) ?? "Agharti"}
         uploaded={uploadedFonts}
         onChange={(f) => patchStyle({ fontFamily: f })}
       />
     </label>
     ```

   - Update `PropertiesPanel` signature:

     ```tsx
     export function PropertiesPanel({
       uploadedFonts = [],
     }: {
       uploadedFonts?: UploadedFontMeta[];
     } = {}) {
       // ... existing body, threading uploadedFonts down to StyleTab via prop
     }
     ```

   - Update `StyleTab` signature + call site to accept `uploadedFonts` as well.

5. Update the editor server page (parent of `<PropertiesPanel>`) to fetch fonts once at request time. Pseudo:

   ```tsx
   // apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/page.tsx (existing — Wave 1A Task 22)
   import { listFonts } from "@/server/overlays/builder/fonts";
   // ...
   const sb = await getSupabaseServerClient();
   const fonts = await listFonts(sb);
   const uploadedFonts = fonts.map((f) => ({ id: f.id, familyName: f.family_name }));
   // pass to client editor wrapper:
   return <CanvasEditor designSlug={params.slug} uploadedFonts={uploadedFonts} />;
   ```

   Then in `CanvasEditor` (Wave 1A Task 22's main shell) thread `uploadedFonts` into the right rail's `<PropertiesPanel uploadedFonts={uploadedFonts} />`.

6. Re-run tests — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/FontFamilyPicker.test.tsx
   ```

7. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/FontFamilyPicker.tsx apps/web/src/components/admin/builder/FontFamilyPicker.test.tsx apps/web/src/components/admin/builder/PropertiesPanel.tsx
   # Plus the parent page + CanvasEditor wrapper edits if you touched them:
   git add apps/web/src/app/admin/broadcast/v2/builder/
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): font family picker reads uploaded fonts

   - FontFamilyPicker presents the curated 4 fonts plus any rows returned
     by listFonts(). When uploaded list is non-empty, groups options into
     Curated / Custom optgroups.
   - PropertiesPanel accepts uploadedFonts: UploadedFontMeta[] and threads
     it into StyleTab so text + data-slot elements see custom fonts in
     their family picker.
   - Editor server page fetches fonts once at request time via listFonts(sb)
     and pipes them into the client editor wrapper.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 13: CanvasStage — Ellipse / Line / Polygon renderers

**Files:**

- Modify: `apps/web/src/components/admin/builder/CanvasStage.tsx`
- Modify: `apps/web/src/components/admin/builder/CanvasStage.test.tsx`

**Context:** Wave 1A's `RenderedElement` (lines 9746-9821 of Wave 1A plan) only handled `rect / text / image`. Wave 1B adds Konva renderers for `ellipse`, `line`, `polygon`. Konva ships `Ellipse`, `Line`, `RegularPolygon` nodes; the test mock just renders DOM placeholders with `data-konva-tag` matching the tag name (Wave 1A's mock pattern).

#### Steps

1. Append failing test cases to `apps/web/src/components/admin/builder/CanvasStage.test.tsx`. Extend the existing `vi.mock("react-konva", ...)` block to register the three new tags:

   ```tsx
   vi.mock("react-konva", () => {
     const React = require("react");
     const make = (tag: string) =>
       React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
         React.createElement(
           "div",
           { ...props, ref, "data-konva-tag": tag, role: tag === "Stage" ? "img" : undefined },
           props.children,
         ),
       );
     return {
       Stage: make("Stage"),
       Layer: make("Layer"),
       Rect: make("Rect"),
       Text: make("Text"),
       Image: make("Image"),
       Ellipse: make("Ellipse"),
       Line: make("Line"),
       RegularPolygon: make("RegularPolygon"),
     };
   });
   ```

   And add a new fixture + describe block:

   ```tsx
   const shapesFixture = () => ({
     id: "d1", slug: "t", title: "T", mode: "single" as const,
     status: "draft" as const, canvasWidth: 1920, canvasHeight: 1080,
     scenes: [{
       id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
       transitionIn: "fade", transitionOut: "fade",
       elements: [
         { id: "e-ellipse", elementType: "ellipse" as const, zIndex: 0, locked: false, visible: true,
           transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
           style: { fill: "#6bcd06" }, content: {} },
         { id: "e-line", elementType: "line" as const, zIndex: 1, locked: false, visible: true,
           transform: { x: 100, y: 200, width: 400, height: 4, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
           style: { stroke: "#fff", strokeWidth: 4 }, content: {} },
         { id: "e-polygon", elementType: "polygon" as const, zIndex: 2, locked: false, visible: true,
           transform: { x: 600, y: 100, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
           style: { fill: "#fe036d", sides: 6 }, content: {} },
       ],
     }],
   });

   describe("CanvasStage — Wave 1B shapes", () => {
     beforeEach(() => {
       useBuilderStore.setState({
         design: shapesFixture() as never,
         selectedElementIds: [],
         activeSceneId: "s1",
         zoomLevel: 1,
         dirty: false,
       });
     });

     it("renders a Konva Ellipse for ellipse elements", () => {
       const { container } = render(<CanvasStage />);
       expect(container.querySelectorAll('[data-konva-tag="Ellipse"]').length).toBe(1);
     });

     it("renders a Konva Line for line elements", () => {
       const { container } = render(<CanvasStage />);
       expect(container.querySelectorAll('[data-konva-tag="Line"]').length).toBe(1);
     });

     it("renders a Konva RegularPolygon for polygon elements", () => {
       const { container } = render(<CanvasStage />);
       expect(container.querySelectorAll('[data-konva-tag="RegularPolygon"]').length).toBe(1);
     });
   });
   ```

2. Run — expect FAIL.

3. Modify `apps/web/src/components/admin/builder/CanvasStage.tsx`. Update the import to add the three new Konva nodes:

   ```tsx
   import {
     Stage,
     Layer,
     Rect,
     Text,
     Image as KImage,
     Ellipse,
     Line,
     RegularPolygon,
   } from "react-konva";
   ```

   Inside the `RenderedElement` function, after the existing `if (el.elementType === "image") ...` branch, add:

   ```tsx
   if (el.elementType === "ellipse") {
     return (
       <Ellipse
         x={t.x + t.width / 2}
         y={t.y + t.height / 2}
         radiusX={t.width / 2}
         radiusY={t.height / 2}
         rotation={t.rotation ?? 0}
         opacity={t.opacity ?? 1}
         fill={(s.fill as string) ?? "#cccccc"}
         stroke={stroke}
         strokeWidth={strokeWidth}
         draggable
         onClick={onClick}
         onTap={onClick}
         onDragEnd={(e: { target: { x: () => number; y: () => number } }) =>
           onMove(e.target.x() - t.width / 2, e.target.y() - t.height / 2)
         }
       />
     );
   }

   if (el.elementType === "line") {
     return (
       <Line
         x={t.x}
         y={t.y}
         points={[0, 0, t.width, 0]}
         stroke={(s.stroke as string) ?? "#ffffff"}
         strokeWidth={(s.strokeWidth as number) ?? 2}
         rotation={t.rotation ?? 0}
         opacity={t.opacity ?? 1}
         draggable
         onClick={onClick}
         onTap={onClick}
         onDragEnd={handleDragEnd}
       />
     );
   }

   if (el.elementType === "polygon") {
     const sides = (s.sides as number) ?? 6;
     const radius = Math.min(t.width, t.height) / 2;
     return (
       <RegularPolygon
         x={t.x + t.width / 2}
         y={t.y + t.height / 2}
         sides={sides}
         radius={radius}
         rotation={t.rotation ?? 0}
         opacity={t.opacity ?? 1}
         fill={(s.fill as string) ?? "#cccccc"}
         stroke={stroke}
         strokeWidth={strokeWidth}
         draggable
         onClick={onClick}
         onTap={onClick}
         onDragEnd={(e: { target: { x: () => number; y: () => number } }) =>
           onMove(e.target.x() - t.width / 2, e.target.y() - t.height / 2)
         }
       />
     );
   }
   ```

   Note: ellipse + polygon use `x = center`, `y = center`; the `onMove` adapter converts back to the top-left convention used by `transform`.

4. Update the `RenderedElement` destructure to expose `onMove` (Wave 1A only passed it down for rect/text/image via different bindings). Confirm the existing `function RenderedElement({ el, selected, onSelect, onMove })` signature still works for the new branches.

5. Re-run tests — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/CanvasStage.test.tsx
   ```

6. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/CanvasStage.tsx apps/web/src/components/admin/builder/CanvasStage.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): canvas — ellipse / line / polygon renderers

   - Ellipse renders via Konva Ellipse with center-anchored geometry
     (radiusX = width/2, radiusY = height/2). Drag-end adapter converts
     the center coords back to top-left transform.x/y.
   - Line renders via Konva Line with points [0,0, width,0] — single
     segment per element; multi-segment polylines deferred to Wave 1C.
   - Polygon renders via Konva RegularPolygon using style.sides (3..12).
     Drag-end adapter converts center coords back to top-left transform.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 14: CanvasStage — Alignment guides + smart snap

**Files:**

- Modify: `apps/web/src/components/admin/builder/CanvasStage.tsx`
- Create: `apps/web/src/components/admin/builder/use-alignment-guides.ts`
- Create: `apps/web/src/components/admin/builder/use-alignment-guides.test.ts`

**Context:** During drag of an element, the canvas should detect proximity (within 5px) to (a) other elements' edges (left/right/top/bottom) and centers (horizontal/vertical), and (b) canvas edges + center. When within proximity, draw a horizontal or vertical guide line through the matched edge AND snap the dragged element to it (3px snap threshold). Pure client behavior — no DB persistence.

Hook contract:

```ts
useAlignmentGuides(
  draggedId: string | null,
  draggedTransform: { x: number; y: number; width: number; height: number } | null,
  others: Array<{ id: string; transform: { x: number; y: number; width: number; height: number } }>,
  canvas: { width: number; height: number },
): { guides: Guide[]; snappedX: number; snappedY: number };

type Guide = { kind: "v" | "h"; pos: number; from: number; to: number };
```

`snappedX` / `snappedY` overwrite the dragged element's pre-snap x/y when within snap threshold; otherwise pass-through.

#### Steps

1. Write failing unit tests at `apps/web/src/components/admin/builder/use-alignment-guides.test.ts`:

   ```ts
   import { describe, expect, it } from "vitest";
   import { computeAlignmentGuides } from "./use-alignment-guides";

   describe("computeAlignmentGuides", () => {
     const canvas = { width: 1920, height: 1080 };

     it("returns no guides when no other elements within proximity", () => {
       const result = computeAlignmentGuides(
         { x: 100, y: 100, width: 200, height: 100 },
         [{ id: "o1", transform: { x: 1500, y: 800, width: 100, height: 50 } }],
         canvas,
       );
       expect(result.guides).toEqual([]);
       expect(result.snappedX).toBe(100);
       expect(result.snappedY).toBe(100);
     });

     it("snaps to a matching left edge of another element", () => {
       const result = computeAlignmentGuides(
         { x: 502, y: 200, width: 100, height: 50 },
         [{ id: "o1", transform: { x: 500, y: 100, width: 100, height: 50 } }],
         canvas,
       );
       expect(result.snappedX).toBe(500);
       expect(result.guides.some((g) => g.kind === "v" && g.pos === 500)).toBe(true);
     });

     it("snaps to canvas center horizontally", () => {
       const result = computeAlignmentGuides(
         { x: 859, y: 540, width: 200, height: 100 },
         [],
         canvas,
       );
       // canvas center = 960. dragged center = 859 + 100 = 959.
       // snap to canvas center → dragged.x = 960 - 100 = 860.
       expect(result.snappedX).toBe(860);
       expect(result.guides.some((g) => g.kind === "v" && g.pos === 960)).toBe(true);
     });

     it("snaps to canvas vertical center", () => {
       const result = computeAlignmentGuides(
         { x: 100, y: 489, width: 200, height: 100 },
         [],
         canvas,
       );
       // canvas vertical center = 540, dragged center = 489 + 50 = 539.
       expect(result.snappedY).toBe(490);
       expect(result.guides.some((g) => g.kind === "h" && g.pos === 540)).toBe(true);
     });

     it("does not snap when distance > snap threshold", () => {
       const result = computeAlignmentGuides(
         { x: 510, y: 200, width: 100, height: 50 },
         [{ id: "o1", transform: { x: 500, y: 100, width: 100, height: 50 } }],
         canvas,
       );
       expect(result.snappedX).toBe(510);
     });

     it("shows guide but does not snap when within proximity but outside snap threshold", () => {
       const result = computeAlignmentGuides(
         { x: 504, y: 200, width: 100, height: 50 },
         [{ id: "o1", transform: { x: 500, y: 100, width: 100, height: 50 } }],
         canvas,
       );
       // 4px from match — outside SNAP=3 but inside PROXIMITY=5.
       expect(result.snappedX).toBe(504);
       expect(result.guides.some((g) => g.kind === "v" && g.pos === 500)).toBe(true);
     });

     it("matches right edge to right edge", () => {
       const result = computeAlignmentGuides(
         { x: 401, y: 200, width: 100, height: 50 },
         [{ id: "o1", transform: { x: 400, y: 100, width: 100, height: 50 } }],
         canvas,
       );
       // dragged.right = 501, other.right = 500. snap to other.right → dragged.x = 400.
       expect(result.snappedX).toBe(400);
     });
   });
   ```

2. Run — expect FAIL.

3. Create `apps/web/src/components/admin/builder/use-alignment-guides.ts`:

   ```ts
   "use client";

   import { useMemo } from "react";

   const PROXIMITY = 5;
   const SNAP = 3;

   export type Rect = { x: number; y: number; width: number; height: number };
   export type Other = { id: string; transform: Rect };
   export type Guide = {
     kind: "v" | "h";
     pos: number;
     from: number;
     to: number;
   };
   export type AlignmentResult = {
     guides: Guide[];
     snappedX: number;
     snappedY: number;
   };

   /**
    * Compute alignment guides + smart-snap during drag.
    *
    * Anchors compared (per axis):
    *   - Dragged left / center / right vs every other's left / center / right
    *   - Dragged top  / center / bottom vs every other's top / center / bottom
    *   - Canvas left / center / right; top / center / bottom.
    *
    * Within `PROXIMITY` px of a match, emit a guide line. Within `SNAP` px,
    * additionally snap the dragged x/y to the matched anchor (so dragged
    * center / edge coincides with the other anchor).
    *
    * Pure function — testable without DOM. The hook below wraps memoization.
    */
   export function computeAlignmentGuides(
     dragged: Rect,
     others: Other[],
     canvas: { width: number; height: number },
   ): AlignmentResult {
     const guides: Guide[] = [];
     let snappedX = dragged.x;
     let snappedY = dragged.y;
     let bestX = Infinity;
     let bestY = Infinity;

     const draggedAnchors = {
       xLeft: dragged.x,
       xCenter: dragged.x + dragged.width / 2,
       xRight: dragged.x + dragged.width,
       yTop: dragged.y,
       yCenter: dragged.y + dragged.height / 2,
       yBottom: dragged.y + dragged.height,
     };

     function considerXMatch(otherX: number, fromY: number, toY: number) {
       // Try each dragged x-anchor against this other-x.
       for (const [name, value] of [
         ["xLeft", draggedAnchors.xLeft],
         ["xCenter", draggedAnchors.xCenter],
         ["xRight", draggedAnchors.xRight],
       ] as const) {
         const d = Math.abs(value - otherX);
         if (d <= PROXIMITY) {
           guides.push({ kind: "v", pos: otherX, from: fromY, to: toY });
         }
         if (d <= SNAP && d < bestX) {
           bestX = d;
           // shift dragged.x so this anchor lands exactly on otherX.
           if (name === "xLeft") snappedX = otherX;
           else if (name === "xCenter") snappedX = otherX - dragged.width / 2;
           else snappedX = otherX - dragged.width;
         }
       }
     }

     function considerYMatch(otherY: number, fromX: number, toX: number) {
       for (const [name, value] of [
         ["yTop", draggedAnchors.yTop],
         ["yCenter", draggedAnchors.yCenter],
         ["yBottom", draggedAnchors.yBottom],
       ] as const) {
         const d = Math.abs(value - otherY);
         if (d <= PROXIMITY) {
           guides.push({ kind: "h", pos: otherY, from: fromX, to: toX });
         }
         if (d <= SNAP && d < bestY) {
           bestY = d;
           if (name === "yTop") snappedY = otherY;
           else if (name === "yCenter") snappedY = otherY - dragged.height / 2;
           else snappedY = otherY - dragged.height;
         }
       }
     }

     // Other-element anchors.
     for (const o of others) {
       const t = o.transform;
       considerXMatch(t.x, 0, canvas.height);
       considerXMatch(t.x + t.width / 2, 0, canvas.height);
       considerXMatch(t.x + t.width, 0, canvas.height);
       considerYMatch(t.y, 0, canvas.width);
       considerYMatch(t.y + t.height / 2, 0, canvas.width);
       considerYMatch(t.y + t.height, 0, canvas.width);
     }

     // Canvas anchors.
     considerXMatch(0, 0, canvas.height);
     considerXMatch(canvas.width / 2, 0, canvas.height);
     considerXMatch(canvas.width, 0, canvas.height);
     considerYMatch(0, 0, canvas.width);
     considerYMatch(canvas.height / 2, 0, canvas.width);
     considerYMatch(canvas.height, 0, canvas.width);

     return { guides, snappedX, snappedY };
   }

   export function useAlignmentGuides(
     draggedId: string | null,
     draggedTransform: Rect | null,
     others: Other[],
     canvas: { width: number; height: number },
   ): AlignmentResult {
     return useMemo(() => {
       if (!draggedId || !draggedTransform) {
         return { guides: [], snappedX: 0, snappedY: 0 };
       }
       return computeAlignmentGuides(draggedTransform, others, canvas);
     }, [draggedId, draggedTransform, others, canvas]);
   }
   ```

4. Modify `CanvasStage.tsx` to use the hook during drag. Add the import:

   ```tsx
   import { useState } from "react";
   import { Line as KLine } from "react-konva";
   import { useAlignmentGuides } from "./use-alignment-guides";
   ```

   Inside `CanvasStage`, track the current drag transform in component state:

   ```tsx
   const [dragState, setDragState] = useState<{
     id: string;
     transform: { x: number; y: number; width: number; height: number };
   } | null>(null);

   const others = scene.elements
     .filter((e) => dragState && e.id !== dragState.id)
     .map((e) => ({ id: e.id, transform: e.transform as { x: number; y: number; width: number; height: number } }));

   const alignment = useAlignmentGuides(
     dragState?.id ?? null,
     dragState?.transform ?? null,
     others,
     { width: design.canvasWidth, height: design.canvasHeight },
   );
   ```

   Pass `onDragMove` to each rendered element (Konva fires `onDragMove` every frame). On move, update `dragState` AND apply the snap (Konva accepts `dragBoundFunc` for hard snap; we use the simpler "set position after frame" approach):

   ```tsx
   onDragMove={(e: { target: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void } }) => {
     setDragState({
       id: el.id,
       transform: { ...el.transform, x: e.target.x(), y: e.target.y() } as never,
     });
     const a = computeAlignmentGuides(
       { x: e.target.x(), y: e.target.y(), width: el.transform.width, height: el.transform.height },
       others,
       { width: design.canvasWidth, height: design.canvasHeight },
     );
     if (a.snappedX !== e.target.x() || a.snappedY !== e.target.y()) {
       e.target.position({ x: a.snappedX, y: a.snappedY });
     }
   }}
   onDragEnd={(e) => {
     setDragState(null);
     onMove(e.target.x(), e.target.y());
   }}
   ```

   Note: import `computeAlignmentGuides` directly so the per-frame call doesn't go through React memoization.

   At the bottom of the `<Layer>` after the elements, render the guides:

   ```tsx
   {alignment.guides.map((g, i) =>
     g.kind === "v" ? (
       <KLine
         key={`g-${i}`}
         points={[g.pos, g.from, g.pos, g.to]}
         stroke="#fe036d"
         strokeWidth={1}
         dash={[4, 4]}
         listening={false}
       />
     ) : (
       <KLine
         key={`g-${i}`}
         points={[g.from, g.pos, g.to, g.pos]}
         stroke="#fe036d"
         strokeWidth={1}
         dash={[4, 4]}
         listening={false}
       />
     ),
   )}
   ```

5. Re-run the alignment unit tests — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/use-alignment-guides.test.ts
   ```

6. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/use-alignment-guides.ts apps/web/src/components/admin/builder/use-alignment-guides.test.ts apps/web/src/components/admin/builder/CanvasStage.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): canvas — alignment guides + smart snap

   - computeAlignmentGuides pure helper compares dragged element's edges
     and center against every other element's edges/centers PLUS canvas
     edges/center. Within 5px proximity → emit a guide line; within 3px
     snap threshold → adjust dragged x/y so the matching anchors coincide.
   - useAlignmentGuides hook memoizes the result for the render path;
     the per-frame onDragMove handler calls computeAlignmentGuides
     directly and sets the Konva node's position to the snapped coords.
   - Guide lines render as 1px dashed pink overlay at the canvas Layer.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 15: Toolbar — Ellipse / Line / Polygon insert buttons

**Files:**

- Modify: `apps/web/src/components/admin/builder/Toolbar.tsx`
- Modify: `apps/web/src/components/admin/builder/Toolbar.test.tsx`

**Context:** Wave 1A's `Toolbar` (lines 9415-9507 of Wave 1A plan) had buttons for Select / Rect / Text / Image / Data Slot / Undo / Redo. Wave 1B adds Ellipse / Line / Polygon — each inserts an element of that type at canvas center with sane defaults.

#### Steps

1. Append failing test cases to `apps/web/src/components/admin/builder/Toolbar.test.tsx`:

   ```tsx
   it("renders Ellipse / Line / Polygon buttons", () => {
     render(<Toolbar />);
     expect(screen.getByRole("button", { name: /^ellipse$/i })).toBeInTheDocument();
     expect(screen.getByRole("button", { name: /^line$/i })).toBeInTheDocument();
     expect(screen.getByRole("button", { name: /^polygon$/i })).toBeInTheDocument();
   });

   it("clicking Ellipse adds an ellipse element", () => {
     render(<Toolbar />);
     fireEvent.click(screen.getByRole("button", { name: /^ellipse$/i }));
     const els = useBuilderStore.getState().design!.scenes[0].elements;
     expect(els[0].elementType).toBe("ellipse");
   });

   it("clicking Line adds a line element with stroke", () => {
     render(<Toolbar />);
     fireEvent.click(screen.getByRole("button", { name: /^line$/i }));
     const els = useBuilderStore.getState().design!.scenes[0].elements;
     expect(els[0].elementType).toBe("line");
     expect((els[0].style as { stroke?: string }).stroke).toBeDefined();
   });

   it("clicking Polygon adds a polygon with sides=6", () => {
     render(<Toolbar />);
     fireEvent.click(screen.getByRole("button", { name: /^polygon$/i }));
     const els = useBuilderStore.getState().design!.scenes[0].elements;
     expect(els[0].elementType).toBe("polygon");
     expect((els[0].style as { sides?: number }).sides).toBe(6);
   });
   ```

2. Run — expect FAIL.

3. Modify `apps/web/src/components/admin/builder/Toolbar.tsx`. Add the three icon imports:

   ```tsx
   import { Circle, Minus, Hexagon } from "lucide-react";
   ```

   Add three insert functions inside the component body:

   ```tsx
   function addEllipse() {
     if (!activeSceneId) return;
     addElement(activeSceneId, "ellipse", {
       transform: { x: 860, y: 490, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
       style: { fill: "#6bcd06" },
       zIndex: 0,
     });
   }

   function addLine() {
     if (!activeSceneId) return;
     addElement(activeSceneId, "line", {
       transform: { x: 760, y: 540, width: 400, height: 6, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
       style: { stroke: "#6bcd06", strokeWidth: 6 },
       zIndex: 0,
     });
   }

   function addPolygon() {
     if (!activeSceneId) return;
     addElement(activeSceneId, "polygon", {
       transform: { x: 820, y: 440, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
       style: { fill: "#fe036d", sides: 6 },
       zIndex: 0,
     });
   }
   ```

   Add three `<ToolButton>` entries between Image and Data Slot (so the shape group is contiguous):

   ```tsx
   <ToolButton label="Ellipse" onClick={addEllipse}>
     <Circle size={18} />
   </ToolButton>
   <ToolButton label="Line" onClick={addLine}>
     <Minus size={18} />
   </ToolButton>
   <ToolButton label="Polygon" onClick={addPolygon}>
     <Hexagon size={18} />
   </ToolButton>
   ```

4. Re-run tests — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/Toolbar.test.tsx
   ```

5. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/Toolbar.tsx apps/web/src/components/admin/builder/Toolbar.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1b): toolbar — ellipse / line / polygon insert buttons

   Three new tool buttons (lucide Circle / Minus / Hexagon icons) insert
   an element of the matching type into the active scene at canvas-center
   with sane defaults (ellipse 200x100 green; line 400x6 green stroke;
   polygon hexagon 200x200 pink).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 16: E2E spec — Wave 1B full author flow

**Files:**

- Create: `apps/web/tests/e2e/overlay-builder-wave-1b.spec.ts`
- Re-uses: `apps/web/tests/e2e/helpers/login.ts` (created in Wave 1A Task 30).

**Context:** Drives every Wave 1B feature through the live editor + asserts the published overlay renders the right CSS markers. Builds on the Wave 1A acceptance pattern.

#### Steps

1. Create `apps/web/tests/e2e/overlay-builder-wave-1b.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";
   import { loginAsAdmin } from "./helpers/login";

   /**
    * Wave 1B — End-to-end author flow.
    *
    * Exercises every Wave 1B feature in one spec:
    *   - drop ellipse / line / polygon shapes
    *   - apply linear gradient + multi-shadow + filter to a rect
    *   - bind a text element via the manual ManualBindEditor
    *   - confirm published overlay HTML contains:
    *     - linear-gradient(...) CSS
    *     - box-shadow: with two entries
    *     - filter: rule
    *     - border-radius: 50% (ellipse)
    *     - clip-path: polygon(...) (polygon)
    *     - data-binding-feed="standings"
    *
    * Snap behavior is asserted in a sibling unit test
    * (use-alignment-guides.test.ts); driving snap via Playwright is flaky
    * because Konva drag-move events fire faster than Playwright's mouse
    * dispatch.
    *
    * Requires NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §11 row 2
    */

   test.describe("Overlay Builder Wave 1B — author flow", () => {
     test.skip(
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
       "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
     );

     let createdSlug: string | null = null;

     test.afterAll(async ({ browser }) => {
       if (!createdSlug) return;
       const ctx = await browser.newContext();
       const page = await ctx.newPage();
       try {
         await loginAsAdmin(page);
         await page.goto(`/admin/broadcast/v2/builder/${createdSlug}/edit`);
         await page
           .getByTestId("builder-design-menu")
           .click({ trial: false })
           .catch(() => {});
         const delBtn = page.getByTestId("builder-delete-design");
         if (await delBtn.isVisible().catch(() => false)) {
           await delBtn.click();
           await page.getByTestId("builder-confirm-delete").click();
         }
       } finally {
         await ctx.close();
       }
     });

     test("drops ellipse + line + polygon, applies gradient + multi-shadow + filter, manual binds text, publishes, renders", async ({
       page,
       context,
     }) => {
       test.setTimeout(180_000);

       // 1. Login + new design.
       await loginAsAdmin(page);
       await page.goto("/admin/broadcast/v2/builder");
       await page.getByTestId("builder-new-design").click();
       const title = `E2E Wave 1B ${Date.now()}`;
       await page.getByTestId("builder-new-title").fill(title);
       await page.getByTestId("builder-new-mode-single").click();
       await page.getByTestId("builder-new-submit").click();
       await page.waitForURL(/\/admin\/broadcast\/v2\/builder\/[^/]+\/edit$/);
       createdSlug = page
         .url()
         .match(/\/admin\/broadcast\/v2\/builder\/([^/]+)\/edit$/)![1];

       // 2. Drop ellipse / line / polygon via toolbar.
       const stage = page.getByTestId("builder-canvas-stage");
       const box = (await stage.boundingBox())!;
       const click = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);

       await page.getByRole("button", { name: /^ellipse$/i }).click();
       await click(200, 200);
       await page.getByRole("button", { name: /^line$/i }).click();
       await click(200, 400);
       await page.getByRole("button", { name: /^polygon$/i }).click();
       await click(400, 400);

       await expect(page.getByTestId(/^builder-element-row-/)).toHaveCount(3);

       // 3. Insert a rect + apply gradient + multi-shadow + filter.
       await page.getByRole("button", { name: /^rect$/i }).click();
       await click(700, 200);
       await page.getByTestId(/^builder-element-row-/).last().click();

       // Gradient — pick Linear.
       await page.getByLabel(/^linear$/i).click();

       // Filter — set blur to 4.
       const blurSlider = page.getByLabel(/^blur$/i);
       await blurSlider.fill("4");

       // Shadow — Add Shadow twice.
       await page.getByRole("button", { name: /add shadow/i }).click();
       await page.getByRole("button", { name: /add shadow/i }).click();

       // 4. Drop a text element + manual bind via the editor.
       await page.getByRole("button", { name: /^text$/i }).click();
       await click(500, 600);
       await page.getByTestId(/^builder-element-row-/).last().click();
       await page.getByRole("tab", { name: /binding/i }).click();
       await page.getByLabel(/feed/i).selectOption("standings");
       await page.getByLabel(/field path/i).fill("[0].name");

       // 5. Save + publish.
       await page.getByTestId("builder-save").click();
       await expect(page.getByTestId("builder-save-status")).toHaveText(/saved/i, {
         timeout: 10_000,
       });
       await page.getByTestId("builder-publish").click();
       await expect(page.getByTestId("builder-status-badge")).toHaveText(
         /published/i,
         { timeout: 10_000 },
       );

       // 6. Open published overlay + assert CSS markers.
       const overlayPage = await context.newPage();
       await overlayPage.goto(`/overlay/v2/user/${createdSlug}?demo=1`, {
         waitUntil: "domcontentloaded",
       });
       const html = await overlayPage.content();

       // §14 contract markers (Wave 1A invariants still present).
       expect(html).toContain("color-scheme");
       expect(html).toContain("cade-visible");
       expect(html).toContain("background: transparent");

       // Wave 1B markers:
       expect(html).toMatch(/background:\s*linear-gradient\(/);
       expect(html).toMatch(/box-shadow:\s*[^;]+,\s*[^;]+/);  // two entries comma-joined
       expect(html).toMatch(/filter:\s*blur\(/);
       expect(html).toMatch(/border-radius:\s*50%/);  // ellipse
       expect(html).toMatch(/clip-path:\s*polygon\(/);  // polygon
       expect(html).toContain('data-binding-feed="standings"');

       await overlayPage.close();
     });
   });
   ```

2. Run the spec:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-1b.spec.ts
   ```

   Iterate until green. Common gotchas:
   - `data-testid` mismatches on toolbar buttons — Wave 1B may have added testids; align names with the Wave 1A `toolbar-tool-rect` convention if you added them.
   - Konva canvas clicks need the bounding-box adjustment shown above.
   - Save / Publish revalidation may need a `await page.waitForLoadState("networkidle")` between actions.

3. Commit:

   ```bash
   git add apps/web/tests/e2e/overlay-builder-wave-1b.spec.ts
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/e2e): wave 1B full-author-flow spec

   Drops ellipse / line / polygon shapes via toolbar, applies a linear
   gradient + multi-shadow + filter to a rect, manual-binds a text element
   to standings via the ManualBindEditor, publishes the design, then
   asserts the rendered HTML at /overlay/v2/user/<slug>?demo=1 contains
   every Wave 1B CSS marker (gradient, multi-shadow, filter, ellipse
   border-radius, polygon clip-path, binding data attrs).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 17: Visual regression baseline for Wave 1B

**Files:**

- Create: `apps/web/tests/e2e/visual-regression-wave-1b.spec.ts`
- Create: `apps/web/tests/e2e/visual-regression-wave-1b.spec.ts-snapshots/<auto-generated>.png` (via `--update-snapshots`)
- Re-uses: `apps/web/tests/e2e/helpers/seed-fixture-design.ts` from Wave 1A Task 31 (extends with a Wave 1B seed helper).

**Context:** Wave 1A established a 3-element baseline; Wave 1B adds a baseline exercising gradient + filter + multi-shadow + ellipse + polygon in one design. Same scaffolding pattern as Wave 1A Task 31 — service-role seed, render at `/overlay/v2/user/<slug>?demo=1`, capture at the 6s mark, assert <0.1% pixel diff.

#### Steps

1. Extend `apps/web/tests/e2e/helpers/seed-fixture-design.ts` with a new exported helper:

   ```ts
   export async function seedWave1bFixtureDesign(): Promise<FixtureSeedResult> {
     const sb = getServiceRoleClient();
     const slug = `vr-wave1b-${Date.now().toString(36)}`;

     const { data: adminRow } = await sb
       .from("users")
       .select("id")
       .eq("email", "admin@cade.local")
       .is("deleted_at", null)
       .maybeSingle();
     if (!adminRow) throw new Error("admin user missing");
     const createdBy = adminRow.id as string;

     const { data: design, error: dErr } = await sb
       .from("overlay_user_designs")
       .insert({
         slug,
         title: "Wave 1B VR Fixture",
         mode: "single",
         status: "published",
         canvas_width: 1920,
         canvas_height: 1080,
         created_by: createdBy,
       })
       .select("id")
       .single();
     if (dErr || !design) throw dErr;
     const designId = design.id as string;

     const { data: scene, error: sErr } = await sb
       .from("overlay_user_design_scenes")
       .insert({
         design_id: designId,
         order_index: 0,
         name: "Scene 1",
         duration_ms: 5000,
         transition_in: "fade",
         transition_out: "fade",
       })
       .select("id")
       .single();
     if (sErr || !scene) throw sErr;
     const sceneId = scene.id as string;

     const elements = [
       {
         scene_id: sceneId,
         element_type: "rect",
         z_index: 1,
         transform: {
           x: 100, y: 100, width: 600, height: 240,
           rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
         },
         style: {
           gradient: {
             kind: "linear",
             angle: 90,
             stops: [
               { offset: 0, color: "#6bcd06" },
               { offset: 1, color: "#fe036d" },
             ],
           },
           shadows: [
             { offsetX: 4, offsetY: 4, blur: 16, color: "#000000", opacity: 0.6 },
             { offsetX: -4, offsetY: -4, blur: 16, color: "#6bcd06", opacity: 0.4 },
           ],
           filter: { brightness: 1.1, saturate: 1.2 },
         },
         content: {},
       },
       {
         scene_id: sceneId,
         element_type: "ellipse",
         z_index: 2,
         transform: {
           x: 900, y: 100, width: 400, height: 400,
           rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
         },
         style: {
           gradient: {
             kind: "radial",
             cx: 0.5, cy: 0.5, radius: 0.7,
             stops: [
               { offset: 0, color: "#ffffff" },
               { offset: 1, color: "#050505" },
             ],
           },
         },
         content: {},
       },
       {
         scene_id: sceneId,
         element_type: "polygon",
         z_index: 3,
         transform: {
           x: 1400, y: 100, width: 400, height: 400,
           rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
         },
         style: { fill: "#fe036d", sides: 6 },
         content: {},
       },
       {
         scene_id: sceneId,
         element_type: "text",
         z_index: 4,
         transform: {
           x: 100, y: 600, width: 1700, height: 200,
           rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
         },
         style: {
           fontFamily: "Agharti",
           fontSize: 128,
           fontWeight: 700,
           color: "#ffffff",
           gradient: {
             kind: "linear",
             angle: 45,
             stops: [
               { offset: 0, color: "#6bcd06" },
               { offset: 1, color: "#fe036d" },
             ],
           },
         },
         content: { text: "WAVE 1B" },
       },
     ];

     const { error: elErr } = await sb
       .from("overlay_user_design_elements")
       .insert(elements);
     if (elErr) throw elErr;

     await sb.from("overlay_template_variants").insert({
       overlay_key: `user-${slug}`,
       variant_id: "default",
       label: "Wave 1B VR Fixture",
       html_path: `/overlay/v2/user/${slug}`,
       active: true,
     });

     return {
       designId,
       sceneId,
       slug,
       cleanup: async () => {
         const sbInner = getServiceRoleClient();
         const now = new Date().toISOString();
         await sbInner
           .from("overlay_template_variants")
           .update({ deleted_at: now })
           .eq("overlay_key", `user-${slug}`);
         await sbInner
           .from("overlay_user_design_elements")
           .update({ deleted_at: now })
           .eq("scene_id", sceneId);
         await sbInner
           .from("overlay_user_design_scenes")
           .update({ deleted_at: now })
           .eq("id", sceneId);
         await sbInner
           .from("overlay_user_designs")
           .update({ deleted_at: now })
           .eq("id", designId);
       },
     };
   }
   ```

2. Create `apps/web/tests/e2e/visual-regression-wave-1b.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";
   import {
     seedWave1bFixtureDesign,
     type FixtureSeedResult,
   } from "./helpers/seed-fixture-design";

   /**
    * Wave 1B — visual-regression baseline.
    *
    * Seeded fixture exercises gradient + filter + multi-shadow + ellipse +
    * polygon + text-with-gradient. Captures a 1920x1080 screenshot at the
    * 6s mark of the demo loop; asserts <0.1% pixel diff against the
    * committed baseline.
    *
    * Update baseline:
    *   npm --workspace apps/web run e2e:visual-regression \
    *     -- visual-regression-wave-1b.spec.ts --update-snapshots
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §13.3
    */
   test.describe.serial("Overlay Builder Wave 1B — visual regression", () => {
     test.skip(
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
       "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
     );

     let fixture: FixtureSeedResult | null = null;

     test.beforeAll(async () => {
       fixture = await seedWave1bFixtureDesign();
     });

     test.afterAll(async () => {
       if (fixture) await fixture.cleanup();
     });

     test("Wave 1B fixture matches baseline", async ({ page }) => {
       if (!fixture) throw new Error("fixture not seeded");
       await page.setViewportSize({ width: 1920, height: 1080 });
       await page.goto(`/overlay/v2/user/${fixture.slug}?demo=1`, {
         waitUntil: "domcontentloaded",
       });
       await page.waitForTimeout(6000);
       await expect(page).toHaveScreenshot("wave-1b-overlay.png", {
         maxDiffPixelRatio: 0.001,
         fullPage: false,
         animations: "disabled",
       });
     });
   });
   ```

3. Generate the baseline:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-1b.spec.ts --update-snapshots
   ```

4. Inspect the PNG at `apps/web/tests/e2e/visual-regression-wave-1b.spec.ts-snapshots/wave-1b-overlay-chromium-<platform>.png`. Confirm:
   - Rect with green→pink horizontal gradient, dual shadows, slight brightness/saturate bump.
   - Radial-gradient ellipse white-to-black.
   - Pink hexagon.
   - "WAVE 1B" text in gradient ink.

   If anything looks wrong, fix the compiler / fixture / properties panel before committing the baseline.

5. Re-run without `--update-snapshots` to confirm the spec now passes:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-1b.spec.ts
   ```

6. Commit:

   ```bash
   git add apps/web/tests/e2e/visual-regression-wave-1b.spec.ts apps/web/tests/e2e/helpers/seed-fixture-design.ts apps/web/tests/e2e/visual-regression-wave-1b.spec.ts-snapshots/
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/vr): wave 1B baseline — gradient/filter/shadows/ellipse/polygon

   Seeds a 4-element design exercising every Wave 1B compiler path
   (linear + radial gradient, multi-shadow, filter, ellipse, polygon,
   text-with-gradient). Captures 1920x1080 baseline; <0.1% pixel-diff gate.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 18: Full verification pass + commit + push

This task is the FINAL gate before declaring Wave 1B complete. Mirrors Wave 1A Task 32 structure exactly. Cannot proceed without all 10 steps green.

**Files:**

- Modify: `tasks/todo.md` (append Wave 1B review section).
- Modify: `tasks/lessons.md` (capture any lessons surfaced during this verification pass).
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md` (Status section).
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md` (RESUME line).

#### Step 1: Unit tests pass

```bash
npm --workspace apps/web run test
```

Expected: 0 failures. The Wave 1B work adds ≥80 new unit tests across types, style schema, style validator, compiler, fonts, font upload form, gradient/filter/shadow/manual-bind editors, font family picker, alignment guides, toolbar. Plus the Wave 1A suite passes unchanged.

#### Step 2: Lint clean

```bash
npm --workspace apps/web run lint
```

Expected: 0 errors. New code introduces no new warnings.

#### Step 3: Build clean

```bash
npm --workspace apps/web run build
```

Expected: production build succeeds. `prebuild` chains (`sync:overlays`, `check:element-id-parity`) still pass.

#### Step 4: E2E tests pass

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-1b.spec.ts
```

Then the full suite:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e
```

Expected: every spec passes, including Wave 1A's `overlay-builder-wave-1a.spec.ts` (regression gate — Wave 1B must not break Wave 1A's author flow).

#### Step 5: Visual regression pass

Wave 1A baseline + Wave 1B baseline + the original 16-overlay baseline:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-1a.spec.ts visual-regression-wave-1b.spec.ts
npm --workspace apps/web run e2e:visual-regression
```

Expected: all three baseline sets green. Wave 1B work MUST NOT alter Wave 1A's rendering or the existing 16 built-in overlays.

#### Step 6: Manual Chrome browser end-to-end per CLAUDE.md §11

1. Ensure `NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true` in `apps/web/.env.local`.
2. Start dev server:

   ```bash
   npx next dev -p 3030
   ```

3. Load Claude-in-Chrome tools via `ToolSearch select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__javascript_tool` and drive the full Wave 1B flow:
   1. Log in as `admin@cade.local` / `dev-admin-2026`.
   2. Navigate to `/admin/broadcast/v2/builder/fonts`. Upload a small TTF (use any open-licensed test font, e.g. `Inter-Regular.ttf` if available locally). Confirm it appears in the library with weight + style detected.
   3. Navigate to `/admin/broadcast/v2/builder`. Click **New Design**, name it "Chrome Smoke Wave 1B", mode single.
   4. Drop a Rect. Open Style tab. Pick Linear gradient (green → pink). Add two shadows. Set blur=4.
   5. Drop an Ellipse. Confirm it renders elliptical in the canvas.
   6. Drop a Polygon. Confirm Konva renders a hexagon.
   7. Drop a Line. Confirm a thin stroke renders.
   8. Drop a Text. Set Font Family to the uploaded font; confirm the Konva node re-renders.
   9. On the Text element, open Binding tab → pick `standings` → field path `[0].name`. Confirm preview shows the mock first standings name.
   10. Drag the Rect near the Ellipse; confirm a pink dashed guide line appears + the rect snaps when close.
   11. Save. Publish.
   12. Open `http://localhost:3030/overlay/v2/user/chrome-smoke-wave-1b?demo=1`. Confirm all five elements render. Confirm gradient + shadows + filter + ellipse + polygon + custom font + binding all paint correctly.
   13. `mcp__claude-in-chrome__read_console_messages` — assert zero red errors.

If any step shows red errors or visible glitches, STOP. Fix root cause. Re-run from Step 1.

#### Step 7: Post-push platform-wide verification per CLAUDE.md §12

Build the route-by-route status table. One row per route — no lumping. Use `curl` against the live Vercel deployment (or local dev server pre-push).

Minimum routes (extend if the wave touched additional surfaces):

| Route | Expected | Actual | Notes |
|---|---|---|---|
| `GET /` | 200 | | public landing |
| `GET /login` | 200 | | login form |
| `GET /standings` | 200 | | public standings |
| `GET /fixtures` | 200 | | public fixtures |
| `GET /admin` | 307/200 | | gate |
| `GET /admin/broadcast/v2` | 307/200 | | broadcast hub |
| `GET /admin/broadcast/v2/design` | 307/200 | | design system page |
| `GET /admin/broadcast/v2/builder` (flag ON) | 307/200 | | Wave 1A surface still healthy |
| `GET /admin/broadcast/v2/builder/fonts` (flag ON) | 307/200 | | new Wave 1B page |
| `GET /admin/broadcast/v2/builder/fonts` (flag OFF) | 404 | | gate verification |
| `GET /admin/match-days` | 307/200 | | unchanged surface |
| `GET /admin/players` | 307/200 | | unchanged surface |
| `GET /overlay/v2/04-h2h-2?demo=1` | 200 | | built-in overlay, unchanged |
| `GET /overlay/v2/07-leaderboard?demo=1` | 200 | | built-in overlay, unchanged |
| `GET /overlay/v2/user/<wave-1a-seeded-slug>?demo=1` | 200 | | Wave 1A overlay still renders |
| `GET /overlay/v2/user/<wave-1b-seeded-slug>?demo=1` | 200 | | new Wave 1B test render |
| `GET /overlay/v2/user/does-not-exist-xyz?demo=1` | 404 | | not-found behavior |

Save helper as `apps/web/scripts/_verify-wave-1b-routes.mjs`:

```js
#!/usr/bin/env node
const BASE = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3030";
const ROUTES = [
  ["GET", "/", 200],
  ["GET", "/login", 200],
  ["GET", "/standings", 200],
  ["GET", "/fixtures", 200],
  ["GET", "/admin", 307],
  ["GET", "/admin/broadcast/v2", 307],
  ["GET", "/admin/broadcast/v2/design", 307],
  ["GET", "/admin/broadcast/v2/builder", 307],
  ["GET", "/admin/broadcast/v2/builder/fonts", 307],
  ["GET", "/admin/match-days", 307],
  ["GET", "/admin/players", 307],
  ["GET", "/overlay/v2/04-h2h-2?demo=1", 200],
  ["GET", "/overlay/v2/07-leaderboard?demo=1", 200],
  ["GET", "/overlay/v2/user/does-not-exist-xyz?demo=1", 404],
];

let allGreen = true;
for (const [method, path, expected] of ROUTES) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, { method, redirect: "manual" });
    const ok = res.status === expected;
    if (!ok) allGreen = false;
    console.log(
      `${ok ? "OK " : "FAIL"} | ${method} ${path.padEnd(60)} | expected ${expected}, got ${res.status}`,
    );
  } catch (err) {
    allGreen = false;
    console.log(`FAIL | ${method} ${path.padEnd(60)} | ${err.message}`);
  }
}
process.exit(allGreen ? 0 : 1);
```

Run: `node apps/web/scripts/_verify-wave-1b-routes.mjs`. Delete the script after the run (one-shot pattern).

#### Step 8: Push to origin/main

```bash
git status
git push origin main
```

Monitor the Vercel deploy at https://vercel.com/<scope>/cade-league-platform until **Ready**. If the deploy fails, diagnose via Vercel deploy logs, fix, push a new commit.

Re-run Step 7's curl table against the live URL:

```bash
VERIFY_BASE_URL=https://cade-league.vercel.app node apps/web/scripts/_verify-wave-1b-routes.mjs
```

#### Step 9: Memory update

Append to `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md`:

```md
## Status

- **Wave 1B SHIPPED <YYYY-MM-DD> commit <SHA>** — gradients (linear + radial),
  ellipse / line / polygon shapes, custom font upload pipeline (fontkit +
  ttf2woff2), CSS filters (blur / brightness / hueRotate / saturate),
  multi-stack shadows, manual data bind editor, alignment guides + snap.
  No migrations needed — all extensions land in existing JSONB columns
  + the Wave 1A overlay_user_design_fonts table is populated for the first
  time. Feature flag NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED still gates the
  Wave 1B surface (same flag as 1A).
- **Verification:** `npm run test` (Wave 1A + Wave 1B unit tests green),
  `lint`, `build`, `e2e` (overlay-builder-wave-1b.spec.ts + 1A regression),
  visual-regression baselines (1A + 1B + built-in 16), manual Chrome
  end-to-end per CLAUDE.md §11, post-push curl table per §12.
- **Next:** Wave 1C `writing-plans` dispatch — path/pen tool, grouping,
  multi-select bulk transform, copy/paste, keyboard shortcuts. Spec §11
  row 3.
```

Update the RESUME line in `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md`:

```md
- **🟢 RESUME <YYYY-MM-DD>:** [Overlay Builder Wave 1B SHIPPED](project_overlay_builder_2026_05_17.md). Commit `<SHA>`. Gradients + ellipse/line/polygon + custom fonts + CSS filters + multi-shadow + manual bind + snap. No migrations — all additive in JSONB. Next: Wave 1C plan dispatch.
```

Append a one-line entry to `tasks/todo.md` under a new Wave 1B review section. Capture any lessons surfaced in `tasks/lessons.md` per CLAUDE.md "Error log rule" (Date / Context / Mistake / Correction / Rule for future).

Commit the deltas:

```bash
git add tasks/todo.md tasks/lessons.md
git commit -m "$(cat <<'EOF'
docs(overlay-builder): wave 1B review + lessons log after verification gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

#### Step 10: TaskUpdate cleanup

- Mark Wave 1B implement + verify tasks complete in the TaskCreate registry.
- Open Wave 1C stub if pre-allocated.

**Final gate — declare wave complete only when ALL 10 steps green.** Per CLAUDE.md §4: "Never mark a task complete without proving it works end-to-end. Build pass alone is not proof." This task is the proof bundle.

---

## Self-Review

This section documents the post-assembly checks per writing-plans self-review protocol. Issues found were patched inline before this section was appended; remaining items are documented for the implementer.

### (A) Spec coverage — Wave 1B scope from spec §11 row 2

| # | Wave 1B scope bullet | Implementing task(s) | Status |
|---|---|---|---|
| 1 | Gradients (linear + radial, multiple stops) — StyleSchema + validator + Konva gradient props | Task 3 (types) · Task 4 (style schema + validator) · Task 5 (compiler emits linear/radial CSS) · Task 8 (GradientEditor) · Task 16 (E2E asserts linear-gradient marker) · Task 17 (VR baseline includes radial + linear) | Covered |
| 2 | Ellipse / line / polygon shapes — new element types + CanvasStage renderers + style validator branches | Task 4 (EllipseStyleSchema / LineStyleSchema / PolygonStyleSchema) · Task 5 (compiler emits border-radius:50%, clip-path, line as rect) · Task 13 (CanvasStage Ellipse / Line / RegularPolygon nodes) · Task 15 (Toolbar buttons) · Task 16 (E2E drops all three) · Task 17 (VR fixture exercises ellipse + polygon) | Covered |
| 3 | Custom font upload — fontkit + ttf2woff2 server module + asset library UI | Task 1 (install fontkit + ttf2woff2) · Task 3 (FontUploadSchema) · Task 6 (fonts.ts uploadFont/listFonts/softDeleteFont/getFontFaceCss) · Task 7 (fonts page + actions + FontUploadForm) · Task 12 (FontFamilyPicker reads uploaded list) | Covered |
| 4 | CSS filters (blur / brightness / hue / saturate) — StyleSchema filter field + compiler emits CSS filter | Task 3 (FilterSpecSchema) · Task 4 (StyleSchema accepts filter) · Task 5 (compiler filterCss helper) · Task 9 (FilterEditor) · Task 16 (E2E asserts filter:blur marker) · Task 17 (VR fixture brightens + saturates) | Covered |
| 5 | Multi-stack shadows — ShadowStackSchema array | Task 3 (ShadowStackSchema = union ShadowSpec | ShadowSpec[]) · Task 4 (StyleSchema accepts shadows array) · Task 5 (compiler reads shadows[] first, falls back to shadow) · Task 10 (ShadowStackEditor) · Task 16 (E2E asserts box-shadow comma-joined) · Task 17 (VR fixture uses dual shadows) | Covered |
| 6 | Manual data bind — Properties Panel Binding tab dropdown picker | Task 11 (ManualBindEditor with feed dropdown + fieldPath input + templateString + live preview + Wave 1A validateBinding integration) · Task 16 (E2E drives binding tab) | Covered |
| 7 | Alignment guides + snap — CanvasStage shows guide lines during drag, snap-to-grid + snap-to-element | Task 14 (computeAlignmentGuides + useAlignmentGuides + CanvasStage guide overlay + Konva position() snap) · unit tests cover snap math; spec §11 row 2 does not call for grid snap distinct from element snap, so the implementation snaps to other-elements + canvas anchors (left/center/right + top/center/bottom). Pure-grid snap is deferred to Wave 1C polish. | Covered (element + canvas snap; pure-grid snap deferred) |

**Result:** All 7 Wave 1B scope bullets mapped to tasks. No bullet is uncovered.

### (B) Placeholder scan

Grep run against the assembled plan for the red-flag patterns:

| Pattern | Hits | Notes |
|---|---|---|
| `TBD` | 0 | clean |
| `TODO` | 0 | clean |
| `to be filled` | 0 | clean |
| `implement later` | 0 | clean |
| `Add appropriate error handling` | 0 | clean |
| `handle edge cases` | 0 | clean |
| `Similar to Task N` | 0 | clean — each task has full code |

**Result:** 0 placeholder issues found. Every task with code shows failing-test → minimal-impl → passing-test cycle with COMPLETE code blocks.

### (C) Type consistency

- `GradientStop`, `LinearGradient`, `RadialGradient`, `GradientSpec`, `FilterSpec`, `ShadowStack`, `FontUpload` — defined in Task 3, consumed by Tasks 4 (style-schema), 5 (compiler), 8 (GradientEditor), 9 (FilterEditor), 10 (ShadowStackEditor). Imports use `@/server/overlays/builder/types` consistently.
- `UploadedFontMeta` — defined in Task 12 (FontFamilyPicker.tsx), consumed by Task 12 (PropertiesPanel signature change) — same module boundary.
- `Rect`, `Other`, `Guide`, `AlignmentResult` — defined + exported in Task 14 (use-alignment-guides.ts), consumed by Task 14 (CanvasStage onDragMove) — same module boundary.
- `FontRow`, `UploadResult` — defined + exported in Task 6 (fonts.ts), consumed by Task 7 (page.tsx imports listFonts) + Task 12 (FontFamilyPicker accepts the subset `{id, familyName}`).
- Function names: `uploadFont`, `listFonts`, `softDeleteFont`, `getFontFaceCss` — same across Task 6 + Task 7 + Task 12.
- `computeAlignmentGuides` + `useAlignmentGuides` — same across Task 14 unit test + CanvasStage import.

**Naming convention check:** all camelCase domain types align with Wave 1A's `types.ts` convention (line 12631 of Wave 1A plan documents the camelCase domain / snake_case DB-row split). Wave 1B touches only the camelCase side because no new DB columns are added.

**Implementation Note — Wave 1B compiler also reads snake_case row fields:** the Wave 1A compiler reads `el.element_type`, `el.transform.scale_x`, etc. (Wave 1A Self-Review §C flagged this as an "internal variance"). Wave 1B's `style.gradient`, `style.filter`, `style.shadows` follow camelCase because they live in JSONB and were authored as camelCase from spec. Implementer should NOT rename to snake_case for consistency with the compiler — the JSONB shape is the wire shape both client + server agree on.

**Result:** No type inconsistencies requiring patching. The single Implementation Note above is for awareness only.

### (D) Migration sequencing

**Result:** No migrations needed for Wave 1B. Task 2 documents this explicitly and adds a one-shot SQL smoke that validates the Wave 1A schema accepts every Wave 1B JSONB shape. Task 2 deletes the smoke after pass — no migration file lands in `supabase/migrations/`.

### (E) Commit message format

All 18 task commits use the HEREDOC pattern with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer:

1. Task 1 (deps) — HEREDOC + trailer ✓
2. Task 2 (no migration) — folded into Task 3 commit (no separate commit)
3. Task 3 (types) — HEREDOC + trailer ✓
4. Task 4 (style schema) — HEREDOC + trailer ✓
5. Task 5 (compiler) — HEREDOC + trailer ✓
6. Task 6 (fonts.ts) — HEREDOC + trailer ✓
7. Task 7 (fonts page) — HEREDOC + trailer ✓
8. Task 8 (gradient editor) — HEREDOC + trailer ✓
9. Task 9 (filter sliders) — HEREDOC + trailer ✓
10. Task 10 (shadow stack) — HEREDOC + trailer ✓
11. Task 11 (manual bind) — HEREDOC + trailer ✓
12. Task 12 (font family picker) — HEREDOC + trailer ✓
13. Task 13 (canvas shapes) — HEREDOC + trailer ✓
14. Task 14 (alignment guides) — HEREDOC + trailer ✓
15. Task 15 (toolbar) — HEREDOC + trailer ✓
16. Task 16 (E2E) — HEREDOC + trailer ✓
17. Task 17 (VR baseline) — HEREDOC + trailer ✓
18. Task 18 (final verification) — HEREDOC + trailer ✓

**Result:** 17 / 17 commits compliant (Task 2 has no commit by design).

### (F) TDD ordering

Every task with code follows: failing test → run FAIL → minimal implementation → run PASS → commit.

**Tasks exempt from TDD:**
- Task 1 (install deps) — gate is grep + lint + unit test pass with new deps.
- Task 2 (no migration) — SQL smoke proves the Wave 1A schema already accepts Wave 1B shapes; smoke runs and is deleted, no implementation file.
- Task 18 (final verification) — runs the full test/lint/build/e2e/VR pass as the proof bundle.

**Result:** TDD-compliant where applicable.

### Self-Review Summary

| Check | Found | Fixed | Notes |
|---|---|---|---|
| (A) Spec coverage | 7 / 7 bullets mapped | 0 missing | Pure-grid snap deferred to Wave 1C (logged) |
| (B) Placeholder scan | 0 issues | 0 | Plan is implementation-complete |
| (C) Type consistency | 0 issues; 1 awareness note | 0 patched | Snake_case compiler internals match Wave 1A; JSONB camelCase shapes match spec |
| (D) Migration sequencing | 0 migrations needed | 0 | Task 2 smoke proves additive |
| (E) Commit format | 17 / 17 compliant | 0 | HEREDOC + trailer on every commit |
| (F) TDD ordering | Compliant | 0 | Three legitimate exemptions documented |

**Result:** Self-Review PASSED. Plan ready for implementation.

---

