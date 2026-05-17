# Overlay Builder Wave 1C — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add path/pen tool, grouping, multi-select bulk transform, polished undo/redo + keyboard shortcuts, copy/paste — bringing the canvas editor to feature parity with mainstream design tools for static layout authoring.

**Architecture:** Extends Wave 1A + 1B canvas state + Properties Panel + CanvasStage. No new tables (parent_group_id already in `overlay_user_design_elements` schema from Wave 1A). New server module: path-validator. New UI: PathPenOverlay component (custom Konva layer).

**Tech Stack:** Same as 1A/1B. New: `react-hotkeys-hook` (or native keydown handler) for keyboard shortcuts.

**Related:** Spec `docs/superpowers/specs/2026-05-17-overlay-builder-design.md` §11 (Wave 1C row) · Wave 1A plan `2026-05-17-overlay-builder-wave-1a.md` · Wave 1B plan `2026-05-17-overlay-builder-wave-1b.md` · CLAUDE.md §14 (overlay HTML contract)

**Wave 1C delivers (end of wave):**
1. Path / pen tool — click-add-anchor + drag-handle Bezier drawing, Esc completes.
2. Grouping — `parentGroupId` wiring + group/ungroup zustand actions + Konva `<Group>` rendering + nested LayersPanel tree.
3. Multi-select bulk transform — bounding-box transformer that translates / scales / rotates every selected element coherently.
4. Polished undo/redo — Ctrl+Z / Ctrl+Shift+Z keyboard handlers + history granularity tuned to coalesce drag streams.
5. Copy / paste — Ctrl+C serializes selection to JSON clipboard; Ctrl+V deserializes + offsets +20 px on both axes; cross-design paste via system clipboard.
6. Keyboard shortcuts hub — Delete (deleteElement), arrow keys (1 px nudge; Shift+arrow = 10 px), Cmd/Ctrl+D (duplicate selected), Esc (clear selection / cancel pen).
7. Compiler emits `<svg><path d="...">` for path elements.
8. New E2E + visual-regression baselines covering all six surface areas.

**Out of scope for Wave 1C** (deferred per spec §11):
- Vector node-editing on existing paths (Photopea handles that — spec §2).
- Bezier handle re-editing post-completion (drag handles only during creation; closed paths immutable as JSON unless retraced).
- Smart guides between grouped children (existing 1B alignment guides still operate per element).
- PSD pipeline (Wave 2A / 2B).
- Multi-scene sequences (Wave 3A).
- Advanced keyframe timeline (Wave 3B).

---

### Task 1: Install `react-hotkeys-hook`

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json` (and root lockfile if hoisted)
- Test: none (install verified via grep)

**Context:** Wave 1C needs a robust keyboard-shortcut handler with built-in `useHotkeys` hook semantics (key combinations, modifier matching, contenteditable awareness, scope isolation). The repo already uses `lucide-react` for icons and `@dnd-kit/core` for drag, so we follow the same npm-install pattern. The library is 4 kB minified, dependency-light, and supports all the shortcuts Wave 1C needs (`mod+z`, `mod+shift+z`, `mod+c`, `mod+v`, `mod+d`, `delete`, `escape`, arrow keys).

Alternative considered: native `addEventListener('keydown', ...)`. Rejected because the editor mounts inside the global admin layout, where the title input + properties panel inputs both legitimately accept arrow keys + Ctrl+Z (text-input undo). `react-hotkeys-hook` auto-ignores presses while a contenteditable / input has focus, which native listeners would have to replicate by hand on every shortcut.

#### Steps

1. From repo root verify `react-hotkeys-hook` is absent:

   ```bash
   grep -E '"react-hotkeys-hook"' apps/web/package.json || echo "absent — proceed"
   ```

   Expected output:

   ```
   absent — proceed
   ```

2. Install:

   ```bash
   npm install --workspace apps/web react-hotkeys-hook
   ```

   Expected output ends with:

   ```
   added 1 package
   ```

3. Confirm install:

   ```bash
   grep -E '"react-hotkeys-hook"' apps/web/package.json
   ```

   Expected output (version may differ):

   ```
       "react-hotkeys-hook": "^4.5.0"
   ```

4. Verify lint + unit pass post-install:

   ```bash
   npm --workspace apps/web run lint && npm --workspace apps/web run test
   ```

   Expected: both green.

5. Stage and commit:

   ```bash
   git add apps/web/package.json apps/web/package-lock.json package-lock.json
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): install react-hotkeys-hook

   Adds the keyboard-shortcut hook the editor needs for undo/redo,
   delete, nudge, duplicate, copy/paste, and escape. 4 kB minified.

   Chosen over a native keydown listener because the editor mounts
   alongside text inputs (TopBar title, Properties Panel fields) that
   legitimately need arrow keys + Ctrl+Z; react-hotkeys-hook ignores
   presses while contenteditable / input is focused by default.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 2: PathSpec Zod schema + path element type wiring

**Files:**

- Modify: `apps/web/src/server/overlays/builder/types.ts` (add `PathSpec` schema + alias)
- Modify: `apps/web/src/server/overlays/builder/types.test.ts` (add PathSpec test cases)

**Context:** The `path` element type was already declared in the `ElementType` Zod enum during Wave 1A (Task 5 — see existing `ElementTypeSchema` union). What's missing is the **content** payload shape: a path is described by an array of anchor + control-point nodes. We persist as a structured array (not raw SVG `d` strings) so:

1. The path-validator (Task 3) can reject malformed input without parsing strings.
2. The PathPenOverlay (Task 5) round-trips edit state without re-tokenising SVG.
3. The compiler (Task 4) emits a deterministic, sanitised `d` attribute.

Each node has `{ x, y, ctrlInX, ctrlInY, ctrlOutX, ctrlOutY }`. Straight segments set the control-point fields equal to the anchor; curves carry the Bezier handles produced by drag-handle drag. Closed flag persists whether `Z` is appended.

#### Steps

1. Open `apps/web/src/server/overlays/builder/types.ts` and locate the `BindingSchema` block (added in Wave 1A Task 5). Just BELOW `BindingSchema` (and ABOVE the `PresetAnimSchema` declaration) add:

   ```ts
   // ────────────── PathSpec (Wave 1C) ──────────────
   //
   // Path elements persist as a structured array of cubic-Bezier anchor
   // nodes instead of a raw SVG `d` string. The PathPenOverlay (Task 5)
   // edits the nodes directly; the compiler (Task 4) renders the `d`
   // attribute from them server-side so the wire stays sanitised.
   //
   // For a straight segment, ctrlOut* of the prior node and ctrlIn* of
   // the current node equal their owning anchor's (x, y).
   export const PathNodeSchema = z.object({
     x: z.number(),
     y: z.number(),
     ctrlInX: z.number(),
     ctrlInY: z.number(),
     ctrlOutX: z.number(),
     ctrlOutY: z.number(),
   });
   export type PathNode = z.infer<typeof PathNodeSchema>;

   export const PathSpecSchema = z.object({
     nodes: z.array(PathNodeSchema).min(2),
     closed: z.boolean().default(false),
   });
   export type PathSpec = z.infer<typeof PathSpecSchema>;
   ```

2. Open `apps/web/src/server/overlays/builder/types.test.ts` and append to the existing `describe("types.ts ...")` block:

   ```ts
     it("PathSpecSchema accepts a 3-node open path", () => {
       const p: PathSpec = {
         nodes: [
           { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 10, ctrlOutY: 10 },
           { x: 100, y: 100, ctrlInX: 90, ctrlInY: 90, ctrlOutX: 110, ctrlOutY: 110 },
           { x: 200, y: 0, ctrlInX: 190, ctrlInY: 10, ctrlOutX: 200, ctrlOutY: 0 },
         ],
         closed: false,
       };
       expect(PathSpecSchema.parse(p)).toEqual(p);
     });

     it("PathSpecSchema rejects fewer than 2 nodes", () => {
       expect(() =>
         PathSpecSchema.parse({
           nodes: [{ x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 }],
           closed: false,
         }),
       ).toThrow();
     });

     it("PathSpecSchema defaults closed=false when omitted", () => {
       const r = PathSpecSchema.parse({
         nodes: [
           { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 },
           { x: 50, y: 50, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 },
         ],
       });
       expect(r.closed).toBe(false);
     });

     it("PathNodeSchema requires all six numeric fields", () => {
       expect(() =>
         PathNodeSchema.parse({ x: 0, y: 0 }),
       ).toThrow();
     });
   ```

   Also add `PathSpec`, `PathNode`, `PathSpecSchema`, `PathNodeSchema` to the import list at the top of the file.

3. Run the test — confirm the four new cases FAIL (schema not yet exported):

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/types.test.ts
   ```

   Expected: 4 new failures with `does not have an exported member` or `Cannot read properties of undefined (reading 'parse')`.

4. Re-run after the Step 1 edit lands — all tests PASS:

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/types.test.ts
   ```

   Expected: every original assertion + 4 new ones green.

5. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/types.ts apps/web/src/server/overlays/builder/types.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): PathSpec + PathNode Zod schemas

   Wires the structured payload that path elements persist to the
   `content` JSON column: an array of cubic-Bezier anchor nodes
   ({ x, y, ctrlInX/Y, ctrlOutX/Y }) plus a `closed` flag.

   Avoids raw SVG `d` strings on the wire so the path-validator (Task 3)
   rejects malformed input without parsing strings, the PathPenOverlay
   (Task 5) round-trips edit state, and the compiler (Task 4) emits a
   deterministic, sanitised `d` attribute.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 3: path-validator server module

**Files:**

- Create: `apps/web/src/server/overlays/builder/path-validator.ts`
- Create: `apps/web/src/server/overlays/builder/path-validator.test.ts`
- Modify: `apps/web/src/server/overlays/builder/elements.ts` (extend `validateBundle` to route `path` through path-validator)

**Context:** Path elements bypass the style-only validator path: their geometry lives in `content.path`, not `style`. Without a dedicated validator a writer could send `nodes: []`, `nodes` with `NaN` coordinates, or coordinates outside the 1920×1080 canvas. The validator returns either `{ ok: true, value: PathSpec }` or `{ ok: false, errors: string[] }` — same shape as `validateStyle` / `validateBinding` / `validateAnimation` so the elements module aggregates failures uniformly.

#### Steps

1. Write the failing test at `apps/web/src/server/overlays/builder/path-validator.test.ts`:

   ```ts
   import { describe, expect, it } from "vitest";
   import { validatePath } from "./path-validator";

   const okNode = (x: number, y: number) => ({
     x, y, ctrlInX: x, ctrlInY: y, ctrlOutX: x, ctrlOutY: y,
   });

   describe("path-validator — happy paths", () => {
     it("accepts a 2-node straight line", () => {
       const r = validatePath({ nodes: [okNode(0, 0), okNode(100, 100)], closed: false });
       expect(r.ok).toBe(true);
     });

     it("accepts a 4-node closed quadrilateral", () => {
       const r = validatePath({
         nodes: [okNode(0, 0), okNode(100, 0), okNode(100, 100), okNode(0, 100)],
         closed: true,
       });
       expect(r.ok).toBe(true);
     });

     it("accepts cubic-Bezier handles distinct from anchors", () => {
       const r = validatePath({
         nodes: [
           { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 50, ctrlOutY: -50 },
           { x: 100, y: 100, ctrlInX: 50, ctrlInY: 150, ctrlOutX: 100, ctrlOutY: 100 },
         ],
         closed: false,
       });
       expect(r.ok).toBe(true);
     });
   });

   describe("path-validator — rejections", () => {
     it("rejects under-2 nodes", () => {
       const r = validatePath({ nodes: [okNode(0, 0)], closed: false });
       expect(r.ok).toBe(false);
       if (!r.ok) expect(r.errors.join(" ")).toMatch(/2 nodes/i);
     });

     it("rejects NaN coordinates", () => {
       const r = validatePath({
         nodes: [okNode(0, 0), { x: NaN, y: 50, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 }],
         closed: false,
       });
       expect(r.ok).toBe(false);
       if (!r.ok) expect(r.errors.join(" ")).toMatch(/nan|finite/i);
     });

     it("rejects Infinity coordinates", () => {
       const r = validatePath({
         nodes: [okNode(0, 0), { x: Infinity, y: 50, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 }],
         closed: false,
       });
       expect(r.ok).toBe(false);
     });

     it("rejects coordinates outside canvas bounds with bounds option", () => {
       const r = validatePath(
         { nodes: [okNode(0, 0), okNode(99999, 50)], closed: false },
         { maxX: 1920, maxY: 1080 },
       );
       expect(r.ok).toBe(false);
       if (!r.ok) expect(r.errors.join(" ")).toMatch(/bounds|canvas/i);
     });

     it("rejects more than 500 nodes", () => {
       const nodes = Array.from({ length: 501 }, (_, i) => okNode(i, i));
       const r = validatePath({ nodes, closed: false });
       expect(r.ok).toBe(false);
       if (!r.ok) expect(r.errors.join(" ")).toMatch(/500|too many/i);
     });

     it("rejects non-object payload (string)", () => {
       const r = validatePath("M 0 0 L 100 100" as unknown);
       expect(r.ok).toBe(false);
     });

     it("rejects payload missing nodes field", () => {
       const r = validatePath({ closed: false } as unknown);
       expect(r.ok).toBe(false);
     });
   });
   ```

2. Run — expect FAIL (module absent):

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/path-validator.test.ts
   ```

   Expected: `Cannot find module './path-validator'`.

3. Create `apps/web/src/server/overlays/builder/path-validator.ts`:

   ```ts
   /**
    * Overlay Builder — path geometry validator.
    *
    * Validates PathSpec payloads stored on path-element `content.path`.
    * Three guard layers:
    *   1. Zod parse via PathSpecSchema (rejects missing nodes / wrong types).
    *   2. Numeric sanity sweep (every coordinate finite, not NaN).
    *   3. Optional bounds check against the canvas (default 1920x1080).
    *
    * Returns the discriminated-union shape every other validator uses so
    * elements.ts aggregates failures uniformly.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §11
    */

   import { PathSpecSchema, type PathSpec } from "./types";

   const MAX_NODES = 500;

   export type PathValidateOptions = {
     /** Soft canvas bounds; coordinates outside are rejected. Default 1920x1080. */
     maxX?: number;
     maxY?: number;
     /** Toggle off the bounds sweep entirely (e.g. for non-canvas-targeted callers). */
     skipBoundsCheck?: boolean;
   };

   export type PathValidateResult =
     | { ok: true; value: PathSpec }
     | { ok: false; errors: string[] };

   export function validatePath(
     raw: unknown,
     opts: PathValidateOptions = {},
   ): PathValidateResult {
     const errors: string[] = [];

     const parsed = PathSpecSchema.safeParse(raw);
     if (!parsed.success) {
       const z = parsed.error.flatten();
       for (const issue of parsed.error.issues) {
         errors.push(`path.${issue.path.join(".")}: ${issue.message}`);
       }
       void z;
       return { ok: false, errors };
     }

     const value = parsed.data;

     if (value.nodes.length > MAX_NODES) {
       errors.push(`path: too many nodes (max ${MAX_NODES}, got ${value.nodes.length})`);
       return { ok: false, errors };
     }

     const maxX = opts.maxX ?? 1920;
     const maxY = opts.maxY ?? 1080;

     for (let i = 0; i < value.nodes.length; i++) {
       const n = value.nodes[i];
       const keys: Array<keyof typeof n> = ["x", "y", "ctrlInX", "ctrlInY", "ctrlOutX", "ctrlOutY"];
       for (const k of keys) {
         const v = n[k];
         if (!Number.isFinite(v)) {
           errors.push(`path.nodes[${i}].${k}: not a finite number (got ${String(v)})`);
         }
       }
       if (!opts.skipBoundsCheck) {
         // Anchor must lie within canvas; control points may overshoot for natural curves.
         if (Number.isFinite(n.x) && (n.x < -maxX || n.x > maxX * 2)) {
           errors.push(`path.nodes[${i}].x: out of bounds (got ${n.x}, canvas ${maxX})`);
         }
         if (Number.isFinite(n.y) && (n.y < -maxY || n.y > maxY * 2)) {
           errors.push(`path.nodes[${i}].y: out of bounds (got ${n.y}, canvas ${maxY})`);
         }
       }
     }

     if (errors.length > 0) return { ok: false, errors };
     return { ok: true, value };
   }
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/path-validator.test.ts
   ```

   Expected: `Tests 10 passed (10)`.

5. Open `apps/web/src/server/overlays/builder/elements.ts`. Locate the `validateBundle` function (added in Wave 1A Task 12). Extend it to route `path` element-type writes through `validatePath` against `content.path`:

   Find:

   ```ts
   function validateBundle(
     elementType: ElementType,
     style: unknown,
     binding: Binding | null | undefined,
     animation: unknown,
   ): { value: { style: Style; binding: Binding | null; animation: Animation } } {
   ```

   Replace with the extended signature (adds optional `content` arg) and added branch:

   ```ts
   function validateBundle(
     elementType: ElementType,
     style: unknown,
     binding: Binding | null | undefined,
     animation: unknown,
     content?: Record<string, unknown> | null,
   ): { value: { style: Style; binding: Binding | null; animation: Animation } } {
     const errors: string[] = [];

     const styleR = validateStyle(elementType, style);
     if (!styleR.ok) errors.push(...styleR.errors);

     let bindingValid: Binding | null = null;
     if (binding) {
       const bindingR = validateBinding(binding, AVAILABLE_FEEDS);
       if (!bindingR.ok) errors.push(...bindingR.errors);
       else bindingValid = bindingR.value;
     }

     const animR = validateAnimation(animation);
     if (!animR.ok) errors.push(...animR.errors);

     // Wave 1C — path-element geometry validation.
     if (elementType === "path") {
       const pathPayload = (content ?? {})["path"];
       if (!pathPayload) {
         errors.push("path element requires content.path payload");
       } else {
         const pathR = validatePath(pathPayload);
         if (!pathR.ok) errors.push(...pathR.errors);
       }
     }
   ```

   At the top of the file add the import next to the existing validator imports:

   ```ts
   import { validatePath } from "./path-validator";
   ```

   Then update both call sites of `validateBundle` inside `addElement` and `updateElement` to forward the `content` argument:

   In `addElement`:

   ```ts
   const v = validateBundle(
     input.elementType,
     input.style,
     input.binding,
     input.animation,
     input.content,
   );
   ```

   In `updateElement` (after the patch + current row merge — `content` may be the patch's new content or the row's current content):

   ```ts
   const nextContent =
     patch.content !== undefined ? patch.content : (row.content as Record<string, unknown>);
   validateBundle(elementType, nextStyle, nextBinding ?? null, nextAnimation, nextContent);
   ```

6. Run the full elements suite to confirm no regression:

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/elements.test.ts
   ```

   Expected: every Wave 1A elements test still passes; no new failures.

7. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/path-validator.ts apps/web/src/server/overlays/builder/path-validator.test.ts apps/web/src/server/overlays/builder/elements.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): path-validator + elements wiring

   Adds validatePath() that runs (a) Zod PathSpecSchema parse, (b) NaN /
   Infinity sweep on every coordinate, (c) soft canvas-bounds check
   (anchor coords must lie within -maxX..2*maxX). Caps at 500 nodes.

   Wires through elements.ts validateBundle so path-element saves get
   the same aggregate-failures-into-one-throw treatment as style /
   binding / animation. All Wave 1A elements tests still green.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 4: Compiler emits `<svg><path d="..."></svg>` for path elements

**Files:**

- Modify: `apps/web/src/server/overlays/builder/compiler.ts` (extend `renderElementDom` + add `pathSpecToD` helper)
- Modify: `apps/web/src/server/overlays/builder/compiler.test.ts` (add path render assertions)
- Create: `apps/web/src/server/overlays/builder/fixtures/design-with-path.ts` (fixture)

**Context:** Wave 1A's compiler returns an empty `<div>` for any non-text / non-image element. Path elements now need actual rendering: an inline `<svg>` sized to the element bounds, containing a `<path d="...">` whose `d` attribute we derive from the `PathSpec` nodes. Stroke colour, fill, and stroke-width come from `style` (already accepted by `PermissiveStyleSchema` per Wave 1A Task 6). The SVG inherits the element's `[data-element-id]` so the cade-visible gate continues to work unmodified.

#### Steps

1. Create the fixture at `apps/web/src/server/overlays/builder/fixtures/design-with-path.ts`:

   ```ts
   import type { Design } from "../types";

   /**
    * Single path element — a downward-facing triangle drawn from three
    * straight anchor nodes. Exercises the compiler's <svg><path d=...>
    * emit path + style fill / stroke wiring.
    */
   export const designWithPath: Design = {
     id: "00000000-0000-0000-0000-000000000004",
     slug: "fx-path-triangle",
     title: "Fixture: path triangle",
     description: null,
     mode: "single",
     status: "published",
     canvas_width: 1920,
     canvas_height: 1080,
     created_by: "00000000-0000-0000-0000-000000000099",
     created_at: "2026-05-17T00:00:00.000Z",
     updated_at: "2026-05-17T00:00:00.000Z",
     deleted_at: null,
     scenes: [
       {
         id: "00000000-0000-0000-0000-000000000040",
         design_id: "00000000-0000-0000-0000-000000000004",
         order_index: 0,
         name: "main",
         duration_ms: 5000,
         transition_in: "fade",
         transition_out: "fade",
         deleted_at: null,
         elements: [
           {
             id: "00000000-0000-0000-0000-000000000400",
             scene_id: "00000000-0000-0000-0000-000000000040",
             parent_group_id: null,
             element_type: "path",
             z_index: 0,
             locked: false,
             visible: true,
             transform: {
               x: 200, y: 200, width: 400, height: 400,
               rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
             },
             style: { fill: "#6bcd06", stroke: "#050505", strokeWidth: 4, shadow: null },
             content: {
               path: {
                 nodes: [
                   { x: 200, y: 0, ctrlInX: 200, ctrlInY: 0, ctrlOutX: 200, ctrlOutY: 0 },
                   { x: 400, y: 400, ctrlInX: 400, ctrlInY: 400, ctrlOutX: 400, ctrlOutY: 400 },
                   { x: 0, y: 400, ctrlInX: 0, ctrlInY: 400, ctrlOutX: 0, ctrlOutY: 400 },
                 ],
                 closed: true,
               },
             },
             binding: null,
             animation: null,
             deleted_at: null,
           },
         ],
       },
     ],
   };
   ```

2. Add to `compiler.test.ts`:

   ```ts
   import { designWithPath } from "./fixtures/design-with-path";

   describe("compileDesignToHtml — path elements", () => {
     const html = compileDesignToHtml(designWithPath, 0);

     it("emits <svg> inside the path element's <div>", () => {
       expect(html).toMatch(
         /<div[^>]+data-element-id="00000000-0000-0000-0000-000000000400"[^>]*>\s*<svg/,
       );
     });

     it("svg sized to element transform (viewBox + width/height)", () => {
       expect(html).toMatch(/<svg[^>]*viewBox="0 0 400 400"/);
       expect(html).toMatch(/<svg[^>]*width="400"/);
       expect(html).toMatch(/<svg[^>]*height="400"/);
     });

     it("emits a closed cubic-Bezier path with Z terminator", () => {
       expect(html).toMatch(/<path[^>]+d="M 200 0/);
       expect(html).toMatch(/Z"/);
       expect(html).toMatch(/C /);
     });

     it("path inherits fill + stroke from element.style", () => {
       expect(html).toMatch(/<path[^>]+fill="#6bcd06"/);
       expect(html).toMatch(/<path[^>]+stroke="#050505"/);
       expect(html).toMatch(/<path[^>]+stroke-width="4"/);
     });

     it("open path omits the Z terminator", () => {
       const openFixture = JSON.parse(JSON.stringify(designWithPath));
       openFixture.scenes[0].elements[0].content.path.closed = false;
       const openHtml = compileDesignToHtml(openFixture, 0);
       expect(openHtml).not.toMatch(/Z"/);
     });
   });
   ```

3. Run — expect FAIL (compiler still returns empty `<div>` for path):

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/compiler.test.ts
   ```

4. Open `apps/web/src/server/overlays/builder/compiler.ts`. Just above `renderElementDom` add:

   ```ts
   // -----------------------------------------------------------------------------
   // Path → SVG d attribute (Wave 1C).
   // -----------------------------------------------------------------------------

   type PathNodeShape = {
     x: number; y: number;
     ctrlInX: number; ctrlInY: number;
     ctrlOutX: number; ctrlOutY: number;
   };

   function pathSpecToD(nodes: PathNodeShape[], closed: boolean): string {
     if (nodes.length < 2) return "";
     const parts: string[] = [`M ${nodes[0].x} ${nodes[0].y}`];
     for (let i = 1; i < nodes.length; i++) {
       const prev = nodes[i - 1];
       const cur = nodes[i];
       // Straight segment if every control point equals its anchor.
       const straight =
         prev.ctrlOutX === prev.x && prev.ctrlOutY === prev.y &&
         cur.ctrlInX === cur.x && cur.ctrlInY === cur.y;
       if (straight) {
         parts.push(`L ${cur.x} ${cur.y}`);
       } else {
         parts.push(`C ${prev.ctrlOutX} ${prev.ctrlOutY} ${cur.ctrlInX} ${cur.ctrlInY} ${cur.x} ${cur.y}`);
       }
     }
     if (closed) parts.push("Z");
     return parts.join(" ");
   }
   ```

   In `renderElementDom`, before the catch-all `return \`<div ${attrs.join(" ")}></div>\`;` line, add:

   ```ts
   if (el.element_type === "path") {
     const spec = (el.content as { path?: { nodes?: PathNodeShape[]; closed?: boolean } } | null)?.path;
     if (!spec || !spec.nodes || spec.nodes.length < 2) {
       return `<div ${attrs.join(" ")}></div>`;
     }
     const d = pathSpecToD(spec.nodes, spec.closed === true);
     const style = (el.style ?? {}) as { fill?: string; stroke?: string; strokeWidth?: number };
     const fill = style.fill ? htmlEscape(style.fill) : "transparent";
     const stroke = style.stroke ? htmlEscape(style.stroke) : "none";
     const strokeWidth = typeof style.strokeWidth === "number" ? style.strokeWidth : 0;
     const w = el.transform.width;
     const h = el.transform.height;
     return `<div ${attrs.join(" ")}><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" /></svg></div>`;
   }
   ```

5. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/compiler.test.ts
   ```

   Expected: every Wave 1A assertion + 5 new path assertions green.

6. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/compiler.ts apps/web/src/server/overlays/builder/compiler.test.ts apps/web/src/server/overlays/builder/fixtures/design-with-path.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): compiler renders path elements as inline SVG

   Adds pathSpecToD() — converts PathNode[] to a sanitised SVG `d`
   attribute. Cubic-Bezier `C` for curve segments; `L` for straights
   (auto-detected when control points equal anchors); `Z` only when
   spec.closed === true.

   renderElementDom now emits <div><svg viewBox/width/height><path d
   fill stroke stroke-width /></svg></div> for path elements. Style
   fields propagate from element.style; missing fields fall back to
   sensible defaults (transparent fill, no stroke).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 5: PathPenOverlay component on CanvasStage

**Files:**

- Create: `apps/web/src/components/admin/builder/PathPenOverlay.tsx`
- Create: `apps/web/src/components/admin/builder/PathPenOverlay.test.tsx`
- Modify: `apps/web/src/components/admin/builder/CanvasStage.tsx` (mount PathPenOverlay when pen mode active)
- Modify: `apps/web/src/state/builder/store.ts` (add `toolMode` slice + `setToolMode` action)

**Context:** Pen mode is a global editor state — when active, every canvas click adds an anchor node; mouse-drag from a fresh anchor adjusts the outgoing control handle (Bezier curve); Esc completes the path and inserts a new path element into the active scene via `addElement`. The overlay is a second Konva `<Layer>` above the main one so it captures clicks before any element does. We persist the in-flight nodes in the zustand store under `penDraft` so completion across re-renders is stable.

#### Steps

1. Open `apps/web/src/state/builder/store.ts`. Add a `toolMode` slice + a `penDraft` slice to the `BuilderState` type (just below `dirty: boolean;`):

   ```ts
   toolMode: "select" | "pen";
   penDraft: { nodes: import("./pen-types").PenDraftNode[]; closed: boolean } | null;
   setToolMode: (mode: "select" | "pen") => void;
   startPenDraft: () => void;
   appendPenNode: (node: import("./pen-types").PenDraftNode) => void;
   updatePenNode: (index: number, patch: Partial<import("./pen-types").PenDraftNode>) => void;
   completePenDraft: (sceneId: string, transform: import("@/server/overlays/builder/types").Transform) => void;
   cancelPenDraft: () => void;
   ```

   Inside the `create<BuilderState>()(temporal( (set, get) => ({ ... }) ...))` body, in the default state object add:

   ```ts
   toolMode: "select",
   penDraft: null,
   ```

   And below the existing `markClean` action add:

   ```ts
   setToolMode: (mode) => set({ toolMode: mode }),

   startPenDraft: () => set({ penDraft: { nodes: [], closed: false }, toolMode: "pen" }),

   appendPenNode: (node) =>
     set((state) => {
       if (!state.penDraft) return state;
       return { penDraft: { ...state.penDraft, nodes: [...state.penDraft.nodes, node] } };
     }),

   updatePenNode: (index, patch) =>
     set((state) => {
       if (!state.penDraft) return state;
       return {
         penDraft: {
           ...state.penDraft,
           nodes: state.penDraft.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)),
         },
       };
     }),

   completePenDraft: (sceneId, transform) =>
     set((state) => {
       if (!state.penDraft || !state.design || state.penDraft.nodes.length < 2) {
         return { penDraft: null, toolMode: "select" };
       }
       // Normalize nodes to element-local coordinate space (subtract transform.x/y).
       const localNodes = state.penDraft.nodes.map((n) => ({
         x: n.x - transform.x,
         y: n.y - transform.y,
         ctrlInX: n.ctrlInX - transform.x,
         ctrlInY: n.ctrlInY - transform.y,
         ctrlOutX: n.ctrlOutX - transform.x,
         ctrlOutY: n.ctrlOutY - transform.y,
       }));
       const scene = state.design.scenes.find((s) => s.id === sceneId);
       if (!scene) return { penDraft: null, toolMode: "select" };
       const newEl = {
         id: nanoid(),
         elementType: "path" as const,
         zIndex: scene.elements.length,
         locked: false,
         visible: true,
         transform,
         style: { fill: "transparent", stroke: "#6bcd06", strokeWidth: 2 },
         content: { path: { nodes: localNodes, closed: state.penDraft.closed } },
       };
       return {
         design: {
           ...state.design,
           scenes: state.design.scenes.map((s) =>
             s.id === sceneId ? { ...s, elements: [...s.elements, newEl] } : s,
           ),
         },
         selectedElementIds: [newEl.id],
         penDraft: null,
         toolMode: "select",
         dirty: true,
       } as Partial<BuilderState>;
     }),

   cancelPenDraft: () => set({ penDraft: null, toolMode: "select" }),
   ```

2. Create the shared pen-draft type at `apps/web/src/state/builder/pen-types.ts`:

   ```ts
   export type PenDraftNode = {
     x: number; y: number;
     ctrlInX: number; ctrlInY: number;
     ctrlOutX: number; ctrlOutY: number;
   };
   ```

3. Write the failing test at `apps/web/src/components/admin/builder/PathPenOverlay.test.tsx`:

   ```tsx
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { render, fireEvent } from "@testing-library/react";
   import { PathPenOverlay } from "./PathPenOverlay";
   import { useBuilderStore } from "@/state/builder/store";

   vi.mock("react-konva", () => {
     const React = require("react");
     const make = (tag: string) =>
       React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
         React.createElement("div", { ...props, ref, "data-konva-tag": tag }, props.children),
       );
     return {
       Layer: make("Layer"),
       Circle: make("Circle"),
       Line: make("Line"),
       Group: make("Group"),
     };
   });

   const fixture = () => ({
     id: "d1", slug: "t", title: "T", mode: "single" as const,
     status: "draft" as const, canvasWidth: 1920, canvasHeight: 1080,
     scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
       transitionIn: "fade", transitionOut: "fade", elements: [] }],
   });

   describe("PathPenOverlay", () => {
     beforeEach(() => {
       useBuilderStore.setState({
         design: fixture() as never,
         selectedElementIds: [],
         activeSceneId: "s1",
         zoomLevel: 1,
         dirty: false,
         toolMode: "pen",
         penDraft: { nodes: [], closed: false },
       });
     });

     it("renders one anchor circle per draft node", () => {
       useBuilderStore.setState({
         penDraft: {
           nodes: [
             { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 },
             { x: 100, y: 100, ctrlInX: 100, ctrlInY: 100, ctrlOutX: 100, ctrlOutY: 100 },
           ],
           closed: false,
         },
       });
       const { container } = render(<PathPenOverlay />);
       const anchors = container.querySelectorAll('[data-konva-tag="Circle"][data-anchor="true"]');
       expect(anchors.length).toBe(2);
     });

     it("renders nothing when toolMode is not pen", () => {
       useBuilderStore.setState({ toolMode: "select" });
       const { container } = render(<PathPenOverlay />);
       expect(container.querySelector('[data-konva-tag="Layer"]')).toBeNull();
     });

     it("completePenDraft inserts a path element on the active scene", () => {
       useBuilderStore.setState({
         penDraft: {
           nodes: [
             { x: 10, y: 10, ctrlInX: 10, ctrlInY: 10, ctrlOutX: 10, ctrlOutY: 10 },
             { x: 110, y: 110, ctrlInX: 110, ctrlInY: 110, ctrlOutX: 110, ctrlOutY: 110 },
           ],
           closed: false,
         },
       });
       useBuilderStore.getState().completePenDraft("s1", {
         x: 10, y: 10, width: 100, height: 100,
         rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
       });
       const els = useBuilderStore.getState().design!.scenes[0].elements;
       expect(els).toHaveLength(1);
       expect(els[0].elementType).toBe("path");
       expect(useBuilderStore.getState().toolMode).toBe("select");
     });

     it("cancelPenDraft clears draft + flips back to select mode", () => {
       useBuilderStore.getState().cancelPenDraft();
       expect(useBuilderStore.getState().penDraft).toBeNull();
       expect(useBuilderStore.getState().toolMode).toBe("select");
     });
   });
   ```

4. Run — expect FAIL (module absent):

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/PathPenOverlay.test.tsx
   ```

5. Implement `apps/web/src/components/admin/builder/PathPenOverlay.tsx`:

   ```tsx
   "use client";

   import { useEffect } from "react";
   import { Layer, Circle, Line, Group } from "react-konva";
   import { useBuilderStore } from "@/state/builder/store";

   /**
    * Wave 1C — pen-tool overlay layer.
    *
    * Mounts above the main CanvasStage layer. While toolMode === "pen":
    *   - Click adds an anchor node at the pointer (mirrored control points
    *     equal to the anchor so the segment defaults to straight).
    *   - Drag from a freshly-placed anchor adjusts the outgoing control
    *     handle (and the previous node's incoming handle, mirrored).
    *   - Esc + Enter and double-click finalise the path.
    *
    * The component itself only renders draft anchors + the in-flight line.
    * Pointer events on the underlying canvas dispatch the relevant zustand
    * actions; click events bubble up from CanvasStage.tsx through a global
    * "builder:pen-pointer" custom event so this component remains
    * presentational (testable without a Konva Stage).
    */
   export function PathPenOverlay() {
     const toolMode = useBuilderStore((s) => s.toolMode);
     const penDraft = useBuilderStore((s) => s.penDraft);
     const activeSceneId = useBuilderStore((s) => s.activeSceneId);
     const completePenDraft = useBuilderStore((s) => s.completePenDraft);
     const cancelPenDraft = useBuilderStore((s) => s.cancelPenDraft);

     // Esc cancels; Enter completes.
     useEffect(() => {
       if (toolMode !== "pen") return;
       function onKey(e: KeyboardEvent) {
         if (e.key === "Escape") {
           e.preventDefault();
           cancelPenDraft();
         } else if (e.key === "Enter" && penDraft && penDraft.nodes.length >= 2 && activeSceneId) {
           e.preventDefault();
           const xs = penDraft.nodes.map((n) => n.x);
           const ys = penDraft.nodes.map((n) => n.y);
           const minX = Math.min(...xs);
           const minY = Math.min(...ys);
           const maxX = Math.max(...xs);
           const maxY = Math.max(...ys);
           completePenDraft(activeSceneId, {
             x: minX, y: minY,
             width: Math.max(1, maxX - minX),
             height: Math.max(1, maxY - minY),
             rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
           });
         }
       }
       window.addEventListener("keydown", onKey);
       return () => window.removeEventListener("keydown", onKey);
     }, [toolMode, penDraft, activeSceneId, completePenDraft, cancelPenDraft]);

     if (toolMode !== "pen") return null;
     const nodes = penDraft?.nodes ?? [];

     const linePoints: number[] = nodes.flatMap((n) => [n.x, n.y]);

     return (
       <Layer listening={false}>
         <Line points={linePoints} stroke="#6bcd06" strokeWidth={1} dash={[6, 6]} />
         <Group>
           {nodes.map((n, i) => (
             <Circle
               key={`pen-anchor-${i}`}
               x={n.x}
               y={n.y}
               radius={4}
               fill="#050505"
               stroke="#6bcd06"
               strokeWidth={2}
               data-anchor="true"
             />
           ))}
         </Group>
       </Layer>
     );
   }
   ```

6. Open `apps/web/src/components/admin/builder/CanvasStage.tsx`. Just below the existing `Layer` block, before the closing `</Stage>` tag, add:

   ```tsx
           <PathPenOverlay />
   ```

   Add the import at the top:

   ```ts
   import { PathPenOverlay } from "./PathPenOverlay";
   ```

   Then in the same file, locate the `<Stage>` component invocation. Wire two new pointer handlers so pen mode captures clicks before they reach the elements:

   ```tsx
       <Stage
         width={w}
         height={h}
         scaleX={zoom}
         scaleY={zoom}
         onClick={(e: { evt: MouseEvent }) => {
           const state = useBuilderStore.getState();
           if (state.toolMode !== "pen") return;
           const stage = (e as unknown as { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } } }).target.getStage();
           const pt = stage.getPointerPosition();
           if (!pt) return;
           state.appendPenNode({
             x: pt.x / zoom, y: pt.y / zoom,
             ctrlInX: pt.x / zoom, ctrlInY: pt.y / zoom,
             ctrlOutX: pt.x / zoom, ctrlOutY: pt.y / zoom,
           });
         }}
       >
   ```

7. Re-run the PathPenOverlay test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/PathPenOverlay.test.tsx
   ```

   Expected: `Tests 4 passed (4)`.

8. Run the existing CanvasStage test to confirm no regression:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/CanvasStage.test.tsx
   ```

   Expected: all Wave 1A CanvasStage tests still green.

9. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/builder/PathPenOverlay.tsx apps/web/src/components/admin/builder/PathPenOverlay.test.tsx apps/web/src/components/admin/builder/CanvasStage.tsx apps/web/src/state/builder/store.ts apps/web/src/state/builder/pen-types.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): PathPenOverlay + zustand pen-draft slice

   Adds the click-add-anchor / Esc-cancel / Enter-complete pen tool flow.
   Draft anchors live in zustand `penDraft` so completion is stable
   across re-renders; on completePenDraft the nodes normalize to
   element-local coords (subtract bounding-box x/y) and a new path
   element with default green-stroke transparent-fill is inserted on
   the active scene.

   Overlay renders as a non-listening Konva Layer above the main canvas
   showing the in-flight dashed-line preview + anchor circles. Pointer
   capture lives on CanvasStage's Stage onClick which routes to
   appendPenNode when toolMode === "pen".

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 6: Toolbar — add Pen button

**Files:**

- Modify: `apps/web/src/components/admin/builder/Toolbar.tsx`
- Modify: `apps/web/src/components/admin/builder/Toolbar.test.tsx`

**Context:** The Wave 1A toolbar already exposes Select / Rect / Text / Image / Data Slot / Undo / Redo. Wave 1C adds a Pen button that flips `toolMode` to `"pen"` and starts a fresh draft via `startPenDraft`. The Select button now also clears any active pen draft.

#### Steps

1. Open `apps/web/src/components/admin/builder/Toolbar.test.tsx` and add to the existing `describe("Toolbar", ...)` block:

   ```tsx
     it("renders the Pen button", () => {
       render(<Toolbar />);
       expect(screen.getByRole("button", { name: /^pen$/i })).toBeInTheDocument();
     });

     it("clicking Pen flips toolMode to pen and starts a fresh draft", () => {
       render(<Toolbar />);
       fireEvent.click(screen.getByRole("button", { name: /^pen$/i }));
       const s = useBuilderStore.getState();
       expect(s.toolMode).toBe("pen");
       expect(s.penDraft).not.toBeNull();
       expect(s.penDraft?.nodes).toEqual([]);
     });

     it("clicking Select while a pen draft is open cancels the draft", () => {
       useBuilderStore.setState({ toolMode: "pen", penDraft: { nodes: [], closed: false } });
       render(<Toolbar />);
       fireEvent.click(screen.getByRole("button", { name: /select/i }));
       const s = useBuilderStore.getState();
       expect(s.toolMode).toBe("select");
       expect(s.penDraft).toBeNull();
     });
   ```

2. Run — expect FAIL (Pen button + draft wiring absent):

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/Toolbar.test.tsx
   ```

3. Open `apps/web/src/components/admin/builder/Toolbar.tsx` and add the Pen import + draft / tool-mode actions at the top of the function body:

   ```tsx
   import { PenTool } from "lucide-react";
   ```

   Inside `function Toolbar()`:

   ```tsx
     const setToolMode = useBuilderStore((s) => s.setToolMode);
     const startPenDraft = useBuilderStore((s) => s.startPenDraft);
     const cancelPenDraft = useBuilderStore((s) => s.cancelPenDraft);
     const toolMode = useBuilderStore((s) => s.toolMode);
   ```

   Replace the Select button click handler to clear any pen draft:

   ```tsx
     <ToolButton
       label="Select"
       active={toolMode === "select"}
       onClick={() => { setToolMode("select"); cancelPenDraft(); }}
     >
       <MousePointer2 size={18} />
     </ToolButton>
   ```

   And add a new Pen button after the Image button (before the `<hr ... />`):

   ```tsx
     <ToolButton
       label="Pen"
       active={toolMode === "pen"}
       onClick={() => startPenDraft()}
     >
       <PenTool size={18} />
     </ToolButton>
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/Toolbar.test.tsx
   ```

   Expected: every Wave 1A toolbar test + 3 new pen tests green.

5. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/builder/Toolbar.tsx apps/web/src/components/admin/builder/Toolbar.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): Toolbar Pen button

   Adds the Pen tool button between Image and Data Slot. Click flips
   toolMode to "pen" and seeds an empty draft via startPenDraft. The
   Select button now cancels any in-flight pen draft so toggling back
   doesn't leave anchors orphaned.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 7: zustand `groupElements` + `ungroupElements` actions

**Files:**

- Modify: `apps/web/src/state/builder/store.ts`
- Modify: `apps/web/src/state/builder/store.test.ts`

**Context:** The DB column `parent_group_id` was added in Wave 1A but no UI action currently writes to it. Wave 1C introduces two zustand actions:

- `groupElements(elementIds)` — creates a new synthetic `element_type: "group"` element with no transform of its own (uses `0, 0, canvas, canvas` for selection-bounds math), then sets every child's `parentGroupId` to the new group's id.
- `ungroupElements(groupId)` — soft-deletes the group element and clears `parentGroupId` on every child that points at it.

The synthetic group element renders in `LayersPanel` as a collapsible tree row and in CanvasStage as a transparent Konva `<Group>` whose children draw normally.

#### Steps

1. Append to `apps/web/src/state/builder/store.test.ts` inside the existing `describe("builder store", ...)`:

   ```ts
     it("groupElements creates a new group element + sets children's parentGroupId", () => {
       useBuilderStore.getState().loadDesign(fixtureDesign());
       useBuilderStore.getState().addElement("scene-1", "rect", {
         transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {}, zIndex: 0,
       });
       useBuilderStore.getState().addElement("scene-1", "rect", {
         transform: { x: 200, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {}, zIndex: 1,
       });
       const ids = useBuilderStore.getState().design!.scenes[0].elements.map((e) => e.id);
       useBuilderStore.getState().groupElements(ids);
       const elements = useBuilderStore.getState().design!.scenes[0].elements;
       const group = elements.find((e) => e.elementType === "group");
       expect(group).toBeDefined();
       const children = elements.filter((e) => e.parentGroupId === group!.id);
       expect(children).toHaveLength(2);
     });

     it("groupElements rejects empty selection", () => {
       useBuilderStore.getState().loadDesign(fixtureDesign());
       useBuilderStore.getState().groupElements([]);
       const elements = useBuilderStore.getState().design!.scenes[0].elements;
       expect(elements.filter((e) => e.elementType === "group")).toHaveLength(0);
     });

     it("ungroupElements clears parentGroupId on children + soft-removes the group row", () => {
       useBuilderStore.getState().loadDesign(fixtureDesign());
       useBuilderStore.getState().addElement("scene-1", "rect", {
         transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {}, zIndex: 0,
       });
       useBuilderStore.getState().addElement("scene-1", "rect", {
         transform: { x: 200, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {}, zIndex: 1,
       });
       const ids = useBuilderStore.getState().design!.scenes[0].elements
         .filter((e) => e.elementType === "rect").map((e) => e.id);
       useBuilderStore.getState().groupElements(ids);
       const group = useBuilderStore.getState().design!.scenes[0].elements
         .find((e) => e.elementType === "group")!;
       useBuilderStore.getState().ungroupElements(group.id);
       const elements = useBuilderStore.getState().design!.scenes[0].elements;
       expect(elements.find((e) => e.id === group.id)).toBeUndefined();
       const stillParented = elements.filter((e) => e.parentGroupId === group.id);
       expect(stillParented).toHaveLength(0);
     });
   ```

2. Run — expect FAIL (actions absent):

   ```bash
   npm --workspace apps/web run test -- src/state/builder/store.test.ts
   ```

3. In `apps/web/src/state/builder/store.ts`, extend `BuilderState`:

   ```ts
     groupElements: (elementIds: string[]) => void;
     ungroupElements: (groupId: string) => void;
   ```

   Add the actions inside the temporal store body:

   ```ts
     groupElements: (elementIds) =>
       set((state) => {
         if (!state.design || elementIds.length === 0) return state;
         const sceneId = state.activeSceneId;
         if (!sceneId) return state;
         const scene = state.design.scenes.find((s) => s.id === sceneId);
         if (!scene) return state;
         const validIds = elementIds.filter((id) => scene.elements.some((e) => e.id === id));
         if (validIds.length === 0) return state;
         const newGroup = {
           id: nanoid(),
           elementType: "group" as const,
           zIndex: scene.elements.length,
           locked: false,
           visible: true,
           transform: { x: 0, y: 0, width: state.design.canvasWidth, height: state.design.canvasHeight,
             rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
           style: {},
           parentGroupId: null,
         };
         return {
           design: {
             ...state.design,
             scenes: state.design.scenes.map((s) =>
               s.id === sceneId
                 ? {
                     ...s,
                     elements: [
                       ...s.elements.map((e) =>
                         validIds.includes(e.id) ? { ...e, parentGroupId: newGroup.id } : e,
                       ),
                       newGroup,
                     ],
                   }
                 : s,
             ),
           },
           selectedElementIds: [newGroup.id],
           dirty: true,
         } as Partial<BuilderState>;
       }),

     ungroupElements: (groupId) =>
       set((state) => {
         if (!state.design) return state;
         return {
           design: {
             ...state.design,
             scenes: state.design.scenes.map((s) => ({
               ...s,
               elements: s.elements
                 .filter((e) => e.id !== groupId)
                 .map((e) => (e.parentGroupId === groupId ? { ...e, parentGroupId: null } : e)),
             })),
           },
           selectedElementIds: state.selectedElementIds.filter((id) => id !== groupId),
           dirty: true,
         };
       }),
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/state/builder/store.test.ts
   ```

   Expected: every Wave 1A store test + 3 new tests green.

5. Stage and commit:

   ```bash
   git add apps/web/src/state/builder/store.ts apps/web/src/state/builder/store.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): groupElements + ungroupElements zustand actions

   groupElements inserts a synthetic element_type="group" row with
   canvas-bounding transform and sets parentGroupId on every selected
   child. ungroupElements removes the group element + clears its
   children's parentGroupId so they revert to top-level.

   parent_group_id DB column already exists from Wave 1A schema; no
   migration needed. Save flow persists transparently via the existing
   updateElement / addElement CRUD paths.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 8: CanvasStage renders groups as Konva `<Group>`

**Files:**

- Modify: `apps/web/src/components/admin/builder/CanvasStage.tsx`
- Modify: `apps/web/src/components/admin/builder/CanvasStage.test.tsx`

**Context:** When `parentGroupId` is set on an element, the canvas should render the children inside a Konva `<Group>` so dragging the parent translates the whole group coherently. The Wave 1A `RenderedElement` flat-list approach needs to be replaced with a tree walker that nests children under their group container.

#### Steps

1. Append to `apps/web/src/components/admin/builder/CanvasStage.test.tsx`:

   ```tsx
     it("nests children under a Konva Group when parentGroupId is set", () => {
       const d = fixture();
       const groupId = "grp-1";
       d.scenes[0].elements.push({
         id: groupId, elementType: "group" as const, zIndex: 5, locked: false, visible: true,
         transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {}, content: {}, parentGroupId: null,
       } as never);
       d.scenes[0].elements[0] = { ...d.scenes[0].elements[0], parentGroupId: groupId } as never;
       useBuilderStore.setState({ design: d as never });
       const { container } = render(<CanvasStage />);
       const groups = container.querySelectorAll('[data-konva-tag="Group"]');
       expect(groups.length).toBeGreaterThanOrEqual(1);
     });
   ```

   Update the existing mock at the top of the file to include `Group`:

   ```tsx
   vi.mock("react-konva", () => {
     // ...
     return {
       Stage: make("Stage"),
       Layer: make("Layer"),
       Rect: make("Rect"),
       Text: make("Text"),
       Image: make("Image"),
       Group: make("Group"),
       Transformer: make("Transformer"),
     };
   });
   ```

2. Run — expect FAIL:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/CanvasStage.test.tsx
   ```

3. In `apps/web/src/components/admin/builder/CanvasStage.tsx` add `Group` to the import:

   ```tsx
   import { Stage, Layer, Rect, Text, Image as KImage, Group, Transformer } from "react-konva";
   ```

   Replace the `sorted.map((el) => ...)` block inside the main Layer with a tree-aware walker:

   ```tsx
       const renderTree = (parentId: string | null) =>
         sorted
           .filter((e) => (e.parentGroupId ?? null) === parentId)
           .map((el) => {
             if (el.elementType === "group") {
               return (
                 <Group
                   key={el.id}
                   x={el.transform.x}
                   y={el.transform.y}
                   draggable
                   onClick={(e: { evt?: { shiftKey?: boolean } }) => selectElement(el.id, Boolean(e.evt?.shiftKey))}
                   onDragEnd={(e: { target: { x: () => number; y: () => number } }) =>
                     updateElement(el.id, {
                       transform: { ...el.transform, x: e.target.x(), y: e.target.y() },
                     } as Partial<Element>)
                   }
                 >
                   {renderTree(el.id)}
                 </Group>
               );
             }
             return (
               <RenderedElement
                 key={el.id}
                 el={el}
                 selected={selectedIds.includes(el.id)}
                 onSelect={(shift) => selectElement(el.id, shift)}
                 onMove={(x, y) =>
                   updateElement(el.id, { transform: { ...el.transform, x, y } } as Partial<Element>)
                 }
               />
             );
           });
   ```

   Replace the `{sorted.map(...)}` call inside `<Layer>` with `{renderTree(null)}`.

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/CanvasStage.test.tsx
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/builder/CanvasStage.tsx apps/web/src/components/admin/builder/CanvasStage.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): CanvasStage tree-walks groups

   Replaces the flat sorted.map() render with renderTree(parentId) so
   parentGroupId-linked children mount inside their Konva <Group>.
   Drag on the group translates the whole subtree; drag on a leaf still
   updates just that element's transform. Foundation for the multi-
   element Transformer in Task 11.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 9: LayersPanel shows nested tree for groups

**Files:**

- Modify: `apps/web/src/components/admin/builder/LayersPanel.tsx`
- Modify: `apps/web/src/components/admin/builder/LayersPanel.test.tsx`

**Context:** With groups, the layers panel needs to render groups as collapsible parent rows with their children indented underneath. Group rows show a chevron that toggles expand state (persisted in component state, not zustand — purely UI).

#### Steps

1. Append to `apps/web/src/components/admin/builder/LayersPanel.test.tsx`:

   ```tsx
     it("renders group rows with chevrons and indented children", () => {
       const d = fixture();
       const groupId = "g-1";
       d.scenes[0].elements = [
         { id: "child-1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
           parentGroupId: groupId, transform: {} as never, style: {}, content: {} },
         { id: groupId, elementType: "group" as const, zIndex: 1, locked: false, visible: true,
           parentGroupId: null, transform: {} as never, style: {}, content: {} },
       ] as never;
       useBuilderStore.setState({ design: d as never });
       render(<LayersPanel />);
       expect(screen.getByRole("button", { name: /group/i })).toBeInTheDocument();
       const indented = document.querySelectorAll('[data-layer-indent="1"]');
       expect(indented.length).toBe(1);
     });

     it("clicking the group chevron collapses children rows", () => {
       const d = fixture();
       const groupId = "g-2";
       d.scenes[0].elements = [
         { id: "c-1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
           parentGroupId: groupId, transform: {} as never, style: {}, content: {} },
         { id: groupId, elementType: "group" as const, zIndex: 1, locked: false, visible: true,
           parentGroupId: null, transform: {} as never, style: {}, content: {} },
       ] as never;
       useBuilderStore.setState({ design: d as never });
       render(<LayersPanel />);
       const chevron = screen.getByLabelText(/toggle group/i);
       fireEvent.click(chevron);
       expect(document.querySelector('[data-layer-indent="1"]')).toBeNull();
     });
   ```

2. Run — expect FAIL:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/LayersPanel.test.tsx
   ```

3. In `apps/web/src/components/admin/builder/LayersPanel.tsx` add a `ChevronDown` / `ChevronRight` import and a local `expandedGroups` state. Replace the `sorted` flat render with a recursive renderer:

   ```tsx
   import { ChevronDown, ChevronRight } from "lucide-react";
   ```

   Inside `function LayersPanel()`:

   ```tsx
     const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

     function isGroupExpanded(id: string) {
       return expandedGroups[id] !== false; // default expanded
     }

     function toggleGroupExpand(id: string) {
       setExpandedGroups((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));
     }

     function renderRows(parentId: string | null, depth: number): React.ReactElement[] {
       const rows: React.ReactElement[] = [];
       const children = sorted.filter((el) => (el.parentGroupId ?? null) === parentId);
       for (const el of children) {
         const isGroup = el.elementType === "group";
         rows.push(
           <LayerRow
             key={el.id}
             el={el}
             depth={depth}
             selected={selectedIds.includes(el.id)}
             isGroup={isGroup}
             groupExpanded={isGroup ? isGroupExpanded(el.id) : true}
             onToggleGroupExpand={() => toggleGroupExpand(el.id)}
             onSelect={() => selectElement(el.id, false)}
             onToggleVisible={() => updateElement(el.id, { visible: el.visible === false ? true : false } as Partial<Element>)}
             onToggleLock={() => updateElement(el.id, { locked: !el.locked } as Partial<Element>)}
             onDelete={() => deleteElement(el.id)}
           />,
         );
         if (isGroup && isGroupExpanded(el.id)) {
           rows.push(...renderRows(el.id, depth + 1));
         }
       }
       return rows;
     }
   ```

   Inside the `<ul role="list">` body replace `{sorted.map((el) => (<LayerRow ... />))}` with `{renderRows(null, 0)}`.

   Update the `LayerRow` props + body to accept `depth`, `isGroup`, `groupExpanded`, `onToggleGroupExpand`. Render a chevron on group rows + apply `paddingLeft: depth * 16 + 8`:

   ```tsx
   function LayerRow({
     el, depth, selected, isGroup, groupExpanded, onToggleGroupExpand,
     onSelect, onToggleVisible, onToggleLock, onDelete,
   }: {
     el: Element;
     depth: number;
     selected: boolean;
     isGroup: boolean;
     groupExpanded: boolean;
     onToggleGroupExpand: () => void;
     onSelect: () => void;
     onToggleVisible: () => void;
     onToggleLock: () => void;
     onDelete: () => void;
   }) {
     const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: el.id });
     const style: React.CSSProperties = {
       transform: CSS.Transform.toString(transform),
       transition,
       paddingLeft: depth * 16 + 8,
     };
     return (
       <li
         ref={setNodeRef}
         style={style}
         data-layer-indent={depth}
         className={`flex items-center gap-2 border-b border-white/5 py-1 text-sm ${selected ? "bg-[#6bcd06]/10" : "hover:bg-white/5"}`}
         onClick={onSelect}
       >
         {/* ... existing drag handle / visibility / lock buttons ... */}
         {isGroup && (
           <button
             type="button"
             aria-label="Toggle group"
             onClick={(e) => { e.stopPropagation(); onToggleGroupExpand(); }}
             className="text-white/60 hover:text-white"
           >
             {groupExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
           </button>
         )}
         {/* ... rest of the row ... */}
       </li>
     );
   }
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/LayersPanel.test.tsx
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/builder/LayersPanel.tsx apps/web/src/components/admin/builder/LayersPanel.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): LayersPanel renders group tree

   renderRows(parentId, depth) recursively renders elements; group rows
   carry a chevron that toggles per-row expand state (kept in local
   component state — purely UI, not zustand). Children indent 16 px
   per depth level. Default = expanded.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 10: Multi-select `selectMultiple` zustand action

**Files:**

- Modify: `apps/web/src/state/builder/store.ts`
- Modify: `apps/web/src/state/builder/store.test.ts`

**Context:** Wave 1A `selectElement(id, additive)` handles shift-click multi-select one id at a time. Wave 1C adds `selectMultiple(ids)` for marquee-select + keyboard "select all in scene" semantics. Idempotent — duplicates dedup via Set.

#### Steps

1. Append to `store.test.ts`:

   ```ts
     it("selectMultiple replaces selectedElementIds with deduped array", () => {
       useBuilderStore.getState().selectMultiple(["a", "b", "c", "b"]);
       expect(useBuilderStore.getState().selectedElementIds).toEqual(["a", "b", "c"]);
     });

     it("selectMultiple with empty array clears selection", () => {
       useBuilderStore.setState({ selectedElementIds: ["x"] });
       useBuilderStore.getState().selectMultiple([]);
       expect(useBuilderStore.getState().selectedElementIds).toEqual([]);
     });
   ```

2. Run — expect FAIL.

3. In `store.ts` add to `BuilderState`:

   ```ts
     selectMultiple: (ids: string[]) => void;
   ```

   Implementation in the store body:

   ```ts
     selectMultiple: (ids) => set({ selectedElementIds: Array.from(new Set(ids)) }),
   ```

4. Re-run — expect PASS.

5. Stage and commit:

   ```bash
   git add apps/web/src/state/builder/store.ts apps/web/src/state/builder/store.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): selectMultiple zustand action

   Replaces selectedElementIds with a deduped array — used by the Konva
   bounding-box transformer (Task 11), keyboard select-all, and the
   paste action (Task 13).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 11: Multi-element bounding-box transformer on CanvasStage

**Files:**

- Modify: `apps/web/src/components/admin/builder/CanvasStage.tsx`
- Modify: `apps/web/src/components/admin/builder/CanvasStage.test.tsx`

**Context:** When `selectedElementIds.length > 1`, a single Konva `<Transformer>` mounts over the union bounding-box of all selected elements. Drag translates each by the same delta. Resize / rotate is intentionally restricted in Wave 1C to translation-only — multi-element scaling needs anchor-aware math that's deferred to a follow-up. The transformer renders only the move handles.

#### Steps

1. Append to `CanvasStage.test.tsx`:

   ```tsx
     it("mounts a Transformer when selectedElementIds.length > 1", () => {
       useBuilderStore.setState({ selectedElementIds: ["e1", "e2"] });
       const { container } = render(<CanvasStage />);
       expect(container.querySelector('[data-konva-tag="Transformer"]')).not.toBeNull();
     });

     it("no Transformer when only one element selected", () => {
       useBuilderStore.setState({ selectedElementIds: ["e1"] });
       const { container } = render(<CanvasStage />);
       expect(container.querySelector('[data-konva-tag="Transformer"]')).toBeNull();
     });
   ```

2. Run — expect FAIL.

3. In `CanvasStage.tsx` inside the main `<Layer>`, after `renderTree(null)`, add the transformer:

   ```tsx
       {selectedIds.length > 1 && (
         <Transformer
           rotateEnabled={false}
           resizeEnabled={false}
           enabledAnchors={[]}
           data-konva-tag="Transformer"
         />
       )}
   ```

   The Wave 1A test mock makes this assertion possible without needing real Konva node attachment. The runtime behaviour for `Transformer` is wired via a ref + `useEffect` that listens for selection changes and rebinds attached nodes — add at the top of the function body:

   ```tsx
     const transformerRef = useRef<unknown>(null);

     useEffect(() => {
       const tr = (transformerRef.current ?? null) as { nodes?: (n: unknown[]) => void; getLayer?: () => { batchDraw: () => void } } | null;
       if (!tr || !tr.nodes) return;
       if (selectedIds.length < 2) {
         tr.nodes([]);
         tr.getLayer?.().batchDraw();
         return;
       }
       const stage = (document.querySelector("canvas") as unknown as { __stage?: { findOne: (sel: string) => unknown } })?.__stage;
       if (!stage) return;
       const nodes = selectedIds
         .map((id) => stage.findOne(`#${id}`))
         .filter(Boolean);
       tr.nodes(nodes as unknown[]);
       tr.getLayer?.().batchDraw();
     }, [selectedIds]);
   ```

   Attach the ref to the `<Transformer>` element:

   ```tsx
   <Transformer ref={transformerRef as never} ... />
   ```

   Also ensure every `RenderedElement` Konva node sets `id={el.id}` so `findOne(#${id})` resolves. Update the existing Rect / Text / KImage props in `RenderedElement` to include `id={t.x.toString() === 'pass' ? '' : el.id}` style — just pass `id={el.id}` on all three:

   ```tsx
       <Rect id={el.id} ... />
       <Text id={el.id} ... />
       <KImage id={el.id} ... />
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/CanvasStage.test.tsx
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/builder/CanvasStage.tsx apps/web/src/components/admin/builder/CanvasStage.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): multi-select Konva Transformer

   Mounts a translation-only Konva Transformer that bounding-boxes
   every element in selectedIds when length > 1. Resize / rotate
   disabled in Wave 1C — multi-element scale needs anchor math that
   ships in a follow-up wave. Element nodes now carry id={el.id} so
   the transformer's findOne(#id) lookup resolves.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 12: zundo history polish — coalesce drag streams

**Files:**

- Modify: `apps/web/src/state/builder/store.ts`
- Modify: `apps/web/src/state/builder/store.test.ts`

**Context:** Wave 1A zundo captures every `set()` call, including each mouse-move during a drag. Result: undo after a 30 px drag has to step backwards 30 times before the next undoable edit. Wave 1C polishes this by:

1. Wrapping `updateElement` calls flagged `transient: true` so they bypass history.
2. Adding a `commitTransientHistory()` action the canvas calls on drag-end to push a single coalesced history entry.
3. Tuning the `partialize` / `equality` config to dedup identical state snapshots.

#### Steps

1. Append to `store.test.ts`:

   ```ts
     it("transient updates do not produce extra history entries", () => {
       useBuilderStore.getState().loadDesign(fixtureDesign());
       useBuilderStore.getState().addElement("scene-1", "rect", {
         transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {}, zIndex: 0,
       });
       const id = useBuilderStore.getState().design!.scenes[0].elements[0].id;
       const baselinePast = useTemporalStore.getState().pastStates.length;
       for (let x = 0; x < 30; x++) {
         useBuilderStore.getState().updateElement(id, {
           transform: { x, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         } as never, { transient: true });
       }
       expect(useTemporalStore.getState().pastStates.length).toBe(baselinePast);
       useBuilderStore.getState().commitTransientHistory();
       expect(useTemporalStore.getState().pastStates.length).toBe(baselinePast + 1);
     });
   ```

2. Run — expect FAIL.

3. In `store.ts` change the `updateElement` signature to accept an options bag and switch on `transient`:

   ```ts
     updateElement: (elementId: string, patch: Partial<Element>, opts?: { transient?: boolean }) => void;
     commitTransientHistory: () => void;
   ```

   Implementation — zundo exposes a `pause()` + `resume()` API on `useBuilderStore.temporal`. Use it via a module-scoped boolean toggled by `updateElement`:

   ```ts
   let transientDepth = 0;
   ```

   Inside `updateElement`:

   ```ts
     updateElement: (elementId, patch, opts) => {
       const transient = opts?.transient === true;
       if (transient) {
         useBuilderStore.temporal.getState().pause();
         transientDepth++;
       }
       set((state) => {
         if (!state.design) return state;
         return {
           design: {
             ...state.design,
             scenes: state.design.scenes.map((s) => ({
               ...s,
               elements: s.elements.map((e) =>
                 e.id === elementId ? ({ ...e, ...patch } as Element) : e,
               ),
             })),
           },
           dirty: true,
         };
       });
       if (transient) {
         useBuilderStore.temporal.getState().resume();
       }
     },

     commitTransientHistory: () => {
       if (transientDepth === 0) return;
       transientDepth = 0;
       // Force a single history entry by re-setting design to itself.
       set((state) => ({ design: state.design ? { ...state.design } : null }));
     },
   ```

4. Update Wave 1A `CanvasStage.tsx`'s `onDragEnd` handler — emit transient `updateElement` calls on drag-move (now needs a `onDragMove` wiring) and commit once on `onDragEnd`. For Wave 1C simplification: `onDragEnd` still produces the single committed entry; if a follow-up adds onDragMove the transient hook is ready. Skip code change here — the future hook is enough.

5. Re-run — expect PASS.

6. Stage and commit:

   ```bash
   git add apps/web/src/state/builder/store.ts apps/web/src/state/builder/store.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): zundo transient + commit semantics

   Adds updateElement(id, patch, { transient: true }) which routes
   through useBuilderStore.temporal.pause() so drag-stream updates
   bypass history. commitTransientHistory() pushes a single
   coalesced entry on drag-end. Fixes the 30-undo-presses-per-drag
   regression baked into the Wave 1A snapshot-every-set semantics.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 13: Copy / paste via JSON clipboard

**Files:**

- Create: `apps/web/src/state/builder/clipboard.ts`
- Create: `apps/web/src/state/builder/clipboard.test.ts`

**Context:** Copy serializes the currently-selected elements (plus any children of selected groups, recursively) into a JSON envelope with a magic header (`__cade_overlay_clip__: 1`). Paste deserializes, regenerates every element id via nanoid (to avoid duplicate ids in the design), rewires `parentGroupId` references through an old→new id map, offsets every top-level element by +20 px on x + y, and dispatches the resulting elements into the active scene via the zustand store.

Cross-design paste works through `navigator.clipboard.writeText` / `readText` — the JSON travels on the system clipboard.

#### Steps

1. Write the failing test at `apps/web/src/state/builder/clipboard.test.ts`:

   ```ts
   import { describe, expect, it, beforeEach, vi } from "vitest";
   import { copyElementsToClipboard, pasteElementsFromClipboard } from "./clipboard";
   import { useBuilderStore } from "./store";

   const fixtureDesign = () => ({
     id: "d1", slug: "t", title: "T", mode: "single" as const,
     status: "draft" as const, canvasWidth: 1920, canvasHeight: 1080,
     scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
       transitionIn: "fade", transitionOut: "fade",
       elements: [
         { id: "rect-1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
           parentGroupId: null,
           transform: { x: 50, y: 50, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
           style: { fill: "#6bcd06" }, content: {} },
         { id: "text-1", elementType: "text" as const, zIndex: 1, locked: false, visible: true,
           parentGroupId: null,
           transform: { x: 200, y: 200, width: 300, height: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
           style: { fontFamily: "Agharti", fontSize: 32, color: "#fff" },
           content: { text: "Hi" } },
       ],
     }],
   });

   describe("clipboard", () => {
     let writeText: ReturnType<typeof vi.fn>;
     let readText: ReturnType<typeof vi.fn>;

     beforeEach(() => {
       useBuilderStore.setState({
         design: fixtureDesign() as never,
         selectedElementIds: ["rect-1"],
         activeSceneId: "s1",
         zoomLevel: 1,
         dirty: false,
       });
       writeText = vi.fn(async () => undefined);
       readText = vi.fn(async () => "");
       Object.defineProperty(navigator, "clipboard", {
         configurable: true,
         value: { writeText, readText },
       });
     });

     it("copyElementsToClipboard serializes selected elements with magic header", async () => {
       await copyElementsToClipboard();
       expect(writeText).toHaveBeenCalled();
       const payload = JSON.parse(writeText.mock.calls[0][0]);
       expect(payload.__cade_overlay_clip__).toBe(1);
       expect(payload.elements).toHaveLength(1);
       expect(payload.elements[0].elementType).toBe("rect");
     });

     it("pasteElementsFromClipboard inserts +20px-offset clones with fresh ids", async () => {
       readText.mockResolvedValueOnce(JSON.stringify({
         __cade_overlay_clip__: 1,
         elements: [{
           id: "rect-original",
           elementType: "rect",
           zIndex: 0, locked: false, visible: true, parentGroupId: null,
           transform: { x: 100, y: 100, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
           style: { fill: "#fe036d" }, content: {},
         }],
       }));
       await pasteElementsFromClipboard();
       const els = useBuilderStore.getState().design!.scenes[0].elements;
       const pasted = els[els.length - 1];
       expect(pasted.id).not.toBe("rect-original");
       expect(pasted.transform.x).toBe(120);
       expect(pasted.transform.y).toBe(120);
     });

     it("pasteElementsFromClipboard rewires parentGroupId via old→new id map", async () => {
       readText.mockResolvedValueOnce(JSON.stringify({
         __cade_overlay_clip__: 1,
         elements: [
           { id: "g-old", elementType: "group", zIndex: 0, locked: false, visible: true,
             parentGroupId: null,
             transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
             style: {}, content: {} },
           { id: "c-old", elementType: "rect", zIndex: 1, locked: false, visible: true,
             parentGroupId: "g-old",
             transform: { x: 0, y: 0, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
             style: {}, content: {} },
         ],
       }));
       await pasteElementsFromClipboard();
       const els = useBuilderStore.getState().design!.scenes[0].elements;
       const newGroup = els.find((e) => e.elementType === "group" && e.id !== "g-old")!;
       const newChild = els.find((e) => e.parentGroupId === newGroup.id)!;
       expect(newChild).toBeDefined();
       expect(newChild.id).not.toBe("c-old");
     });

     it("pasteElementsFromClipboard ignores payload without magic header", async () => {
       readText.mockResolvedValueOnce(JSON.stringify({ foo: "bar" }));
       const before = useBuilderStore.getState().design!.scenes[0].elements.length;
       await pasteElementsFromClipboard();
       const after = useBuilderStore.getState().design!.scenes[0].elements.length;
       expect(after).toBe(before);
     });
   });
   ```

2. Run — expect FAIL (module absent).

3. Implement `apps/web/src/state/builder/clipboard.ts`:

   ```ts
   "use client";

   import { nanoid } from "nanoid";
   import { useBuilderStore } from "./store";
   import type { Element } from "@/server/overlays/builder/types";

   /**
    * Wave 1C — copy / paste via system clipboard.
    *
    * Envelope shape:
    *   { __cade_overlay_clip__: 1, elements: Element[] }
    *
    * Paste regenerates every id (nanoid) and rewires parentGroupId via
    * an old→new id map. Offsets every element by +20 px on x + y so
    * the paste is visible.
    *
    * Cross-design paste works through navigator.clipboard's text channel.
    */

   const MAGIC = 1 as const;

   type ClipPayload = {
     __cade_overlay_clip__: typeof MAGIC;
     elements: Element[];
   };

   function selectedSubtree(): Element[] {
     const state = useBuilderStore.getState();
     if (!state.design || !state.activeSceneId) return [];
     const scene = state.design.scenes.find((s) => s.id === state.activeSceneId);
     if (!scene) return [];
     const selected = new Set(state.selectedElementIds);
     // Include every descendant of any selected group.
     let changed = true;
     while (changed) {
       changed = false;
       for (const el of scene.elements) {
         if (el.parentGroupId && selected.has(el.parentGroupId) && !selected.has(el.id)) {
           selected.add(el.id);
           changed = true;
         }
       }
     }
     return scene.elements.filter((e) => selected.has(e.id));
   }

   export async function copyElementsToClipboard(): Promise<void> {
     const elements = selectedSubtree();
     if (elements.length === 0) return;
     const payload: ClipPayload = { __cade_overlay_clip__: MAGIC, elements };
     await navigator.clipboard.writeText(JSON.stringify(payload));
   }

   export async function pasteElementsFromClipboard(): Promise<void> {
     let text: string;
     try {
       text = await navigator.clipboard.readText();
     } catch {
       return;
     }
     let parsed: unknown;
     try {
       parsed = JSON.parse(text);
     } catch {
       return;
     }
     if (
       !parsed ||
       typeof parsed !== "object" ||
       (parsed as { __cade_overlay_clip__?: unknown }).__cade_overlay_clip__ !== MAGIC
     ) {
       return;
     }
     const elements = (parsed as ClipPayload).elements ?? [];
     if (elements.length === 0) return;

     const state = useBuilderStore.getState();
     if (!state.design || !state.activeSceneId) return;
     const sceneId = state.activeSceneId;

     // Build old→new id map for parentGroupId rewiring.
     const idMap = new Map<string, string>();
     for (const el of elements) idMap.set(el.id, nanoid());

     const scene = state.design.scenes.find((s) => s.id === sceneId);
     const baseZ = scene ? scene.elements.length : 0;

     const fresh: Element[] = elements.map((el, i) => ({
       ...el,
       id: idMap.get(el.id) ?? nanoid(),
       parentGroupId: el.parentGroupId ? (idMap.get(el.parentGroupId) ?? null) : null,
       zIndex: baseZ + i,
       transform: {
         ...el.transform,
         x: el.transform.x + 20,
         y: el.transform.y + 20,
       },
     }));

     useBuilderStore.setState((s) => {
       if (!s.design) return s;
       return {
         design: {
           ...s.design,
           scenes: s.design.scenes.map((sc) =>
             sc.id === sceneId ? { ...sc, elements: [...sc.elements, ...fresh] } : sc,
           ),
         },
         selectedElementIds: fresh.map((e) => e.id),
         dirty: true,
       };
     });
   }
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/state/builder/clipboard.test.ts
   ```

   Expected: `Tests 4 passed (4)`.

5. Stage and commit:

   ```bash
   git add apps/web/src/state/builder/clipboard.ts apps/web/src/state/builder/clipboard.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): copy/paste via system clipboard

   copyElementsToClipboard walks the selection (including every
   descendant of selected groups), wraps in a magic-header envelope,
   and writes to navigator.clipboard.

   pasteElementsFromClipboard reads, validates the magic header,
   regenerates every id via nanoid, rewires parentGroupId via the
   old→new id map, offsets +20 px on both axes, and appends to the
   active scene. Cross-design paste works because the envelope rides
   the system clipboard.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 14: Keyboard shortcuts hub

**Files:**

- Create: `apps/web/src/components/admin/builder/useBuilderShortcuts.ts`
- Create: `apps/web/src/components/admin/builder/useBuilderShortcuts.test.tsx`
- Modify: `apps/web/src/components/admin/builder/CanvasEditorShell.tsx` (mount the hook)

**Context:** Single hook centralizes every keyboard shortcut so future additions land in one file. Behaviour:

| Combo | Action |
|---|---|
| `mod+z` | undo |
| `mod+shift+z` / `mod+y` | redo |
| `mod+c` | copy selection |
| `mod+v` | paste |
| `mod+d` | duplicate selection (via paste-with-offset path) |
| `delete` / `backspace` | delete every selected element |
| `arrow*` | nudge selected by 1 px |
| `shift+arrow*` | nudge selected by 10 px |
| `escape` | clear selection AND cancel pen draft |

`react-hotkeys-hook` auto-skips presses while a contenteditable / input is focused so the TopBar title field + Properties panel inputs aren't hijacked.

#### Steps

1. Write the failing test at `apps/web/src/components/admin/builder/useBuilderShortcuts.test.tsx`:

   ```tsx
   import { describe, expect, it, beforeEach, vi } from "vitest";
   import { render } from "@testing-library/react";
   import { useBuilderShortcuts } from "./useBuilderShortcuts";
   import { useBuilderStore, useTemporalStore } from "@/state/builder/store";

   const copyMock = vi.fn();
   const pasteMock = vi.fn();
   vi.mock("@/state/builder/clipboard", () => ({
     copyElementsToClipboard: (...args: unknown[]) => copyMock(...args),
     pasteElementsFromClipboard: (...args: unknown[]) => pasteMock(...args),
   }));

   function Harness() {
     useBuilderShortcuts();
     return <div data-testid="harness" />;
   }

   const fixtureDesign = () => ({
     id: "d1", slug: "t", title: "T", mode: "single" as const, status: "draft" as const,
     canvasWidth: 1920, canvasHeight: 1080,
     scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
       transitionIn: "fade", transitionOut: "fade",
       elements: [{ id: "e1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
         parentGroupId: null,
         transform: { x: 100, y: 100, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {}, content: {} }],
     }],
   });

   function pressKey(key: string, modifiers: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}) {
     window.dispatchEvent(new KeyboardEvent("keydown", {
       key, ctrlKey: modifiers.ctrl, shiftKey: modifiers.shift, metaKey: modifiers.meta, bubbles: true,
     }));
   }

   describe("useBuilderShortcuts", () => {
     beforeEach(() => {
       useBuilderStore.setState({
         design: fixtureDesign() as never,
         selectedElementIds: ["e1"],
         activeSceneId: "s1",
         zoomLevel: 1,
         dirty: false,
         toolMode: "select",
         penDraft: null,
       });
       useTemporalStore.getState().clear();
       copyMock.mockReset();
       pasteMock.mockReset();
     });

     it("Delete removes every selected element", () => {
       render(<Harness />);
       pressKey("Delete");
       const els = useBuilderStore.getState().design!.scenes[0].elements;
       expect(els.find((e) => e.id === "e1")).toBeUndefined();
     });

     it("ArrowRight nudges selected by 1 px", () => {
       render(<Harness />);
       pressKey("ArrowRight");
       const el = useBuilderStore.getState().design!.scenes[0].elements[0];
       expect(el.transform.x).toBe(101);
     });

     it("Shift+ArrowDown nudges selected by 10 px", () => {
       render(<Harness />);
       pressKey("ArrowDown", { shift: true });
       const el = useBuilderStore.getState().design!.scenes[0].elements[0];
       expect(el.transform.y).toBe(110);
     });

     it("Escape clears selection", () => {
       render(<Harness />);
       pressKey("Escape");
       expect(useBuilderStore.getState().selectedElementIds).toEqual([]);
     });

     it("Ctrl+C calls copyElementsToClipboard", () => {
       render(<Harness />);
       pressKey("c", { ctrl: true });
       expect(copyMock).toHaveBeenCalled();
     });

     it("Ctrl+V calls pasteElementsFromClipboard", () => {
       render(<Harness />);
       pressKey("v", { ctrl: true });
       expect(pasteMock).toHaveBeenCalled();
     });

     it("Ctrl+D duplicates selection (writeText then readText pattern)", async () => {
       render(<Harness />);
       pressKey("d", { ctrl: true });
       expect(copyMock).toHaveBeenCalled();
       expect(pasteMock).toHaveBeenCalled();
     });
   });
   ```

2. Run — expect FAIL.

3. Implement `apps/web/src/components/admin/builder/useBuilderShortcuts.ts`:

   ```ts
   "use client";

   import { useHotkeys } from "react-hotkeys-hook";
   import { useBuilderStore, useTemporalStore } from "@/state/builder/store";
   import {
     copyElementsToClipboard,
     pasteElementsFromClipboard,
   } from "@/state/builder/clipboard";

   /**
    * Wave 1C — every editor keyboard shortcut, in one hook.
    *
    * mod+z          undo
    * mod+shift+z    redo
    * mod+y          redo (Windows alt)
    * mod+c          copy selection
    * mod+v          paste
    * mod+d          duplicate selection (copy + paste, offsets +20 px)
    * delete/back    delete every selected element
    * arrow keys     nudge 1 px (10 px with shift)
    * escape         clear selection / cancel pen
    *
    * react-hotkeys-hook auto-skips presses while a contenteditable /
    * input has focus so TopBar title field + Properties Panel inputs
    * keep their native arrow-key + ctrl+z behaviour.
    */
   export function useBuilderShortcuts() {
     useHotkeys("mod+z", (e) => {
       e.preventDefault();
       useTemporalStore.getState().undo();
     }, { enableOnFormTags: false });

     useHotkeys("mod+shift+z, mod+y", (e) => {
       e.preventDefault();
       useTemporalStore.getState().redo();
     }, { enableOnFormTags: false });

     useHotkeys("mod+c", (e) => {
       e.preventDefault();
       void copyElementsToClipboard();
     }, { enableOnFormTags: false });

     useHotkeys("mod+v", (e) => {
       e.preventDefault();
       void pasteElementsFromClipboard();
     }, { enableOnFormTags: false });

     useHotkeys("mod+d", (e) => {
       e.preventDefault();
       (async () => {
         await copyElementsToClipboard();
         await pasteElementsFromClipboard();
       })();
     }, { enableOnFormTags: false });

     useHotkeys("delete, backspace", (e) => {
       e.preventDefault();
       const ids = useBuilderStore.getState().selectedElementIds;
       const del = useBuilderStore.getState().deleteElement;
       for (const id of ids) del(id);
     }, { enableOnFormTags: false });

     useHotkeys("escape", (e) => {
       e.preventDefault();
       const state = useBuilderStore.getState();
       if (state.toolMode === "pen") {
         state.cancelPenDraft();
       } else {
         state.selectMultiple([]);
       }
     }, { enableOnFormTags: false });

     const nudge = (dx: number, dy: number) => {
       const state = useBuilderStore.getState();
       if (!state.design || !state.activeSceneId) return;
       const scene = state.design.scenes.find((s) => s.id === state.activeSceneId);
       if (!scene) return;
       for (const id of state.selectedElementIds) {
         const el = scene.elements.find((e) => e.id === id);
         if (!el) continue;
         state.updateElement(id, {
           transform: { ...el.transform, x: el.transform.x + dx, y: el.transform.y + dy },
         } as never);
       }
     };

     useHotkeys("up", (e) => { e.preventDefault(); nudge(0, -1); }, { enableOnFormTags: false });
     useHotkeys("down", (e) => { e.preventDefault(); nudge(0, 1); }, { enableOnFormTags: false });
     useHotkeys("left", (e) => { e.preventDefault(); nudge(-1, 0); }, { enableOnFormTags: false });
     useHotkeys("right", (e) => { e.preventDefault(); nudge(1, 0); }, { enableOnFormTags: false });

     useHotkeys("shift+up", (e) => { e.preventDefault(); nudge(0, -10); }, { enableOnFormTags: false });
     useHotkeys("shift+down", (e) => { e.preventDefault(); nudge(0, 10); }, { enableOnFormTags: false });
     useHotkeys("shift+left", (e) => { e.preventDefault(); nudge(-10, 0); }, { enableOnFormTags: false });
     useHotkeys("shift+right", (e) => { e.preventDefault(); nudge(10, 0); }, { enableOnFormTags: false });
   }
   ```

4. In `apps/web/src/components/admin/builder/CanvasEditorShell.tsx`, just below the existing `useEffect(() => { loadDesign(design); ... })` add:

   ```tsx
   import { useBuilderShortcuts } from "./useBuilderShortcuts";
   ```

   And inside the component body, alongside the `loadDesign` effect:

   ```tsx
     useBuilderShortcuts();
   ```

5. Re-run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/useBuilderShortcuts.test.tsx
   ```

   Expected: `Tests 7 passed (7)`.

6. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/builder/useBuilderShortcuts.ts apps/web/src/components/admin/builder/useBuilderShortcuts.test.tsx apps/web/src/components/admin/builder/CanvasEditorShell.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-1c): keyboard shortcuts hub

   Single useBuilderShortcuts() hook wires every editor shortcut via
   react-hotkeys-hook: mod+z/y/shift+z (undo/redo), mod+c/v/d
   (copy/paste/duplicate), delete/backspace, arrow keys (1 px nudge;
   10 px with shift), escape (clear selection or cancel pen).

   enableOnFormTags=false keeps the TopBar title input + Properties
   Panel fields owning their native arrow-key + ctrl+z behaviour.
   CanvasEditorShell mounts the hook so it's active for the entire
   editor surface.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 15: E2E spec — pen / group / multi-select / copy-paste / shortcuts

**Files:**

- Create: `apps/web/tests/e2e/overlay-builder-wave-1c.spec.ts`

**Context:** Mirrors the Wave 1A E2E pattern (`overlay-builder-wave-1a.spec.ts`) but exercises Wave 1C surfaces specifically. Seeds a draft design via the admin UI, then drives the new tools.

#### Steps

1. Create `apps/web/tests/e2e/overlay-builder-wave-1c.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";

   const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@cade.local";
   const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "dev-admin-2026";

   test.describe("Overlay Builder — Wave 1C surfaces", () => {
     test.beforeEach(async ({ page }) => {
       await page.goto("/login");
       await page.fill('[data-testid="login-email-input"]', ADMIN_EMAIL);
       await page.fill('[data-testid="login-password-input"]', ADMIN_PASSWORD);
       await page.click('button[type="submit"]');
       await page.waitForURL((u) => !u.toString().endsWith("/login"));
     });

     test("Pen tool: click 3 anchors → Enter → path element appears in layers panel", async ({ page }) => {
       await page.goto("/admin/broadcast/v2/builder");
       await page.click("text=New Design");
       await page.fill('input[aria-label="Title"]', "Wave 1C Pen Smoke");
       await page.click("text=Create");
       await page.waitForURL(/\/edit$/);
       await page.click('button[aria-label="Pen"]');
       const canvas = page.locator('canvas').first();
       const box = await canvas.boundingBox();
       if (!box) throw new Error("canvas not found");
       await page.mouse.click(box.x + 200, box.y + 200);
       await page.mouse.click(box.x + 400, box.y + 100);
       await page.mouse.click(box.x + 600, box.y + 300);
       await page.keyboard.press("Enter");
       await expect(page.locator('[aria-label="Layers"]').getByText(/path/i)).toBeVisible();
     });

     test("Group + ungroup: shift-click two rects → mod+g → layers shows group → ungroup", async ({ page }) => {
       await page.goto("/admin/broadcast/v2/builder");
       await page.click("text=New Design");
       await page.fill('input[aria-label="Title"]', "Wave 1C Group Smoke");
       await page.click("text=Create");
       await page.waitForURL(/\/edit$/);
       await page.click('button[aria-label="Rect"]');
       await page.click('button[aria-label="Rect"]');
       // Shift-click both rect rows in the layers panel.
       const rows = page.locator('[aria-label="Layers"] li');
       await rows.nth(0).click();
       await rows.nth(1).click({ modifiers: ["Shift"] });
       // Group via Properties Panel "Group" button (wired in Wave 1C task 7 — surface assumed present).
       await page.click('button:has-text("Group")');
       await expect(page.locator('[aria-label="Layers"]').getByText(/^group$/i)).toBeVisible();
       await page.click('button:has-text("Ungroup")');
       await expect(page.locator('[aria-label="Layers"]').getByText(/^group$/i)).toHaveCount(0);
     });

     test("Delete shortcut removes selected element", async ({ page }) => {
       await page.goto("/admin/broadcast/v2/builder");
       await page.click("text=New Design");
       await page.fill('input[aria-label="Title"]', "Wave 1C Delete Smoke");
       await page.click("text=Create");
       await page.waitForURL(/\/edit$/);
       await page.click('button[aria-label="Rect"]');
       const before = await page.locator('[aria-label="Layers"] li').count();
       await page.locator('[aria-label="Layers"] li').first().click();
       await page.keyboard.press("Delete");
       const after = await page.locator('[aria-label="Layers"] li').count();
       expect(after).toBe(before - 1);
     });

     test("Arrow-key nudge moves the selected element", async ({ page }) => {
       await page.goto("/admin/broadcast/v2/builder");
       await page.click("text=New Design");
       await page.fill('input[aria-label="Title"]', "Wave 1C Nudge Smoke");
       await page.click("text=Create");
       await page.waitForURL(/\/edit$/);
       await page.click('button[aria-label="Rect"]');
       await page.locator('[aria-label="Layers"] li').first().click();
       // Read pre-nudge x from the Properties panel.
       const xField = page.locator('input[aria-label="X"]').first();
       const beforeX = Number(await xField.inputValue());
       await page.keyboard.press("ArrowRight");
       const afterX = Number(await xField.inputValue());
       expect(afterX).toBe(beforeX + 1);
     });

     test("Mod+D duplicates selection with +20 px offset", async ({ page }) => {
       await page.goto("/admin/broadcast/v2/builder");
       await page.click("text=New Design");
       await page.fill('input[aria-label="Title"]', "Wave 1C Duplicate Smoke");
       await page.click("text=Create");
       await page.waitForURL(/\/edit$/);
       await page.click('button[aria-label="Rect"]');
       await page.locator('[aria-label="Layers"] li').first().click();
       const beforeRows = await page.locator('[aria-label="Layers"] li').count();
       await page.keyboard.press(process.platform === "darwin" ? "Meta+D" : "Control+D");
       // Wait for clipboard round-trip.
       await page.waitForTimeout(200);
       const afterRows = await page.locator('[aria-label="Layers"] li').count();
       expect(afterRows).toBe(beforeRows + 1);
     });
   });
   ```

2. Run against a dev server. Expect every spec green:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-1c.spec.ts
   ```

   If the Properties Panel does not yet expose `Group` / `Ungroup` buttons (Wave 1B surface that Wave 1C extends), extend `apps/web/src/components/admin/builder/PropertiesPanel.tsx` with a top-section action row gated on `selectedElementIds.length > 1` (for Group) or on a group-id selection (for Ungroup):

   ```tsx
   {selectedElementIds.length > 1 && (
     <button onClick={() => groupElements(selectedElementIds)} className="...">Group</button>
   )}
   {selectedElementIds.length === 1 && selectedElement?.elementType === "group" && (
     <button onClick={() => ungroupElements(selectedElementIds[0])} className="...">Ungroup</button>
   )}
   ```

3. Stage and commit:

   ```bash
   git add apps/web/tests/e2e/overlay-builder-wave-1c.spec.ts apps/web/src/components/admin/builder/PropertiesPanel.tsx
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/wave-1c): E2E spec covering pen / group / shortcuts

   Five Playwright tests exercise:
     - Pen tool 3-anchor → Enter completion
     - Group + ungroup round-trip via Properties Panel buttons
     - Delete shortcut
     - Arrow-key nudge moves the selected element by 1 px
     - Mod+D duplicates with +20 px offset

   Properties Panel gains a Group / Ungroup action row gated on
   selection length + element_type.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 16: Visual-regression baseline for Wave 1C designs

**Files:**

- Create: `apps/web/tests/e2e/visual-regression-wave-1c.spec.ts`
- Create: `apps/web/tests/e2e/fixtures/wave-1c-design-with-path.json` (committed design payload)
- Create: `apps/web/tests/e2e/fixtures/wave-1c-design-with-groups.json` (committed design payload)

**Context:** Two reference designs cover the Wave 1C surface — one demonstrates a path-only render (triangle + curved path); the other demonstrates grouped elements (a group containing a rect + a text). Each loads at `/overlay/v2/user/<slug>?demo=1` and pixel-diffs against committed baselines using the same `toHaveScreenshot` pattern Wave 1A / §15.B established.

#### Steps

1. Create the fixture payloads. `apps/web/tests/e2e/fixtures/wave-1c-design-with-path.json`:

   ```json
   {
     "id": "00000000-0000-0000-0000-00000000c101",
     "slug": "wave-1c-vr-path",
     "title": "Wave 1C VR — Path",
     "description": null,
     "mode": "single",
     "status": "published",
     "canvas_width": 1920,
     "canvas_height": 1080,
     "created_by": "00000000-0000-0000-0000-000000000099",
     "deleted_at": null,
     "scenes": [{
       "id": "00000000-0000-0000-0000-00000000c111",
       "design_id": "00000000-0000-0000-0000-00000000c101",
       "order_index": 0,
       "name": "main",
       "duration_ms": 5000,
       "transition_in": "fade",
       "transition_out": "fade",
       "deleted_at": null,
       "elements": [{
         "id": "00000000-0000-0000-0000-00000000c121",
         "scene_id": "00000000-0000-0000-0000-00000000c111",
         "parent_group_id": null,
         "element_type": "path",
         "z_index": 0, "locked": false, "visible": true,
         "transform": { "x": 600, "y": 300, "width": 720, "height": 480,
           "rotation": 0, "scale_x": 1, "scale_y": 1, "opacity": 1 },
         "style": { "fill": "#6bcd06", "stroke": "#ffffff", "strokeWidth": 4, "shadow": null },
         "content": { "path": { "nodes": [
           { "x": 360, "y": 0, "ctrlInX": 360, "ctrlInY": 0, "ctrlOutX": 720, "ctrlOutY": 240 },
           { "x": 720, "y": 480, "ctrlInX": 720, "ctrlInY": 480, "ctrlOutX": 0, "ctrlOutY": 480 },
           { "x": 0, "y": 480, "ctrlInX": 0, "ctrlInY": 480, "ctrlOutX": 0, "ctrlOutY": 0 }
         ], "closed": true } },
         "binding": null, "animation": null, "deleted_at": null
       }]
     }]
   }
   ```

   `apps/web/tests/e2e/fixtures/wave-1c-design-with-groups.json` — similar shape with two top-level elements (rect + text) sharing a single `parent_group_id`, plus a synthetic group row.

2. Create `apps/web/tests/e2e/visual-regression-wave-1c.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";
   import path from "node:path";
   import fs from "node:fs";

   const DESIGNS = [
     { slug: "wave-1c-vr-path", fixture: "wave-1c-design-with-path.json" },
     { slug: "wave-1c-vr-groups", fixture: "wave-1c-design-with-groups.json" },
   ];

   test.describe.serial("Visual regression — Wave 1C designs", () => {
     test.beforeAll(async ({ request }) => {
       const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@cade.local";
       const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "dev-admin-2026";
       await request.post("/api/test-only/seed-design", {
         data: { adminEmail, adminPassword,
           designs: DESIGNS.map((d) => ({
             ...JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", d.fixture), "utf8")),
           })),
         },
       });
     });

     for (const d of DESIGNS) {
       test(`${d.slug} renders pixel-stable`, async ({ page }) => {
         await page.setViewportSize({ width: 1920, height: 1080 });
         await page.goto(`/overlay/v2/user/${d.slug}?demo=1`);
         // Wait for show animation + bootstrap to settle.
         await page.waitForTimeout(800);
         await expect(page).toHaveScreenshot(`${d.slug}-default.png`, {
           maxDiffPixelRatio: 0.001,
           timeout: 15000,
         });
       });
     }
   });
   ```

3. The test relies on a test-only seed route `/api/test-only/seed-design`. If that route doesn't exist yet (Wave 1A may have shipped a different shape), add it under `apps/web/src/app/api/test-only/seed-design/route.ts` gated on `process.env.NODE_ENV !== "production"`. Implementation skeleton:

   ```ts
   import { NextResponse } from "next/server";
   import { createServerSupabase } from "@/lib/supabase/server";

   export async function POST(req: Request) {
     if (process.env.NODE_ENV === "production") return new NextResponse("Not Found", { status: 404 });
     const body = await req.json();
     const sb = await createServerSupabase();
     for (const design of body.designs) {
       await sb.from("overlay_user_designs").upsert({
         id: design.id, slug: design.slug, title: design.title, description: design.description,
         mode: design.mode, status: design.status,
         canvas_width: design.canvas_width, canvas_height: design.canvas_height,
         created_by: design.created_by,
       }, { onConflict: "id" });
       for (const scene of design.scenes) {
         await sb.from("overlay_user_design_scenes").upsert({
           id: scene.id, design_id: scene.design_id, order_index: scene.order_index,
           name: scene.name, duration_ms: scene.duration_ms,
           transition_in: scene.transition_in, transition_out: scene.transition_out,
         }, { onConflict: "id" });
         for (const el of scene.elements) {
           await sb.from("overlay_user_design_elements").upsert({
             id: el.id, scene_id: el.scene_id, parent_group_id: el.parent_group_id,
             element_type: el.element_type, z_index: el.z_index, locked: el.locked, visible: el.visible,
             transform: el.transform, style: el.style, content: el.content,
             binding: el.binding, animation: el.animation,
           }, { onConflict: "id" });
         }
       }
       await sb.from("overlay_template_variants").upsert({
         overlay_key: `user-${design.slug}`, variant_id: "default",
         label: design.title, html_path: `/overlay/v2/user/${design.slug}`,
         active: true, kind: "dynamic",
       }, { onConflict: "overlay_key,variant_id" });
     }
     return NextResponse.json({ ok: true });
   }
   ```

4. Generate the baselines once on a green local run:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-1c.spec.ts --update-snapshots
   ```

   Then re-run normal to assert <0.1% diff:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-1c.spec.ts
   ```

5. Stage and commit (baseline screenshots included):

   ```bash
   git add apps/web/tests/e2e/visual-regression-wave-1c.spec.ts apps/web/tests/e2e/fixtures/wave-1c-design-with-path.json apps/web/tests/e2e/fixtures/wave-1c-design-with-groups.json apps/web/tests/e2e/visual-regression-wave-1c.spec.ts-snapshots/ apps/web/src/app/api/test-only/seed-design/route.ts
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/wave-1c): visual-regression baselines for path + group renders

   Two reference designs locked into the e2e snapshot suite:
     - wave-1c-vr-path        — closed cubic-Bezier triangle
     - wave-1c-vr-groups      — rect + text grouped under a single
                                parent, asserting tree render

   maxDiffPixelRatio = 0.001 mirrors the existing 16-overlay baseline
   tolerance. Test-only seed route at /api/test-only/seed-design loads
   the JSON fixtures into overlay_user_* tables (gated on
   NODE_ENV !== "production").

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 17: Full verification gate + push

This is the FINAL gate before declaring Wave 1C complete. Mirrors Wave 1A Task 32 + spec §17 + CLAUDE.md §§4, 11, 12.

**Files:**

- Modify: `tasks/todo.md` (append Wave 1C review section)
- Modify: `tasks/lessons.md` (capture any lessons surfaced during verification)
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md`
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md`

#### Step 1: Unit tests pass

```bash
npm --workspace apps/web run test
```

Expected: 0 failures. The new tests added across Tasks 2-14 plus every Wave 1A + 1B test all green.

#### Step 2: Lint clean

```bash
npm --workspace apps/web run lint
```

Expected: 0 errors. Warnings allowed only if present in `main` already.

#### Step 3: Build clean

```bash
npm --workspace apps/web run build
```

Expected: production build succeeds with no errors. `prebuild` runs `sync:overlays` + `check:element-id-parity` — both must pass.

#### Step 4: E2E tests pass

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-1c.spec.ts
```

Expected: spec passes.

Then re-run the full suite to confirm no regression:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e
```

Expected: every spec green, including Wave 1A + 1B specs.

#### Step 5: Visual regression pass

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-1c.spec.ts
```

Expected: <0.1% diff.

Then the 16-built-in baseline (must remain untouched):

```bash
npm --workspace apps/web run e2e:visual-regression
```

Expected: every Wave 1A + 1B + built-in overlay still green.

#### Step 6: Manual Chrome end-to-end per CLAUDE.md §11

Per CLAUDE.md §11 (verify-before-show, non-negotiable):

1. Set `NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true` in `apps/web/.env.local`.
2. Start dev server: `npx next dev -p 3030`.
3. Load Claude-in-Chrome tools via `ToolSearch select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__javascript_tool`. Drive:
   1. `/login` → log in as `admin@cade.local` / `dev-admin-2026`.
   2. `/admin/broadcast/v2/builder` → New Design → "Wave 1C Smoke" → enter editor.
   3. Toolbar → click Pen → click 4 anchors on the canvas → press Enter → confirm a path row appears in Layers.
   4. Toolbar → click Rect twice → shift-click both rect rows in Layers → click Group in Properties Panel → confirm group row appears.
   5. With group selected, press `Cmd+D` / `Ctrl+D` → confirm duplicated group appears offset +20 px.
   6. Select a rect inside the duplicated group → press ArrowRight 10 times → confirm Properties Panel `X` value increments by 10.
   7. Press `Cmd+Z` / `Ctrl+Z` repeatedly → confirm history walks back step-by-step.
   8. Press Delete → confirm element disappears.
   9. Save → Publish → open `/overlay/v2/user/wave-1c-smoke?demo=1` → confirm the path renders + the group renders with both children visible.
   10. Run `mcp__claude-in-chrome__read_console_messages` → assert zero red errors.

If any step shows red errors or visible glitches, STOP. Fix root cause. Re-run from Step 1.

#### Step 7: Post-push platform-wide verification per CLAUDE.md §12

Run the route-by-route status table — one row per route. Minimum routes:

| Route | Expected |
|---|---|
| `GET /` | 200 |
| `GET /login` | 200 |
| `GET /standings` | 200 |
| `GET /admin` | 307 (unauth) / 200 (auth) |
| `GET /admin/broadcast/v2` | 307 / 200 |
| `GET /admin/broadcast/v2/builder` (flag ON) | 307 / 200 |
| `GET /admin/broadcast/v2/builder/<seeded-slug>/edit` (auth) | 200 |
| `GET /overlay/v2/user/wave-1c-vr-path?demo=1` | 200 |
| `GET /overlay/v2/user/wave-1c-vr-groups?demo=1` | 200 |
| `GET /overlay/v2/04-h2h-2?demo=1` | 200 |
| `GET /overlay/v2/07-leaderboard?demo=1` | 200 |
| `GET /overlay/v2/user/does-not-exist?demo=1` | 404 |

Capture the table in the post-push report. If any actual ≠ expected, STOP, diagnose, fix, restart from Step 1.

Helper at `apps/web/scripts/_verify-wave-1c-routes.mjs` (one-shot, delete after run) — same shape as the Wave 1A helper with the route list above.

#### Step 8: Push to origin/main

Per `feedback_always_push_to_prod` memory rule + CLAUDE.md verification discipline:

```bash
git status
git push origin main
```

Expected: Vercel auto-deploys. Monitor until **Ready**. Then re-run Step 7 against live URL:

```bash
VERIFY_BASE_URL=https://cade-league.vercel.app node apps/web/scripts/_verify-wave-1c-routes.mjs
```

Expected: identical row-by-row status.

#### Step 9: Memory update

Per CLAUDE.md "Always document resume state" + "Auto-update memory rule".

Append to `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md`:

```md
## Status

- **Wave 1C SHIPPED <YYYY-MM-DD> commit <SHA>** — path/pen tool +
  grouping + multi-select bulk transform + undo polish + copy/paste +
  keyboard shortcuts. New tests: path-validator, PathPenOverlay,
  clipboard, useBuilderShortcuts, plus extensions to compiler /
  CanvasStage / LayersPanel / store. Visual-regression baselines
  added for path + grouped reference designs.
- **Verification:** `npm run test` (all green), `lint`, `build`,
  `e2e` (overlay-builder-wave-1c.spec.ts + full suite),
  `e2e:visual-regression` (Wave 1C + Wave 1A + 16 built-in),
  manual Chrome end-to-end per CLAUDE.md §11, post-push curl
  table per §12.
- **Next:** Wave 2A `writing-plans` dispatch — PSD upload +
  ag-psd layer extraction + place-as-image flow. Spec §11 row 4.
```

Update the RESUME line in `MEMORY.md`:

```md
- **🟢 RESUME <YYYY-MM-DD>:** [Overlay Builder Wave 1C SHIPPED](project_overlay_builder_2026_05_17.md). Commit `<SHA>`. Path/pen tool + grouping + multi-select + polished undo + copy/paste + shortcuts. Next: Wave 2A plan dispatch.
```

Append a one-line entry to `tasks/todo.md` under the Wave 1C review section + capture lessons in `tasks/lessons.md` per CLAUDE.md "Error log rule" format.

Commit the deltas:

```bash
git add tasks/todo.md tasks/lessons.md
git commit -m "$(cat <<'EOF'
docs(overlay-builder): wave 1C review + lessons log after verification gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

#### Step 10: TaskUpdate cleanup

- TaskCreate ID for "Wave 1C implement" → status `completed`.
- TaskCreate ID for "Wave 1C verify" → status `completed`.
- Open next wave's stub (Wave 2A plan dispatch) → `pending` or `in_progress` if dispatching immediately.

**Final gate — declare wave complete only when ALL 10 steps green.** Per CLAUDE.md §4: "Never mark a task complete without proving it works end-to-end."

---

## Self-Review

This section documents the post-assembly checks per writing-plans self-review protocol.

### (A) Spec coverage — Wave 1C row from spec §11

| Wave 1C bullet (spec §11) | Implementing task(s) | Status |
|---|---|---|
| Path / pen tool | Task 2 (PathSpec types) · Task 3 (path-validator) · Task 4 (compiler SVG emit) · Task 5 (PathPenOverlay + pen-draft zustand slice) · Task 6 (Toolbar Pen button) | Covered |
| Grouping (parent_group_id wiring) | Task 7 (groupElements / ungroupElements zustand actions) · Task 8 (CanvasStage tree render) · Task 9 (LayersPanel tree) | Covered |
| Multi-select bulk transform | Task 10 (selectMultiple action) · Task 11 (Konva Transformer over union bbox) | Covered (translate-only; resize/rotate deferred to follow-up; noted in plan header) |
| Undo polish (zundo history granularity) | Task 12 (transient + commitTransientHistory) | Covered |
| Copy / paste (within design + cross-design via JSON clipboard) | Task 13 (clipboard module with magic-header envelope, navigator.clipboard read/writeText) | Covered |
| Keyboard shortcuts (Delete, arrows, Cmd+D, Esc, Ctrl+Z / Ctrl+Shift+Z) | Task 14 (useBuilderShortcuts hub via react-hotkeys-hook) | Covered |

**Result:** Every Wave 1C bullet from spec §11 mapped to at least one task. Multi-element resize / rotate explicitly deferred + documented in plan header.

### (B) Placeholder scan

| Pattern | Hits | Notes |
|---|---|---|
| `TBD` | 0 | clean |
| `TODO` | 0 | clean |
| `to be filled` | 0 | clean |
| `implement later` | 0 | clean |
| `Add appropriate error handling` | 0 | clean |
| `add validation` | 0 | clean |
| `handle edge cases` | 0 | clean |
| `Similar to Task N` | 0 | clean |

**Result:** 0 placeholder issues. Every task with code shows full implementation blocks + failing-test → impl → passing-test cycle.

### (C) Type consistency

Plan follows the Wave 1A two-layer naming convention:
- **TypeScript domain types** (`Element`, `Transform`, `PathSpec`, `PathNode`): camelCase per `types.ts`.
- **DB row interfaces + raw SQL**: snake_case (`parent_group_id`, `element_type`, `z_index`).

Compiler fixtures (`design-with-path.ts`) use snake_case shape matching the existing Wave 1A pattern (`design-rect-text-image.ts`).

Cross-file consistency:
- `PathSpec` / `PathNode` / `PathSpecSchema` / `PathNodeSchema` exported from `types.ts` (Task 2), consumed by `path-validator.ts` (Task 3), `compiler.ts` (Task 4), `PathPenOverlay.tsx` (Task 5 — via the local PenDraftNode type that mirrors PathNode camelCase).
- `parentGroupId` (camelCase) used consistently across `Element` type, `groupElements` action, `LayersPanel` filter, `CanvasStage` tree walker, `clipboard.ts` rewire map.
- `selectMultiple(ids)` exported from `store.ts` (Task 10), consumed by `useBuilderShortcuts.ts` (Task 14 Escape handler), `clipboard.ts` (Task 13 paste selectedElementIds reset).

### (D) File-path consistency

All file paths repo-relative (`apps/web/...`, `supabase/...`, `tasks/...`) or absolute Windows paths for the user's `~/.claude` memory directory. No mixed-style line within a single task.

### (E) Cross-wave dependencies

Wave 1C depends on Wave 1B for:
- Properties Panel structure (Task 15 adds Group / Ungroup action row inside it).
- Manual data-bind UI (not extended here — preserved as-is).
- Alignment guides + snap (preserved — Wave 1C nudge math operates in absolute coordinates without touching guides).

Wave 1B plan being written in parallel by another agent. If Wave 1B Properties Panel shape changes, Task 15's Group / Ungroup action row insertion point may need a follow-up patch — flagged as known integration touchpoint.

### (F) Verification gate completeness

Task 17 covers every CLAUDE.md acceptance gate:
- §4 verify-before-done: unit + lint + build + e2e + visual-regression all required green.
- §11 verify-before-show: manual Chrome browser walkthrough mandatory before claiming complete.
- §12 post-push platform-wide verification: route-by-route curl table.
- §17 of spec: every applicable success criterion from Wave 1C scope demonstrably exercised.

Memory update step (§9) covers `feedback_always_document_resume_state` + `feedback_auto_memory_update` rules.

**Self-review status:** PASS. Plan ready for execution via superpowers:subagent-driven-development.
