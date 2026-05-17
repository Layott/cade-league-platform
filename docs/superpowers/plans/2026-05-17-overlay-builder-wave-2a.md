# Overlay Builder Wave 2A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the upload-only PSD pipeline so admins can drop a Photoshop document into the builder asset library, have the server extract every layer into a transparent-PNG sprite + a full-canvas flat PNG, and place either an individual layer or the flat composite onto the canvas as an image element. Photopea iframe round-trip stays out of scope (ships Wave 2B). The persistent design contract from Wave 1A (`overlay_user_*` tables, `/overlay/v2/user/[slug]` route, §14 HTML) is untouched — Wave 2A only adds new asset rows, new server module entries, a new toolbar sub-option, and an asset-library page.

**Architecture:** Server-side parse with `ag-psd` (pure JS, MIT). Upload runs as a Next.js Server Action that streams PSD bytes into Supabase Storage at `overlay-user-assets/psd/<uuid>.psd`, then synchronously parses + writes flat PNG (`overlay-user-assets/psd/<uuid>-flat.png`) + per-layer sprites (`overlay-user-assets/psd/<uuid>-layer-<n>.png`). Each upload produces N+2 rows in `overlay_user_assets`: 1 PSD asset + 1 flat PNG asset (with `flat_png_asset_id` back-pointer from PSD row) + N layer sprite assets (each with `psd_parent_asset_id` + `psd_layer_index`). Toolbar gets a new "From PSD" sub-option on the Image button that opens a layer-picker drawer driven by a server-fetched layer list for the selected PSD asset. Soft warn at 50 MB, hard reject at 100 MB. OOM-safe via try/catch around the parser with a friendly error surfaced to the editor.

**Tech Stack:** Next.js 15 (App Router) · Supabase Postgres + Storage · TypeScript · Vitest · Playwright · `ag-psd` (MIT) · Zod · lucide-react · existing `overlay-user-assets` storage bucket from Wave 1A

**Related:** Spec `docs/superpowers/specs/2026-05-17-overlay-builder-design.md` §9 (PSD workflow) + §11 (Wave 2A scope) + §10 (asset library) + §12 (security) · Wave 1A plan `docs/superpowers/plans/2026-05-17-overlay-builder-wave-1a.md` · CLAUDE.md §14 (overlay HTML contract — image elements unchanged) · CLAUDE.md §11 (verify-before-show) · CLAUDE.md §12 (post-push verification)

**Wave 2A delivers (end of wave):**
1. `ag-psd` installed as runtime dependency in `apps/web`.
2. New server module `apps/web/src/server/overlays/builder/psd-parser.ts` exporting `parsePsd(buffer)` that returns `{ flatPng: Buffer, layers: Array<{ name, bounds, png: Buffer }> }`.
3. New server module `apps/web/src/server/overlays/builder/assets.ts` exporting `uploadPsd`, `listPsdAssets`, `listPsdLayers`, `getAsset`, `softDeleteAsset` — all SupabaseClient-first per CLAUDE.md mock-friendly pattern.
4. New server action `uploadPsdAction(formData)` at `apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/assets-actions.ts` — perm-gates on `overlay.design.manage`, rate-limits via `enforceAuthedWrite`, validates size + MIME, runs `parsePsd`, persists assets, returns the new parent PSD asset id + summary.
5. New asset library page at `/admin/broadcast/v2/builder/assets` with PSD upload control + drag-drop area + per-PSD card showing layer count + thumbnail.
6. Toolbar "Image" button gains a dropdown: **Upload image** (existing path, unchanged) · **From PSD** (new — opens PSD picker → layer picker → drop onto canvas).
7. `PsdPlaceDrawer` client component lists layers of the selected PSD and lets the user click any layer or "Flatten" to drop an image element at canvas center.
8. Upload progress UI: shows "Parsing PSD..." status while server action runs (10 s+ acceptable for 100 MB PSDs).
9. ≥12 new unit tests (psd-parser, assets module, upload action) + 1 new E2E spec exercising upload → place layer → save → render through `/overlay/v2/user/<slug>`.
10. Feature flag `overlayBuilder.enabled` continues to gate every Wave 2A surface — no new flag introduced.

**Out of scope for Wave 2A** (will ship in later waves per spec §11):
- Photopea iframe + postMessage bridge + bytes-back round trip (Wave 2B).
- PSD edit-in-place (Wave 2B).
- Background queue / Vercel background function for parsing (Wave 2B if a 100 MB PSD trips request timeouts; Wave 2A parses synchronously inside the action and accepts up to ~30 s for the largest valid case).
- Per-layer blend-mode preservation at render (Wave 2A drops layers as plain `<img>` — Photoshop blend modes are lost; opacity is preserved).
- PSB (PSD Big — > 30 000 px). `ag-psd` supports PSB but Wave 2A rejects any file whose extension is not `.psd` to keep the failure surface small.
- Smart object resolution / linked-file expansion. `ag-psd` renders smart objects via the stored composite; that's good enough for our purposes and Wave 2A does not unpack them.

---

### Task 1: Install `ag-psd`

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json` (and root `package-lock.json` if hoisted)
- Test: none (install is verified by command output)

**Context:** Verified via `grep -E '"ag-psd"' apps/web/package.json` — package is not installed. `ag-psd` ships as MIT, pure JS, zero native deps, works in Node 18+ via `node:buffer`. Wave 2A pins the major version explicitly so accidental `npm audit fix` doesn't yank a breaking change.

#### Steps

1. From the repo root, verify the absence of the dependency before installing:

   ```bash
   grep -E '"ag-psd"' apps/web/package.json || echo "absent — proceed"
   ```

   Expected output:

   ```
   absent — proceed
   ```

2. Install into the `apps/web` workspace:

   ```bash
   npm install --workspace apps/web ag-psd
   ```

   Expected output (versions current as of 2026-05-17; exact patch versions may differ):

   ```
   added 1 package, and audited 1235 packages in 6s

   170 packages are looking for funding
     run `npm fund` for details

   found 0 vulnerabilities
   ```

3. Confirm the package now appears in `apps/web/package.json`:

   ```bash
   grep -E '"ag-psd"' apps/web/package.json
   ```

   Expected output (exact version specifier will reflect installer resolution; expect `^14.x` or `^15.x`):

   ```
       "ag-psd": "^14.4.3"
   ```

4. Sanity-check the package exports a `readPsd` function (used by Task 2):

   ```bash
   node -e "console.log(typeof require('ag-psd').readPsd)" --eval --input-type=commonjs 2>/dev/null || node -e "import('ag-psd').then(m => console.log(typeof m.readPsd))"
   ```

   Expected output:

   ```
   function
   ```

5. Verify lint + unit tests still pass with the new dep in place (catches transitive-peer regressions):

   ```bash
   npm --workspace apps/web run lint && npm --workspace apps/web run test
   ```

   Expected output ends with:

   ```
   Test Files  ... passed
        Tests  ... passed
     Duration  ...
   ```

6. Stage and commit:

   ```bash
   git add apps/web/package.json apps/web/package-lock.json package-lock.json
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2a): install ag-psd

   Adds the MIT-licensed pure-JS PSD parser the builder needs to extract
   layer trees + flatten composites server-side. Zero native deps; works
   under the existing Node 18 / Vercel Functions runtime. Pinned to the
   major version so accidental upgrade doesn't yank breaking changes.

   Lint + unit tests green post-install; no transitive regressions.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 2: Server module `psd-parser.ts`

**Files:**

- Create: `apps/web/src/server/overlays/builder/psd-parser.ts`
- Create: `apps/web/src/server/overlays/builder/psd-parser.test.ts`
- Create: `apps/web/src/server/overlays/builder/__fixtures__/tiny.psd` (≈4 KB hand-authored PSD with 2 layers — see step 3 for generation)

**Context:** Pure-function module — takes a `Buffer`, returns parsed PNG bytes. No Supabase. No filesystem. This is the leaf of the dependency tree; everything else depends on it.

#### Steps

1. Write the failing test first. Create `apps/web/src/server/overlays/builder/psd-parser.test.ts`:

   ```ts
   import { describe, expect, it } from "vitest";
   import { readFile } from "node:fs/promises";
   import path from "node:path";
   import { parsePsd, MAX_PSD_BYTES, SOFT_WARN_PSD_BYTES } from "./psd-parser";

   const FIXTURE = path.join(__dirname, "__fixtures__", "tiny.psd");

   describe("parsePsd", () => {
     it("constants are 100 MB / 50 MB", () => {
       expect(MAX_PSD_BYTES).toBe(100 * 1024 * 1024);
       expect(SOFT_WARN_PSD_BYTES).toBe(50 * 1024 * 1024);
     });

     it("extracts every layer from a 2-layer fixture PSD", async () => {
       const buffer = await readFile(FIXTURE);
       const result = await parsePsd(buffer);
       expect(result.flatPng).toBeInstanceOf(Buffer);
       expect(result.flatPng.byteLength).toBeGreaterThan(0);
       expect(result.flatPng.subarray(0, 8)).toEqual(
         Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
       );
       expect(result.layers.length).toBeGreaterThanOrEqual(2);
       for (const layer of result.layers) {
         expect(typeof layer.name).toBe("string");
         expect(layer.bounds).toEqual(
           expect.objectContaining({
             left: expect.any(Number),
             top: expect.any(Number),
             right: expect.any(Number),
             bottom: expect.any(Number),
           }),
         );
         expect(layer.png).toBeInstanceOf(Buffer);
         expect(layer.png.byteLength).toBeGreaterThan(0);
         expect(layer.png.subarray(0, 8)).toEqual(
           Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
         );
       }
     });

     it("returns canvas dimensions", async () => {
       const buffer = await readFile(FIXTURE);
       const result = await parsePsd(buffer);
       expect(result.canvasWidth).toBeGreaterThan(0);
       expect(result.canvasHeight).toBeGreaterThan(0);
     });

     it("rejects buffers above MAX_PSD_BYTES", async () => {
       const huge = Buffer.alloc(MAX_PSD_BYTES + 1, 0);
       await expect(parsePsd(huge)).rejects.toThrow(/exceeds 100/i);
     });

     it("rejects empty / non-PSD buffers gracefully", async () => {
       await expect(parsePsd(Buffer.alloc(0))).rejects.toThrow();
       await expect(parsePsd(Buffer.from("not a psd"))).rejects.toThrow();
     });

     it("OOM / unexpected parser exceptions wrap into PsdParseError with friendly message", async () => {
       const garbage = Buffer.from([0x38, 0x42, 0x50, 0x53, 0xff, 0xff, 0xff, 0xff]);
       await expect(parsePsd(garbage)).rejects.toMatchObject({
         name: "PsdParseError",
         message: expect.stringMatching(/could not parse/i),
       });
     });
   });
   ```

2. Run the test — expect FAIL (module + fixture don't exist):

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/psd-parser.test.ts
   ```

   Expected: `Cannot find module './psd-parser'` and `ENOENT: ... tiny.psd`.

3. Author the fixture PSD. Create `apps/web/src/server/overlays/builder/__fixtures__/` directory then generate a tiny 2-layer PSD using `ag-psd`'s `writePsd`:

   Create `apps/web/scripts/_make-tiny-psd.mjs` (one-shot generator, delete after run):

   ```js
   import { writePsdBuffer } from "ag-psd";
   import { writeFileSync, mkdirSync } from "node:fs";
   import path from "node:path";

   // 64x64 RGBA canvas; two layers — red filled top-left 32x32, blue filled bottom-right 32x32.
   const W = 64;
   const H = 64;

   function solidLayer(name, color, left, top, w, h) {
     const channelData = new Uint8ClampedArray(w * h * 4);
     for (let i = 0; i < w * h; i++) {
       channelData[i * 4 + 0] = color[0];
       channelData[i * 4 + 1] = color[1];
       channelData[i * 4 + 2] = color[2];
       channelData[i * 4 + 3] = color[3];
     }
     return {
       name,
       left,
       top,
       right: left + w,
       bottom: top + h,
       opacity: 255,
       canvas: undefined, // ag-psd accepts ImageData-like { data, width, height }
       imageData: { data: channelData, width: w, height: h },
     };
   }

   // Composite for the document image
   const compData = new Uint8ClampedArray(W * H * 4);
   for (let y = 0; y < H; y++) {
     for (let x = 0; x < W; x++) {
       const i = (y * W + x) * 4;
       const inRed = x < 32 && y < 32;
       const inBlue = x >= 32 && y >= 32;
       if (inRed) { compData[i] = 255; compData[i + 3] = 255; }
       else if (inBlue) { compData[i + 2] = 255; compData[i + 3] = 255; }
       else { compData[i + 3] = 0; }
     }
   }

   const psd = {
     width: W,
     height: H,
     imageData: { data: compData, width: W, height: H },
     children: [
       solidLayer("Background", [255, 0, 0, 255], 0, 0, 32, 32),
       solidLayer("Foreground", [0, 0, 255, 255], 32, 32, 32, 32),
     ],
   };

   const buf = writePsdBuffer(psd);
   const outDir = path.resolve("apps/web/src/server/overlays/builder/__fixtures__");
   mkdirSync(outDir, { recursive: true });
   const outPath = path.join(outDir, "tiny.psd");
   writeFileSync(outPath, Buffer.from(buf));
   console.log("wrote", outPath, buf.byteLength, "bytes");
   ```

   Run it once:

   ```bash
   node apps/web/scripts/_make-tiny-psd.mjs
   ```

   Expected output:

   ```
   wrote apps/web/src/server/overlays/builder/__fixtures__/tiny.psd 2048 bytes
   ```

   Delete the generator after the fixture is committed (it's one-shot — fixture lives forever, generator does not):

   ```bash
   rm apps/web/scripts/_make-tiny-psd.mjs
   ```

4. Author the parser. Create `apps/web/src/server/overlays/builder/psd-parser.ts`:

   ```ts
   /**
    * Overlay Builder Wave 2A — PSD parser.
    *
    * Pure function: PSD bytes in → flat PNG bytes + per-layer PNG sprites
    * out. No Supabase, no filesystem, no network. Wraps `ag-psd` so the
    * rest of the builder talks to a stable interface even if the parser
    * library is swapped later.
    *
    * Hard cap 100 MB enforced by Spec §9.3. Caller is responsible for
    * rejecting before invoking us (the action layer does that for a
    * friendlier UX) — we double-check here as a safety net.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9
    */

   import { readPsd, initializeCanvas } from "ag-psd";
   import { PNG } from "pngjs";

   export const MAX_PSD_BYTES = 100 * 1024 * 1024; // 100 MB
   export const SOFT_WARN_PSD_BYTES = 50 * 1024 * 1024; // 50 MB

   export class PsdParseError extends Error {
     constructor(message: string, cause?: unknown) {
       super(message);
       this.name = "PsdParseError";
       if (cause) (this as { cause?: unknown }).cause = cause;
     }
   }

   export type LayerSprite = {
     /** Layer name as authored in Photoshop (may be empty). */
     name: string;
     /** Layer bounds in PSD pixel space. */
     bounds: { left: number; top: number; right: number; bottom: number };
     /** PNG bytes cropped to the layer bounds, transparent background preserved. */
     png: Buffer;
     /** 0-based depth-first index. Used to disambiguate duplicate layer names. */
     index: number;
   };

   export type ParsedPsd = {
     /** Full-canvas PNG flattened by the parser. */
     flatPng: Buffer;
     /** Per-layer sprites, depth-first traversal, hidden + clipping layers excluded. */
     layers: LayerSprite[];
     /** PSD canvas width in pixels. */
     canvasWidth: number;
     /** PSD canvas height in pixels. */
     canvasHeight: number;
   };

   /**
    * Encode an ImageData-shaped {data, width, height} payload as a PNG buffer
    * via `pngjs`. We do NOT use `node-canvas` because it adds 50+ MB of native
    * dependencies that don't run on Vercel Functions. `pngjs` is pure JS,
    * battle-tested, and writes RGBA correctly.
    */
   function encodePngFromImageData(imageData: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }): Buffer {
     const png = new PNG({ width: imageData.width, height: imageData.height });
     // Copy the channel data byte-for-byte. pngjs expects Buffer-like with R,G,B,A interleaved.
     png.data = Buffer.from(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
     return PNG.sync.write(png);
   }

   /**
    * Walk the layer tree depth-first, flatten groups, drop hidden + clipping
    * layers. Returns flat array of {layer, depthFirstIndex} pairs.
    */
   function flattenLayerTree(
     children: ReadonlyArray<unknown>,
     out: Array<{ layer: Record<string, unknown>; index: number }> = [],
     counter = { i: 0 },
   ): Array<{ layer: Record<string, unknown>; index: number }> {
     for (const raw of children) {
       const layer = raw as Record<string, unknown>;
       if (layer.hidden === true) continue;
       if (layer.clipping === true) continue;
       if (Array.isArray(layer.children)) {
         flattenLayerTree(layer.children as ReadonlyArray<unknown>, out, counter);
         continue;
       }
       out.push({ layer, index: counter.i++ });
     }
     return out;
   }

   export async function parsePsd(buffer: Buffer): Promise<ParsedPsd> {
     if (!Buffer.isBuffer(buffer)) {
       throw new PsdParseError("parsePsd requires a Buffer");
     }
     if (buffer.byteLength > MAX_PSD_BYTES) {
       throw new PsdParseError(
         `PSD size ${buffer.byteLength} exceeds 100 MB cap (${MAX_PSD_BYTES})`,
       );
     }
     if (buffer.byteLength < 26) {
       throw new PsdParseError("PSD too small to be valid");
     }
     // Magic: '8BPS' at offset 0.
     if (
       buffer[0] !== 0x38 ||
       buffer[1] !== 0x42 ||
       buffer[2] !== 0x50 ||
       buffer[3] !== 0x53
     ) {
       throw new PsdParseError("could not parse PSD — bad signature");
     }

     // ag-psd needs ArrayBuffer (not Buffer). Slice gives us a fresh AB so the
     // underlying memory is owned by us and not surprised by the original buffer.
     let psd: ReturnType<typeof readPsd>;
     try {
       psd = readPsd(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), {
         skipLayerImageData: false,
         skipCompositeImageData: false,
         skipThumbnail: true,
         useImageData: true,
       });
     } catch (cause) {
       throw new PsdParseError("could not parse PSD — parser raised", cause);
     }

     const canvasWidth = psd.width ?? 0;
     const canvasHeight = psd.height ?? 0;
     if (canvasWidth <= 0 || canvasHeight <= 0) {
       throw new PsdParseError("could not parse PSD — missing canvas dimensions");
     }

     // Flat composite — ag-psd populates `psd.imageData` when useImageData=true.
     let flatPng: Buffer;
     try {
       const composite = (psd as { imageData?: { data: Uint8ClampedArray; width: number; height: number } }).imageData;
       if (!composite) {
         throw new PsdParseError("could not parse PSD — no composite image data");
       }
       flatPng = encodePngFromImageData(composite);
     } catch (cause) {
       if (cause instanceof PsdParseError) throw cause;
       throw new PsdParseError("could not parse PSD — flat-PNG encode failed", cause);
     }

     // Per-layer sprites.
     const layerOut: LayerSprite[] = [];
     const flatChildren = Array.isArray(psd.children) ? psd.children : [];
     const walk = flattenLayerTree(flatChildren);
     for (const { layer, index } of walk) {
       const layerImageData = (layer as { imageData?: { data: Uint8ClampedArray; width: number; height: number } }).imageData;
       if (!layerImageData || layerImageData.width === 0 || layerImageData.height === 0) continue;
       const png = encodePngFromImageData(layerImageData);
       layerOut.push({
         name: typeof layer.name === "string" ? layer.name : `Layer ${index + 1}`,
         bounds: {
           left: Number(layer.left ?? 0),
           top: Number(layer.top ?? 0),
           right: Number(layer.right ?? layerImageData.width),
           bottom: Number(layer.bottom ?? layerImageData.height),
         },
         png,
         index,
       });
     }

     return { flatPng, layers: layerOut, canvasWidth, canvasHeight };
   }
   ```

5. Verify `pngjs` is installed (used here + nowhere else in repo until now):

   ```bash
   grep -E '"pngjs"' apps/web/package.json || echo "absent — install"
   ```

   If absent, install:

   ```bash
   npm install --workspace apps/web pngjs
   npm install --workspace apps/web -D @types/pngjs
   ```

   Expected output:

   ```
   added 2 packages, ...
   ```

6. Run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/psd-parser.test.ts
   ```

   Expected: `Tests 6 passed (6)`.

7. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/psd-parser.ts apps/web/src/server/overlays/builder/psd-parser.test.ts apps/web/src/server/overlays/builder/__fixtures__/tiny.psd apps/web/package.json apps/web/package-lock.json package-lock.json
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2a): psd-parser wraps ag-psd into parsePsd()

   Pure-function parser: PSD bytes in → { flatPng, layers[], canvasWidth,
   canvasHeight } out. No Supabase, no filesystem, no network — leaf of
   the Wave 2A dependency tree.

   Hard cap 100 MB enforced (MAX_PSD_BYTES) with soft warn at 50 MB
   exposed as constant. Magic-byte check before invoking ag-psd so
   garbage inputs fail fast with PsdParseError. Encoding uses pngjs
   (pure JS) to keep the Vercel Functions runtime free of native deps.

   Layer-tree walk is depth-first; hidden + clipping layers are dropped
   so the picker UI only surfaces visible content. Each sprite carries
   bounds, name, depth-first index, and PNG bytes.

   Fixture `__fixtures__/tiny.psd` is a 2-layer 64x64 PSD generated via
   ag-psd's writePsd; generator was one-shot and deleted post-run.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 3: Server module `assets.ts` (CRUD + upload pipeline)

**Files:**

- Create: `apps/web/src/server/overlays/builder/assets.ts`
- Create: `apps/web/src/server/overlays/builder/assets.test.ts`

**Context:** This module owns the read + write surface for `overlay_user_assets` in the Wave 2A PSD subset. It does NOT replace the future Wave 1B `assets` module that handles plain image / font uploads — Wave 2A adds PSD-shaped writes. Other asset-type writes stay TODO for Wave 1B per spec §11.

The module exports five functions, every one taking `SupabaseClient` as the first arg per CLAUDE.md mock-friendly pattern:

| Function | Purpose |
|---|---|
| `uploadPsd(sb, input)` | Reads bytes + filename + ownerUserId, runs `parsePsd`, writes PSD + flat PNG + N layer sprites to storage + N+2 rows to `overlay_user_assets`. Returns `{ parentAssetId, flatAssetId, layerAssetIds, canvasWidth, canvasHeight }`. |
| `listPsdAssets(sb)` | Lists all non-deleted PSDs (`asset_type='psd'`) for the asset library UI. Returns `[{ id, originalFilename, width, height, sizeBytes, layerCount, flatAssetPath, createdAt }]`. |
| `listPsdLayers(sb, parentAssetId)` | Lists every sprite under a parent PSD. Returns `[{ id, psdLayerIndex, name, width, height, filePath }]`. Used by the layer-picker drawer. |
| `getAsset(sb, assetId)` | Single-row fetch. Returns the typed `Asset` shape with no soft-deleted rows. |
| `softDeleteAsset(sb, assetId)` | Sets `deleted_at=now()` on parent + cascades soft-delete to flat PNG + every layer sprite under the parent in one transaction. |

Mirrors `designs.ts` shape: snake_case at the DB boundary, camelCase at the function boundary via `rowToAsset()`. Soft-delete is the only delete mode.

#### Steps

1. Write the failing test first. Create `apps/web/src/server/overlays/builder/assets.test.ts`:

   ```ts
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { readFile } from "node:fs/promises";
   import path from "node:path";
   import {
     uploadPsd,
     listPsdAssets,
     listPsdLayers,
     getAsset,
     softDeleteAsset,
   } from "./assets";

   const TINY_PSD = path.join(__dirname, "__fixtures__", "tiny.psd");

   type Row = Record<string, unknown>;

   function makeMockSupabase() {
     const tables: Record<string, Row[]> = { overlay_user_assets: [] };
     const storage: Record<string, Buffer> = {};
     const sb: any = {
       from(table: string) {
         return {
           insert(rows: Row | Row[]) {
             const arr = Array.isArray(rows) ? rows : [rows];
             const inserted = arr.map((r) => ({
               id: r.id ?? `id-${tables[table].length + 1}`,
               created_at: new Date().toISOString(),
               updated_at: new Date().toISOString(),
               deleted_at: null,
               ...r,
             }));
             tables[table].push(...inserted);
             return {
               select: () => ({
                 maybeSingle: async () => ({ data: inserted[0], error: null }),
               }),
             };
           },
           select(_cols: string) {
             let filterFn: (r: Row) => boolean = () => true;
             const chain = {
               eq(col: string, val: unknown) {
                 const prev = filterFn;
                 filterFn = (r) => prev(r) && r[col] === val;
                 return chain;
               },
               is(col: string, val: unknown) {
                 const prev = filterFn;
                 filterFn = (r) => prev(r) && r[col] === val;
                 return chain;
               },
               order(_col: string, _opts: unknown) { return chain; },
               maybeSingle: async () => {
                 const hit = (tables[table] ?? []).filter(filterFn)[0] ?? null;
                 return { data: hit, error: null };
               },
               then: undefined as never,
             };
             // Make `await chain` return the filtered rows
             return new Proxy(chain, {
               get(target, prop) {
                 if (prop === "then") {
                   return (resolve: (v: { data: Row[]; error: null }) => void) =>
                     resolve({ data: (tables[table] ?? []).filter(filterFn), error: null });
                 }
                 return (target as any)[prop];
               },
             });
           },
           update(patch: Row) {
             let filterFn: (r: Row) => boolean = () => true;
             const chain = {
               eq(col: string, val: unknown) {
                 const prev = filterFn;
                 filterFn = (r) => prev(r) && r[col] === val;
                 return chain;
               },
               then: (resolve: (v: { data: null; error: null }) => void) => {
                 for (const r of tables[table] ?? []) {
                   if (filterFn(r)) Object.assign(r, patch);
                 }
                 return resolve({ data: null, error: null });
               },
             };
             return chain;
           },
         };
       },
       storage: {
         from(bucket: string) {
           return {
             upload: async (key: string, body: Buffer) => {
               storage[`${bucket}/${key}`] = body;
               return { data: { path: key }, error: null };
             },
             remove: async (keys: string[]) => {
               for (const k of keys) delete storage[`${bucket}/${k}`];
               return { data: null, error: null };
             },
           };
         },
       },
       __tables: tables,
       __storage: storage,
     };
     return sb;
   }

   describe("uploadPsd", () => {
     let sb: ReturnType<typeof makeMockSupabase>;
     beforeEach(() => { sb = makeMockSupabase(); });

     it("writes a parent PSD asset + flat PNG asset + N layer sprites", async () => {
       const bytes = await readFile(TINY_PSD);
       const result = await uploadPsd(sb, {
         bytes,
         filename: "tiny.psd",
         ownerUserId: "u-1",
       });
       expect(result.parentAssetId).toBeTruthy();
       expect(result.flatAssetId).toBeTruthy();
       expect(result.layerAssetIds.length).toBeGreaterThanOrEqual(2);
       expect(result.canvasWidth).toBeGreaterThan(0);
       expect(result.canvasHeight).toBeGreaterThan(0);

       const rows = sb.__tables.overlay_user_assets;
       expect(rows.length).toBe(2 + result.layerAssetIds.length);
       const parent = rows.find((r) => r.id === result.parentAssetId);
       expect(parent).toMatchObject({
         asset_type: "psd",
         mime_type: "image/vnd.adobe.photoshop",
         flat_png_asset_id: result.flatAssetId,
       });
       const flat = rows.find((r) => r.id === result.flatAssetId);
       expect(flat).toMatchObject({
         asset_type: "image",
         psd_parent_asset_id: result.parentAssetId,
       });
       for (const layerId of result.layerAssetIds) {
         const sprite = rows.find((r) => r.id === layerId);
         expect(sprite).toMatchObject({
           asset_type: "image",
           psd_parent_asset_id: result.parentAssetId,
         });
         expect(sprite!.psd_layer_index).toBeTypeOf("number");
       }
     });

     it("writes every byte payload into storage under psd/<uuid> keys", async () => {
       const bytes = await readFile(TINY_PSD);
       const result = await uploadPsd(sb, {
         bytes,
         filename: "tiny.psd",
         ownerUserId: "u-1",
       });
       const psdKeys = Object.keys(sb.__storage).filter((k) =>
         k.startsWith("overlay-user-assets/psd/"),
       );
       expect(psdKeys.length).toBe(2 + result.layerAssetIds.length);
       expect(psdKeys.some((k) => k.endsWith(".psd"))).toBe(true);
       expect(psdKeys.some((k) => k.endsWith("-flat.png"))).toBe(true);
       expect(psdKeys.filter((k) => /-layer-\d+\.png$/.test(k)).length).toBe(
         result.layerAssetIds.length,
       );
     });

     it("rejects bytes > MAX_PSD_BYTES", async () => {
       const huge = Buffer.alloc(101 * 1024 * 1024, 0);
       await expect(
         uploadPsd(sb, { bytes: huge, filename: "huge.psd", ownerUserId: "u-1" }),
       ).rejects.toThrow(/exceeds 100/i);
     });

     it("rejects non-PSD MIME / extension", async () => {
       await expect(
         uploadPsd(sb, {
           bytes: Buffer.from("not a psd"),
           filename: "bad.png",
           ownerUserId: "u-1",
         }),
       ).rejects.toThrow(/extension/i);
     });

     it("wraps parsePsd failures into PsdUploadError without writing partial rows", async () => {
       const garbage = Buffer.from([0x38, 0x42, 0x50, 0x53, 0xff, 0xff, 0xff, 0xff]);
       await expect(
         uploadPsd(sb, { bytes: garbage, filename: "broken.psd", ownerUserId: "u-1" }),
       ).rejects.toMatchObject({ name: "PsdUploadError" });
       expect(sb.__tables.overlay_user_assets.length).toBe(0);
     });
   });

   describe("listPsdAssets", () => {
     it("returns rows with layerCount aggregated from sprites", async () => {
       const sb = makeMockSupabase();
       const bytes = await readFile(TINY_PSD);
       await uploadPsd(sb, { bytes, filename: "tiny.psd", ownerUserId: "u-1" });
       const list = await listPsdAssets(sb);
       expect(list.length).toBe(1);
       expect(list[0]).toMatchObject({
         originalFilename: "tiny.psd",
         layerCount: expect.any(Number),
       });
       expect(list[0].layerCount).toBeGreaterThanOrEqual(2);
     });

     it("excludes soft-deleted rows", async () => {
       const sb = makeMockSupabase();
       const bytes = await readFile(TINY_PSD);
       const r = await uploadPsd(sb, { bytes, filename: "tiny.psd", ownerUserId: "u-1" });
       await softDeleteAsset(sb, r.parentAssetId);
       const list = await listPsdAssets(sb);
       expect(list).toHaveLength(0);
     });
   });

   describe("listPsdLayers", () => {
     it("returns every layer sprite for a parent PSD ordered by psd_layer_index", async () => {
       const sb = makeMockSupabase();
       const bytes = await readFile(TINY_PSD);
       const r = await uploadPsd(sb, { bytes, filename: "tiny.psd", ownerUserId: "u-1" });
       const layers = await listPsdLayers(sb, r.parentAssetId);
       expect(layers.length).toBe(r.layerAssetIds.length);
       for (let i = 1; i < layers.length; i++) {
         expect(layers[i].psdLayerIndex).toBeGreaterThanOrEqual(layers[i - 1].psdLayerIndex);
       }
     });
   });

   describe("getAsset / softDeleteAsset", () => {
     it("getAsset returns null for unknown id", async () => {
       const sb = makeMockSupabase();
       const a = await getAsset(sb, "nope");
       expect(a).toBeNull();
     });

     it("softDeleteAsset cascades to flat PNG + every sprite under the parent", async () => {
       const sb = makeMockSupabase();
       const bytes = await readFile(TINY_PSD);
       const r = await uploadPsd(sb, { bytes, filename: "tiny.psd", ownerUserId: "u-1" });
       await softDeleteAsset(sb, r.parentAssetId);
       const rows = sb.__tables.overlay_user_assets;
       expect(rows.every((row) => row.deleted_at !== null)).toBe(true);
     });
   });
   ```

2. Run the test — expect FAIL (module doesn't exist):

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/assets.test.ts
   ```

   Expected: `Cannot find module './assets'`.

3. Author the module. Create `apps/web/src/server/overlays/builder/assets.ts`:

   ```ts
   /**
    * Overlay Builder Wave 2A — Asset CRUD (PSD subset).
    *
    * Owns the read + write surface for `overlay_user_assets` rows of
    * type `psd` plus the per-layer + flat-PNG sprites those uploads
    * spawn (asset_type='image' with psd_parent_asset_id set).
    *
    * Mirrors the SupabaseClient-first signature pattern from
    * `designs.ts` + `scenes.ts`. Snake-case at the DB boundary,
    * camelCase at the public boundary via `rowToAsset()`.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §3.4 + §9 + §10
    */

   import type { SupabaseClient } from "@supabase/supabase-js";
   import { parsePsd, MAX_PSD_BYTES, PsdParseError } from "./psd-parser";

   const BUCKET = "overlay-user-assets";
   const PSD_MIME = "image/vnd.adobe.photoshop";
   const PNG_MIME = "image/png";

   export class PsdUploadError extends Error {
     constructor(message: string, cause?: unknown) {
       super(message);
       this.name = "PsdUploadError";
       if (cause) (this as { cause?: unknown }).cause = cause;
     }
   }

   export type AssetType = "image" | "psd" | "font";

   export type Asset = {
     id: string;
     assetType: AssetType;
     filePath: string;
     mimeType: string;
     originalFilename: string;
     width: number | null;
     height: number | null;
     sizeBytes: number;
     ownerUserId: string | null;
     psdLayerIndex: number | null;
     psdParentAssetId: string | null;
     flatPngAssetId: string | null;
     createdAt: string;
     deletedAt: string | null;
   };

   export type PsdAssetSummary = {
     id: string;
     originalFilename: string;
     width: number | null;
     height: number | null;
     sizeBytes: number;
     layerCount: number;
     flatAssetPath: string | null;
     createdAt: string;
   };

   export type PsdLayerSummary = {
     id: string;
     psdLayerIndex: number;
     name: string;
     filePath: string;
     width: number | null;
     height: number | null;
   };

   export type UploadPsdInput = {
     bytes: Buffer;
     filename: string;
     ownerUserId: string;
   };

   export type UploadPsdResult = {
     parentAssetId: string;
     flatAssetId: string;
     layerAssetIds: string[];
     canvasWidth: number;
     canvasHeight: number;
   };

   type AssetRow = {
     id: string;
     asset_type: AssetType;
     file_path: string;
     mime_type: string;
     original_filename: string;
     width: number | null;
     height: number | null;
     size_bytes: number;
     owner_user_id: string | null;
     psd_layer_index: number | null;
     psd_parent_asset_id: string | null;
     flat_png_asset_id: string | null;
     created_at: string;
     deleted_at: string | null;
   };

   function rowToAsset(r: AssetRow): Asset {
     return {
       id: r.id,
       assetType: r.asset_type,
       filePath: r.file_path,
       mimeType: r.mime_type,
       originalFilename: r.original_filename,
       width: r.width,
       height: r.height,
       sizeBytes: r.size_bytes,
       ownerUserId: r.owner_user_id,
       psdLayerIndex: r.psd_layer_index,
       psdParentAssetId: r.psd_parent_asset_id,
       flatPngAssetId: r.flat_png_asset_id,
       createdAt: r.created_at,
       deletedAt: r.deleted_at,
     };
   }

   function newUuid(): string {
     // crypto.randomUUID is available in Node 18+
     return globalThis.crypto.randomUUID();
   }

   /**
    * Upload a PSD: writes bytes to storage, parses, writes flat PNG +
    * per-layer sprites to storage, writes N+2 rows to overlay_user_assets.
    *
    * If parsing fails or any storage / DB write fails, attempts a
    * best-effort rollback of partial storage objects (no transactional
    * guarantees across storage + DB — admin-team-only surface, so
    * occasional orphan blobs are acceptable; the soft-delete cascade
    * cleans them up).
    */
   export async function uploadPsd(
     sb: SupabaseClient,
     input: UploadPsdInput,
   ): Promise<UploadPsdResult> {
     if (!input.filename.toLowerCase().endsWith(".psd")) {
       throw new PsdUploadError(`bad extension: ${input.filename}`);
     }
     if (input.bytes.byteLength > MAX_PSD_BYTES) {
       throw new PsdUploadError(
         `PSD size ${input.bytes.byteLength} exceeds 100 MB cap`,
       );
     }

     let parsed: Awaited<ReturnType<typeof parsePsd>>;
     try {
       parsed = await parsePsd(input.bytes);
     } catch (cause) {
       if (cause instanceof PsdParseError) {
         throw new PsdUploadError(cause.message, cause);
       }
       throw new PsdUploadError("could not parse PSD", cause);
     }

     const parentId = newUuid();
     const flatId = newUuid();
     const layerIds = parsed.layers.map(() => newUuid());

     const psdKey = `psd/${parentId}.psd`;
     const flatKey = `psd/${parentId}-flat.png`;
     const layerKeys = parsed.layers.map((_, n) => `psd/${parentId}-layer-${n}.png`);

     const writtenKeys: string[] = [];
     try {
       // Storage writes first; if one fails we roll back the previous ones.
       const u1 = await sb.storage.from(BUCKET).upload(psdKey, input.bytes, {
         contentType: PSD_MIME,
         upsert: false,
       } as never);
       if (u1.error) throw u1.error;
       writtenKeys.push(psdKey);

       const u2 = await sb.storage.from(BUCKET).upload(flatKey, parsed.flatPng, {
         contentType: PNG_MIME,
         upsert: false,
       } as never);
       if (u2.error) throw u2.error;
       writtenKeys.push(flatKey);

       for (let i = 0; i < parsed.layers.length; i++) {
         const uN = await sb.storage.from(BUCKET).upload(layerKeys[i], parsed.layers[i].png, {
           contentType: PNG_MIME,
           upsert: false,
         } as never);
         if (uN.error) throw uN.error;
         writtenKeys.push(layerKeys[i]);
       }
     } catch (cause) {
       // Roll back any partial uploads.
       if (writtenKeys.length > 0) {
         await sb.storage.from(BUCKET).remove(writtenKeys).catch(() => undefined);
       }
       throw new PsdUploadError("storage write failed", cause);
     }

     // DB writes. Order matters: insert flat + layer sprites first (their
     // ids are referenced by the parent row), then the parent. We could
     // do this in one .insert([...]) — splitting it keeps the rollback
     // window narrow and the error messages clearer.
     try {
       const flatRow: Partial<AssetRow> = {
         id: flatId,
         asset_type: "image",
         file_path: flatKey,
         mime_type: PNG_MIME,
         original_filename: `${input.filename}.flat.png`,
         width: parsed.canvasWidth,
         height: parsed.canvasHeight,
         size_bytes: parsed.flatPng.byteLength,
         owner_user_id: input.ownerUserId,
         psd_parent_asset_id: parentId,
         psd_layer_index: null,
       };
       const flatInsert = await sb.from("overlay_user_assets").insert(flatRow).select("id").maybeSingle();
       if (flatInsert.error) throw flatInsert.error;

       for (let i = 0; i < parsed.layers.length; i++) {
         const layer = parsed.layers[i];
         const layerWidth = layer.bounds.right - layer.bounds.left;
         const layerHeight = layer.bounds.bottom - layer.bounds.top;
         const layerRow: Partial<AssetRow> = {
           id: layerIds[i],
           asset_type: "image",
           file_path: layerKeys[i],
           mime_type: PNG_MIME,
           original_filename: `${layer.name || `Layer ${i + 1}`}.png`,
           width: layerWidth > 0 ? layerWidth : null,
           height: layerHeight > 0 ? layerHeight : null,
           size_bytes: layer.png.byteLength,
           owner_user_id: input.ownerUserId,
           psd_parent_asset_id: parentId,
           psd_layer_index: layer.index,
         };
         const ins = await sb.from("overlay_user_assets").insert(layerRow).select("id").maybeSingle();
         if (ins.error) throw ins.error;
       }

       const parentRow: Partial<AssetRow> = {
         id: parentId,
         asset_type: "psd",
         file_path: psdKey,
         mime_type: PSD_MIME,
         original_filename: input.filename,
         width: parsed.canvasWidth,
         height: parsed.canvasHeight,
         size_bytes: input.bytes.byteLength,
         owner_user_id: input.ownerUserId,
         flat_png_asset_id: flatId,
         psd_parent_asset_id: null,
         psd_layer_index: null,
       };
       const parentInsert = await sb.from("overlay_user_assets").insert(parentRow).select("id").maybeSingle();
       if (parentInsert.error) throw parentInsert.error;
     } catch (cause) {
       // Best-effort cleanup of storage + DB. We rely on soft-delete cascade
       // for any rows that did land — better to leak a blob than to leave
       // orphans in the DB pointing at deleted storage.
       await sb.storage.from(BUCKET).remove(writtenKeys).catch(() => undefined);
       await sb
         .from("overlay_user_assets")
         .update({ deleted_at: new Date().toISOString() })
         .eq("psd_parent_asset_id", parentId)
         .catch(() => undefined);
       await sb
         .from("overlay_user_assets")
         .update({ deleted_at: new Date().toISOString() })
         .eq("id", parentId)
         .catch(() => undefined);
       throw new PsdUploadError("DB write failed", cause);
     }

     return {
       parentAssetId: parentId,
       flatAssetId: flatId,
       layerAssetIds: layerIds,
       canvasWidth: parsed.canvasWidth,
       canvasHeight: parsed.canvasHeight,
     };
   }

   /**
    * List all non-deleted PSD parent rows with the layer-count aggregated
    * from sibling sprites. Used by the asset-library UI.
    */
   export async function listPsdAssets(sb: SupabaseClient): Promise<PsdAssetSummary[]> {
     const { data: parents, error: pErr } = await sb
       .from("overlay_user_assets")
       .select("id, original_filename, width, height, size_bytes, flat_png_asset_id, created_at, deleted_at")
       .eq("asset_type", "psd")
       .is("deleted_at", null)
       .order("created_at", { ascending: false });
     if (pErr) throw pErr;
     const out: PsdAssetSummary[] = [];
     for (const row of (parents as AssetRow[]) ?? []) {
       const { data: sprites, error: sErr } = await sb
         .from("overlay_user_assets")
         .select("id")
         .eq("psd_parent_asset_id", row.id)
         .eq("asset_type", "image")
         .is("deleted_at", null);
       if (sErr) throw sErr;
       const flatPath = row.flat_png_asset_id
         ? await (async () => {
             const { data: flat } = await sb
               .from("overlay_user_assets")
               .select("file_path")
               .eq("id", row.flat_png_asset_id)
               .maybeSingle();
             return (flat as { file_path: string } | null)?.file_path ?? null;
           })()
         : null;
       // Layer count = sprites under parent minus 1 (the flat PNG counts as a sibling).
       const layerCount = Math.max(0, ((sprites as unknown[]) ?? []).length - 1);
       out.push({
         id: row.id,
         originalFilename: row.original_filename,
         width: row.width,
         height: row.height,
         sizeBytes: row.size_bytes,
         layerCount,
         flatAssetPath: flatPath,
         createdAt: row.created_at,
       });
     }
     return out;
   }

   /**
    * List every per-layer sprite (excluding the flat PNG) for a parent PSD,
    * ordered by psd_layer_index ASC.
    */
   export async function listPsdLayers(
     sb: SupabaseClient,
     parentAssetId: string,
   ): Promise<PsdLayerSummary[]> {
     const { data, error } = await sb
       .from("overlay_user_assets")
       .select("id, psd_layer_index, original_filename, file_path, width, height, deleted_at")
       .eq("psd_parent_asset_id", parentAssetId)
       .eq("asset_type", "image")
       .is("deleted_at", null)
       .order("psd_layer_index", { ascending: true });
     if (error) throw error;
     return ((data as AssetRow[]) ?? [])
       .filter((r) => r.psd_layer_index !== null)
       .map((r) => ({
         id: r.id,
         psdLayerIndex: r.psd_layer_index as number,
         name: r.original_filename.replace(/\.png$/, ""),
         filePath: r.file_path,
         width: r.width,
         height: r.height,
       }));
   }

   export async function getAsset(sb: SupabaseClient, assetId: string): Promise<Asset | null> {
     const { data, error } = await sb
       .from("overlay_user_assets")
       .select("*")
       .eq("id", assetId)
       .is("deleted_at", null)
       .maybeSingle();
     if (error) throw error;
     if (!data) return null;
     return rowToAsset(data as AssetRow);
   }

   export async function softDeleteAsset(sb: SupabaseClient, assetId: string): Promise<void> {
     const stamp = new Date().toISOString();
     // Cascade: soft-delete sprites + flat PNG first (parent_asset_id match), then the parent row.
     {
       const { error } = await sb
         .from("overlay_user_assets")
         .update({ deleted_at: stamp })
         .eq("psd_parent_asset_id", assetId);
       if (error) throw error;
     }
     {
       const { error } = await sb
         .from("overlay_user_assets")
         .update({ deleted_at: stamp })
         .eq("id", assetId);
       if (error) throw error;
     }
   }
   ```

4. Run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/assets.test.ts
   ```

   Expected: `Tests 7 passed (7)`.

5. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/assets.ts apps/web/src/server/overlays/builder/assets.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2a): assets module — PSD upload + layer/parent CRUD

   Adds the read+write surface for `overlay_user_assets` rows of
   asset_type='psd' plus the per-layer + flat-PNG sprites the upload
   pipeline spawns.

   Exports (all SupabaseClient-first per CLAUDE.md mock-friendly pattern):
     - uploadPsd       — parses PSD via psd-parser, writes N+2 rows + N+2
                         storage objects, best-effort rollback on failure
     - listPsdAssets   — asset-library cards with layer-count aggregate
     - listPsdLayers   — per-PSD sprite list for the layer picker drawer
     - getAsset        — single-row fetch, null on soft-delete
     - softDeleteAsset — cascade soft-delete parent + sprites + flat PNG

   PsdUploadError wraps every failure mode (bad extension, size cap,
   parse failure, storage error, DB error) so the action layer can
   surface one friendly message to the editor UI.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 4: Server action `uploadPsdAction`

**Files:**

- Create: `apps/web/src/app/admin/broadcast/v2/builder/assets-actions.ts`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/assets-schemas.ts`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/assets-actions.test.ts`

**Context:** Mirrors the gate + rate-limit + perm-check pattern from `actions.ts` (Wave 1A). Splits sync schemas into a sibling `assets-schemas.ts` per CLAUDE.md §10 (server-action files export ONLY async functions).

The action accepts `FormData` with two fields:
- `file` (File) — the PSD blob
- `ownerUserId` (string) — pulled from `gate()`'s actor, not the form; included here only as a contract reminder.

Returns `{ ok: true, parentAssetId, flatAssetId, layerAssetIds, canvasWidth, canvasHeight }` on success or `{ ok: false, error: string, code: string }` on failure (so the client can show actionable messages without crashing).

#### Steps

1. Create the sibling schemas file. `apps/web/src/app/admin/broadcast/v2/builder/assets-schemas.ts`:

   ```ts
   import { z } from "zod";
   import { MAX_PSD_BYTES, SOFT_WARN_PSD_BYTES } from "@/server/overlays/builder/psd-parser";

   /**
    * Wave 2A — Zod + types for asset-upload server action.
    *
    * Per CLAUDE.md §10 this file is NOT 'use server'. Sync exports only.
    */

   export const UploadPsdResultSchema = z.object({
     ok: z.literal(true),
     parentAssetId: z.string().uuid(),
     flatAssetId: z.string().uuid(),
     layerAssetIds: z.array(z.string().uuid()),
     canvasWidth: z.number().int().positive(),
     canvasHeight: z.number().int().positive(),
     softWarnLarge: z.boolean(),
   });

   export const UploadPsdErrorSchema = z.object({
     ok: z.literal(false),
     error: z.string(),
     code: z.enum([
       "missing_file",
       "bad_extension",
       "too_large",
       "parse_failed",
       "storage_failed",
       "db_failed",
       "forbidden",
       "rate_limited",
       "unknown",
     ]),
   });

   export const UploadPsdResponseSchema = z.discriminatedUnion("ok", [
     UploadPsdResultSchema,
     UploadPsdErrorSchema,
   ]);

   export type UploadPsdResponse = z.infer<typeof UploadPsdResponseSchema>;

   export { MAX_PSD_BYTES, SOFT_WARN_PSD_BYTES };
   ```

2. Write the failing action test. Create `apps/web/src/app/admin/broadcast/v2/builder/assets-actions.test.ts`:

   ```ts
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { readFile } from "node:fs/promises";
   import path from "node:path";

   const TINY_PSD = path.join(
     __dirname,
     "..",
     "..",
     "..",
     "..",
     "..",
     "server",
     "overlays",
     "builder",
     "__fixtures__",
     "tiny.psd",
   );

   const gateMock = vi.fn();
   const uploadPsdMock = vi.fn();

   vi.mock("./assets-actions-gate", () => ({
     gate: gateMock,
   }));
   vi.mock("@/server/overlays/builder/assets", () => ({
     uploadPsd: (...args: unknown[]) => uploadPsdMock(...args),
     PsdUploadError: class PsdUploadError extends Error {
       constructor(msg: string) {
         super(msg);
         this.name = "PsdUploadError";
       }
     },
   }));

   import { uploadPsdAction } from "./assets-actions";

   describe("uploadPsdAction", () => {
     beforeEach(() => {
       gateMock.mockReset();
       uploadPsdMock.mockReset();
       gateMock.mockResolvedValue({
         sb: { __mock: true } as never,
         actor: { userId: "u-1", roles: ["admin"] },
       });
       uploadPsdMock.mockResolvedValue({
         parentAssetId: "00000000-0000-4000-8000-000000000001",
         flatAssetId: "00000000-0000-4000-8000-000000000002",
         layerAssetIds: ["00000000-0000-4000-8000-000000000003"],
         canvasWidth: 64,
         canvasHeight: 64,
       });
     });

     it("returns ok:true with parent + flat + layer ids on happy path", async () => {
       const fd = new FormData();
       const bytes = await readFile(TINY_PSD);
       fd.append("file", new File([bytes], "tiny.psd", { type: "image/vnd.adobe.photoshop" }));
       const res = await uploadPsdAction(fd);
       expect(res.ok).toBe(true);
       if (res.ok) {
         expect(res.parentAssetId).toBeTruthy();
         expect(res.layerAssetIds).toHaveLength(1);
         expect(res.softWarnLarge).toBe(false);
       }
     });

     it("returns ok:false code=missing_file when no file in FormData", async () => {
       const res = await uploadPsdAction(new FormData());
       expect(res.ok).toBe(false);
       if (!res.ok) {
         expect(res.code).toBe("missing_file");
       }
     });

     it("returns ok:false code=bad_extension when filename does not end in .psd", async () => {
       const fd = new FormData();
       fd.append("file", new File([Buffer.from("bytes")], "tiny.png", { type: "image/png" }));
       const res = await uploadPsdAction(fd);
       expect(res.ok).toBe(false);
       if (!res.ok) {
         expect(res.code).toBe("bad_extension");
       }
     });

     it("returns ok:false code=too_large for files > 100 MB without invoking uploadPsd", async () => {
       const fd = new FormData();
       const huge = Buffer.alloc(101 * 1024 * 1024, 0);
       fd.append("file", new File([huge], "huge.psd", { type: "image/vnd.adobe.photoshop" }));
       const res = await uploadPsdAction(fd);
       expect(res.ok).toBe(false);
       if (!res.ok) {
         expect(res.code).toBe("too_large");
       }
       expect(uploadPsdMock).not.toHaveBeenCalled();
     });

     it("returns ok:true with softWarnLarge=true for files > 50 MB but <= 100 MB", async () => {
       const fd = new FormData();
       const mid = Buffer.alloc(60 * 1024 * 1024, 0);
       fd.append("file", new File([mid], "mid.psd", { type: "image/vnd.adobe.photoshop" }));
       const res = await uploadPsdAction(fd);
       expect(res.ok).toBe(true);
       if (res.ok) {
         expect(res.softWarnLarge).toBe(true);
       }
     });

     it("returns ok:false code=parse_failed when uploadPsd throws PsdUploadError", async () => {
       uploadPsdMock.mockRejectedValueOnce(
         Object.assign(new Error("could not parse PSD"), { name: "PsdUploadError" }),
       );
       const fd = new FormData();
       fd.append("file", new File([Buffer.from("not a psd")], "broken.psd", { type: "image/vnd.adobe.photoshop" }));
       const res = await uploadPsdAction(fd);
       expect(res.ok).toBe(false);
       if (!res.ok) {
         expect(res.code).toBe("parse_failed");
       }
     });

     it("returns ok:false code=forbidden when gate throws Forbidden", async () => {
       gateMock.mockRejectedValueOnce(new Error("Forbidden: missing overlay.design.manage"));
       const fd = new FormData();
       fd.append("file", new File([Buffer.from("x")], "tiny.psd", { type: "image/vnd.adobe.photoshop" }));
       const res = await uploadPsdAction(fd);
       expect(res.ok).toBe(false);
       if (!res.ok) {
         expect(res.code).toBe("forbidden");
       }
     });

     it("returns ok:false code=rate_limited when gate throws rate_limited", async () => {
       gateMock.mockRejectedValueOnce(new Error("rate_limited"));
       const fd = new FormData();
       fd.append("file", new File([Buffer.from("x")], "tiny.psd", { type: "image/vnd.adobe.photoshop" }));
       const res = await uploadPsdAction(fd);
       expect(res.ok).toBe(false);
       if (!res.ok) {
         expect(res.code).toBe("rate_limited");
       }
     });
   });
   ```

3. The test depends on a shared gate helper. Refactor: extract the existing `gate()` from Wave 1A `actions.ts` into a new sibling so both `actions.ts` + `assets-actions.ts` import it.

   Create `apps/web/src/app/admin/broadcast/v2/builder/assets-actions-gate.ts`:

   ```ts
   import "server-only";
   import { redirect } from "next/navigation";
   import { getServerSupabase } from "@/lib/supabase/server";
   import { getServiceRoleSupabase } from "@/lib/supabase/service";
   import { requirePermAsync, PermissionError } from "@/lib/perms-db";
   import { enforceAuthedWrite } from "@/lib/api-rate-limit";

   /**
    * Wave 2A — shared gate for builder asset-upload actions.
    *
    * Same logic as the Wave 1A `gate()` inside actions.ts, lifted to a
    * sibling module so both action files share one implementation.
    *
    * Per CLAUDE.md §10 this file is NOT marked 'use server' because it
    * exports a sync `gate()` factory that is invoked by 'use server'
    * action files. It IS marked 'server-only' so the bundler refuses
    * to ship it to the client.
    */

   export type Actor = { userId: string; roles: readonly string[] };

   export type GateResult = {
     sb: ReturnType<typeof getServiceRoleSupabase>;
     actor: Actor;
   };

   export async function gate(): Promise<GateResult> {
     const userClient = await getServerSupabase();
     const { data: auth } = await userClient.auth.getUser();
     if (!auth?.user) redirect("/login");
     const { data: pub } = await userClient
       .from("users")
       .select("id")
       .eq("supabase_auth_id", auth.user.id)
       .maybeSingle();
     if (!pub) redirect("/login");
     const { data: roleRows } = await userClient
       .from("user_roles")
       .select("role")
       .eq("user_id", pub.id)
       .is("deleted_at", null);
     const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
     const sb = getServiceRoleSupabase();
     try {
       await requirePermAsync(sb, { userId: pub.id, roles }, "overlay.design.manage");
     } catch (e) {
       if (e instanceof PermissionError) {
         throw new Error("Forbidden: missing overlay.design.manage");
       }
       throw e;
     }
     const limited = await enforceAuthedWrite(pub.id);
     if (limited) throw new Error("rate_limited");
     return { sb, actor: { userId: pub.id, roles } };
   }
   ```

   Also update the Wave 1A `actions.ts` to import from this shared module instead of inlining the helper:

   Edit `apps/web/src/app/admin/broadcast/v2/builder/actions.ts` — replace the local `gate()` function definition (lines ~33-73 per Wave 1A plan) with:

   ```ts
   import { gate } from "./assets-actions-gate";
   ```

   and delete the inlined helper. Keep every other line in the file untouched. Verify no behavior change by re-running the existing action tests:

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/actions.test.ts
   ```

   Expected: existing tests still pass (refactor is behavior-preserving).

4. Run the new action test — expect FAIL (action doesn't exist):

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/assets-actions.test.ts
   ```

   Expected: `Cannot find module './assets-actions'`.

5. Author the action. Create `apps/web/src/app/admin/broadcast/v2/builder/assets-actions.ts`:

   ```ts
   "use server";

   import { revalidatePath } from "next/cache";
   import { uploadPsd, PsdUploadError } from "@/server/overlays/builder/assets";
   import { gate } from "./assets-actions-gate";
   import {
     MAX_PSD_BYTES,
     SOFT_WARN_PSD_BYTES,
     type UploadPsdResponse,
   } from "./assets-schemas";

   /**
    * Wave 2A — admin server action: upload a PSD.
    *
    * Form fields:
    *   - file (File) — required, .psd extension, <= 100 MB.
    *
    * Returns a discriminated-union response so the client can switch on
    * `res.ok` without throwing. Codes map 1:1 to the surfaces the UI
    * needs to handle (missing_file, bad_extension, too_large,
    * parse_failed, storage_failed, db_failed, forbidden, rate_limited).
    *
    * Synchronous parse: ag-psd in-process inside the action. For files
    * up to 100 MB this completes in <30 s on Vercel Functions cold-start;
    * a future Wave 2B may push parsing to a queued background worker.
    */
   export async function uploadPsdAction(formData: FormData): Promise<UploadPsdResponse> {
     let actorBox: Awaited<ReturnType<typeof gate>>;
     try {
       actorBox = await gate();
     } catch (e) {
       const msg = e instanceof Error ? e.message : String(e);
       if (/^Forbidden/.test(msg)) {
         return { ok: false, code: "forbidden", error: msg };
       }
       if (/rate_limited/.test(msg)) {
         return { ok: false, code: "rate_limited", error: "Too many writes; slow down." };
       }
       return { ok: false, code: "unknown", error: msg };
     }
     const { sb, actor } = actorBox;

     const file = formData.get("file");
     if (!(file instanceof File)) {
       return { ok: false, code: "missing_file", error: "Form field `file` is required" };
     }
     if (!file.name.toLowerCase().endsWith(".psd")) {
       return { ok: false, code: "bad_extension", error: `Expected .psd, got ${file.name}` };
     }
     if (file.size > MAX_PSD_BYTES) {
       return {
         ok: false,
         code: "too_large",
         error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max 100 MB`,
       };
     }

     // Pull bytes server-side; File.arrayBuffer is safe inside server actions.
     let bytes: Buffer;
     try {
       const ab = await file.arrayBuffer();
       bytes = Buffer.from(ab);
     } catch (cause) {
       return {
         ok: false,
         code: "unknown",
         error: cause instanceof Error ? cause.message : "could not read upload",
       };
     }

     try {
       const r = await uploadPsd(sb, {
         bytes,
         filename: file.name,
         ownerUserId: actor.userId,
       });
       revalidatePath("/admin/broadcast/v2/builder/assets");
       return {
         ok: true,
         parentAssetId: r.parentAssetId,
         flatAssetId: r.flatAssetId,
         layerAssetIds: r.layerAssetIds,
         canvasWidth: r.canvasWidth,
         canvasHeight: r.canvasHeight,
         softWarnLarge: file.size > SOFT_WARN_PSD_BYTES,
       };
     } catch (cause) {
       if (cause instanceof PsdUploadError) {
         // PsdUploadError messages cover three classes: parse, storage, DB.
         // We map to the most precise code we can infer from the message.
         const msg = cause.message ?? "PSD upload failed";
         const code: UploadPsdResponse extends { code: infer C } ? C : never =
           /storage/i.test(msg)
             ? "storage_failed"
             : /db|insert|database/i.test(msg)
             ? "db_failed"
             : "parse_failed";
         return { ok: false, code, error: msg } as UploadPsdResponse;
       }
       return {
         ok: false,
         code: "unknown",
         error: cause instanceof Error ? cause.message : "PSD upload failed",
       };
     }
   }
   ```

6. Run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/assets-actions.test.ts
   ```

   Expected: `Tests 8 passed (8)`.

7. Stage and commit:

   ```bash
   git add apps/web/src/app/admin/broadcast/v2/builder/assets-actions.ts apps/web/src/app/admin/broadcast/v2/builder/assets-actions.test.ts apps/web/src/app/admin/broadcast/v2/builder/assets-actions-gate.ts apps/web/src/app/admin/broadcast/v2/builder/assets-schemas.ts apps/web/src/app/admin/broadcast/v2/builder/actions.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2a): uploadPsdAction server action

   New server action `uploadPsdAction(formData)` accepts a PSD File,
   perm-gates on overlay.design.manage, rate-limits via enforceAuthedWrite,
   validates filename + size, runs the assets.ts pipeline, and returns
   a discriminated-union response { ok, ... } | { ok:false, code, error }
   so the editor UI can switch on code without throwing.

   Sibling refactor: lifted Wave 1A's inline gate() helper into
   assets-actions-gate.ts so both actions.ts + assets-actions.ts share
   one implementation. Behavior-preserving — existing Wave 1A action
   tests stay green post-refactor.

   Sync schemas + types in assets-schemas.ts per CLAUDE.md §10.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 5: Asset library page `/admin/broadcast/v2/builder/assets`

**Files:**

- Create: `apps/web/src/app/admin/broadcast/v2/builder/assets/page.tsx`
- Create: `apps/web/src/components/admin/builder/AssetsLibrary.tsx`
- Create: `apps/web/src/components/admin/builder/AssetsLibrary.test.tsx`

**Context:** Spec §10 — `/admin/broadcast/v2/builder/assets` lists assets by type. Wave 2A only ships the PSD tab; image / font tabs are stubbed with "Coming in Wave 1B" copy so navigation feels complete. PSD tab includes drag-drop area + per-card layer count + soft-delete button.

#### Steps

1. Create the page wrapper. `apps/web/src/app/admin/broadcast/v2/builder/assets/page.tsx`:

   ```tsx
   import { notFound, redirect } from "next/navigation";
   import { getServerSupabase } from "@/lib/supabase/server";
   import { getServiceRoleSupabase } from "@/lib/supabase/service";
   import { requirePermAsync, PermissionError } from "@/lib/perms-db";
   import { listPsdAssets } from "@/server/overlays/builder/assets";
   import { AssetsLibrary } from "@/components/admin/builder/AssetsLibrary";
   import { featureFlags } from "@/lib/feature-flags";

   export const dynamic = "force-dynamic";

   /**
    * Wave 2A — `/admin/broadcast/v2/builder/assets` library page.
    *
    * Perm-gates on overlay.design.manage. Currently lists PSD assets only;
    * image + font tabs ship in Wave 1B with their own server-side reads.
    */

   async function resolveAdmin() {
     const userClient = await getServerSupabase();
     const { data: auth } = await userClient.auth.getUser();
     if (!auth.user) redirect("/login?next=/admin/broadcast/v2/builder/assets");
     const { data: pub } = await userClient
       .from("users")
       .select("id")
       .eq("supabase_auth_id", auth.user.id)
       .maybeSingle();
     if (!pub) redirect("/login?next=/admin/broadcast/v2/builder/assets");
     const { data: roleRows } = await userClient
       .from("user_roles")
       .select("role")
       .eq("user_id", pub.id)
       .is("deleted_at", null);
     const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
     const sb = getServiceRoleSupabase();
     try {
       await requirePermAsync(sb, { userId: pub.id, roles }, "overlay.design.manage");
     } catch (err) {
       if (err instanceof PermissionError) {
         redirect("/admin?error=forbidden");
       }
       throw err;
     }
     return { sb };
   }

   export default async function AssetsLibraryPage() {
     if (!featureFlags.overlayBuilder.enabled) {
       notFound();
     }
     const { sb } = await resolveAdmin();
     const psdAssets = await listPsdAssets(sb);
     return (
       <main className="min-h-screen bg-black text-white">
         <AssetsLibrary psdAssets={psdAssets} />
       </main>
     );
   }
   ```

2. Write the failing component test. Create `apps/web/src/components/admin/builder/AssetsLibrary.test.tsx`:

   ```tsx
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { render, screen, fireEvent, waitFor } from "@testing-library/react";
   import { AssetsLibrary } from "./AssetsLibrary";

   const uploadActionMock = vi.fn();
   vi.mock("@/app/admin/broadcast/v2/builder/assets-actions", () => ({
     uploadPsdAction: (...args: unknown[]) => uploadActionMock(...args),
   }));

   describe("AssetsLibrary", () => {
     beforeEach(() => {
       uploadActionMock.mockReset();
       uploadActionMock.mockResolvedValue({
         ok: true,
         parentAssetId: "p-1",
         flatAssetId: "f-1",
         layerAssetIds: ["l-1", "l-2"],
         canvasWidth: 1920,
         canvasHeight: 1080,
         softWarnLarge: false,
       });
     });

     it("renders the PSD tab with empty-state when no PSDs yet", () => {
       render(<AssetsLibrary psdAssets={[]} />);
       expect(screen.getByText(/no psds uploaded/i)).toBeInTheDocument();
       expect(screen.getByRole("button", { name: /upload psd/i })).toBeInTheDocument();
     });

     it("renders a card per PSD with layer count + size", () => {
       render(
         <AssetsLibrary
           psdAssets={[
             {
               id: "p-1",
               originalFilename: "scoreboard.psd",
               width: 1920,
               height: 1080,
               sizeBytes: 12 * 1024 * 1024,
               layerCount: 18,
               flatAssetPath: "psd/p-1-flat.png",
               createdAt: new Date().toISOString(),
             },
           ]}
         />,
       );
       expect(screen.getByText("scoreboard.psd")).toBeInTheDocument();
       expect(screen.getByText(/18 layers/i)).toBeInTheDocument();
       expect(screen.getByText(/12\.0 MB/)).toBeInTheDocument();
     });

     it("calls uploadPsdAction when a PSD is dropped onto the dropzone", async () => {
       render(<AssetsLibrary psdAssets={[]} />);
       const drop = screen.getByTestId("psd-dropzone");
       const file = new File([Buffer.from("8BPS-stub")], "drop.psd", { type: "image/vnd.adobe.photoshop" });
       fireEvent.drop(drop, { dataTransfer: { files: [file] } });
       await waitFor(() => expect(uploadActionMock).toHaveBeenCalledTimes(1));
       const fd = uploadActionMock.mock.calls[0][0] as FormData;
       expect((fd.get("file") as File).name).toBe("drop.psd");
     });

     it("shows parsing status while upload is in flight", async () => {
       let resolve!: (v: unknown) => void;
       uploadActionMock.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
       render(<AssetsLibrary psdAssets={[]} />);
       const drop = screen.getByTestId("psd-dropzone");
       const file = new File([Buffer.from("x")], "spin.psd", { type: "image/vnd.adobe.photoshop" });
       fireEvent.drop(drop, { dataTransfer: { files: [file] } });
       expect(await screen.findByText(/parsing psd/i)).toBeInTheDocument();
       resolve({ ok: true, parentAssetId: "p", flatAssetId: "f", layerAssetIds: [], canvasWidth: 1, canvasHeight: 1, softWarnLarge: false });
       await waitFor(() => expect(screen.queryByText(/parsing psd/i)).not.toBeInTheDocument());
     });

     it("surfaces error toast when upload returns ok:false", async () => {
       uploadActionMock.mockResolvedValueOnce({
         ok: false,
         code: "too_large",
         error: "File is 200 MB; max 100 MB",
       });
       render(<AssetsLibrary psdAssets={[]} />);
       const drop = screen.getByTestId("psd-dropzone");
       const file = new File([Buffer.from("x")], "huge.psd", { type: "image/vnd.adobe.photoshop" });
       fireEvent.drop(drop, { dataTransfer: { files: [file] } });
       expect(await screen.findByText(/200 MB/)).toBeInTheDocument();
     });

     it("shows soft warning when softWarnLarge=true", async () => {
       uploadActionMock.mockResolvedValueOnce({
         ok: true,
         parentAssetId: "p-1",
         flatAssetId: "f-1",
         layerAssetIds: ["l-1"],
         canvasWidth: 1920,
         canvasHeight: 1080,
         softWarnLarge: true,
       });
       render(<AssetsLibrary psdAssets={[]} />);
       const drop = screen.getByTestId("psd-dropzone");
       const file = new File([Buffer.from("x")], "big.psd", { type: "image/vnd.adobe.photoshop" });
       fireEvent.drop(drop, { dataTransfer: { files: [file] } });
       expect(await screen.findByText(/large file/i)).toBeInTheDocument();
     });
   });
   ```

3. Run the test — expect FAIL:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/AssetsLibrary.test.tsx
   ```

   Expected: `Cannot find module './AssetsLibrary'`.

4. Author the component. Create `apps/web/src/components/admin/builder/AssetsLibrary.tsx`:

   ```tsx
   "use client";

   import { useCallback, useState, useTransition, DragEvent } from "react";
   import { useRouter } from "next/navigation";
   import { FileImage, FilePlus2, Trash2 } from "lucide-react";
   import { uploadPsdAction } from "@/app/admin/broadcast/v2/builder/assets-actions";
   import type { UploadPsdResponse } from "@/app/admin/broadcast/v2/builder/assets-schemas";

   type PsdAsset = {
     id: string;
     originalFilename: string;
     width: number | null;
     height: number | null;
     sizeBytes: number;
     layerCount: number;
     flatAssetPath: string | null;
     createdAt: string;
   };

   type Toast =
     | { kind: "info"; message: string }
     | { kind: "warn"; message: string }
     | { kind: "error"; message: string };

   function formatBytes(n: number): string {
     if (n < 1024) return `${n} B`;
     if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
     return `${(n / 1024 / 1024).toFixed(1)} MB`;
   }

   /**
    * Wave 2A — `/admin/broadcast/v2/builder/assets` PSD library.
    *
    * Three tabs (PSDs / Images / Fonts); only PSDs is functional in Wave 2A.
    * Drop-zone accepts .psd files, posts to uploadPsdAction, surfaces a
    * loading + error toast, then revalidates the listing via router.refresh().
    */
   export function AssetsLibrary({ psdAssets }: { psdAssets: PsdAsset[] }) {
     const router = useRouter();
     const [tab, setTab] = useState<"psds" | "images" | "fonts">("psds");
     const [toast, setToast] = useState<Toast | null>(null);
     const [isPending, startTransition] = useTransition();

     const handleFile = useCallback(
       (file: File) => {
         setToast({ kind: "info", message: `Parsing PSD: ${file.name}…` });
         const fd = new FormData();
         fd.append("file", file);
         startTransition(async () => {
           let res: UploadPsdResponse;
           try {
             res = await uploadPsdAction(fd);
           } catch (e) {
             setToast({
               kind: "error",
               message: e instanceof Error ? e.message : "Upload failed",
             });
             return;
           }
           if (res.ok) {
             if (res.softWarnLarge) {
               setToast({
                 kind: "warn",
                 message: `Large file uploaded — ${file.name} parsed but may load slowly`,
               });
             } else {
               setToast({
                 kind: "info",
                 message: `Parsed ${file.name} → ${res.layerAssetIds.length} layers`,
               });
             }
             router.refresh();
           } else {
             setToast({ kind: "error", message: res.error });
           }
         });
       },
       [router],
     );

     const onDrop = useCallback(
       (e: DragEvent<HTMLDivElement>) => {
         e.preventDefault();
         const file = e.dataTransfer.files[0];
         if (!file) return;
         handleFile(file);
       },
       [handleFile],
     );

     const onPicker = useCallback(
       (e: React.ChangeEvent<HTMLInputElement>) => {
         const file = e.target.files?.[0];
         if (!file) return;
         handleFile(file);
         e.target.value = "";
       },
       [handleFile],
     );

     return (
       <div className="mx-auto max-w-6xl px-6 py-10">
         <div className="mb-6 flex items-center justify-between">
           <div>
             <h1 className="text-3xl font-bold">Asset Library</h1>
             <p className="mt-1 text-sm text-white/60">
               PSDs, images, and fonts available to every overlay design.
             </p>
           </div>
           <nav className="flex gap-2 rounded-md bg-white/5 p-1">
             {(["psds", "images", "fonts"] as const).map((t) => (
               <button
                 key={t}
                 type="button"
                 onClick={() => setTab(t)}
                 className={`rounded px-4 py-1.5 text-sm capitalize transition ${
                   tab === t ? "bg-[#6bcd06] text-black" : "text-white/70 hover:text-white"
                 }`}
               >
                 {t}
               </button>
             ))}
           </nav>
         </div>

         {tab === "psds" && (
           <section>
             <div
               data-testid="psd-dropzone"
               onDrop={onDrop}
               onDragOver={(e) => e.preventDefault()}
               className={`flex items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 text-sm transition ${
                 isPending ? "border-[#6bcd06]/60 bg-[#6bcd06]/5" : "border-white/15 bg-white/[0.02]"
               }`}
             >
               {isPending ? (
                 <span className="text-white/80">Parsing PSD…</span>
               ) : (
                 <>
                   <FilePlus2 size={18} className="text-white/60" />
                   <span className="text-white/80">Drop a .psd file here, or</span>
                   <label className="cursor-pointer rounded bg-[#6bcd06] px-3 py-1.5 text-xs font-semibold text-black">
                     Upload PSD
                     <input
                       type="file"
                       accept=".psd,image/vnd.adobe.photoshop"
                       className="hidden"
                       onChange={onPicker}
                     />
                   </label>
                 </>
               )}
             </div>

             {toast && (
               <div
                 role="status"
                 className={`mt-3 rounded px-3 py-2 text-sm ${
                   toast.kind === "error"
                     ? "bg-red-900/40 text-red-100"
                     : toast.kind === "warn"
                     ? "bg-yellow-900/40 text-yellow-100"
                     : "bg-zinc-900 text-white/80"
                 }`}
               >
                 {toast.message}
               </div>
             )}

             {psdAssets.length === 0 ? (
               <p className="mt-8 text-center text-sm text-white/50">
                 No PSDs uploaded yet — drop one above to begin.
               </p>
             ) : (
               <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                 {psdAssets.map((a) => (
                   <li
                     key={a.id}
                     className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                   >
                     <div className="flex items-center gap-2 text-white">
                       <FileImage size={16} className="text-white/60" />
                       <span className="truncate text-sm font-medium">
                         {a.originalFilename}
                       </span>
                     </div>
                     <dl className="grid grid-cols-2 gap-1 text-xs text-white/60">
                       <dt>Size</dt>
                       <dd className="text-right">{formatBytes(a.sizeBytes)}</dd>
                       <dt>Dimensions</dt>
                       <dd className="text-right">
                         {a.width && a.height ? `${a.width}×${a.height}` : "—"}
                       </dd>
                       <dt>Layers</dt>
                       <dd className="text-right">{a.layerCount} layers</dd>
                     </dl>
                   </li>
                 ))}
               </ul>
             )}
           </section>
         )}

         {tab === "images" && (
           <p className="mt-12 text-center text-white/60">
             Image upload ships in Wave 1B.
           </p>
         )}
         {tab === "fonts" && (
           <p className="mt-12 text-center text-white/60">
             Font upload ships in Wave 1B.
           </p>
         )}
       </div>
     );
   }
   ```

5. Run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/AssetsLibrary.test.tsx
   ```

   Expected: `Tests 6 passed (6)`.

6. Stage and commit:

   ```bash
   git add apps/web/src/app/admin/broadcast/v2/builder/assets/page.tsx apps/web/src/components/admin/builder/AssetsLibrary.tsx apps/web/src/components/admin/builder/AssetsLibrary.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2a): asset library page + PSD drop-zone

   Adds `/admin/broadcast/v2/builder/assets` with three tabs (PSDs /
   Images / Fonts). Wave 2A wires the PSDs tab; Images + Fonts show
   a "ships in Wave 1B" placeholder so navigation stays complete.

   Drop-zone accepts .psd files via drag-drop or button-picker, posts
   to uploadPsdAction, surfaces a parsing toast (info / warn / error
   kinds), then router.refresh() once the action returns so the grid
   re-fetches via the SSR page.

   Per-card layout: filename, size formatted (KB/MB), dimensions,
   layer count. Soft-delete + Place-on-canvas hand-offs land in the
   PsdPlaceDrawer task next.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 6: Toolbar — "From PSD" sub-option on Image button

**Files:**

- Modify: `apps/web/src/components/admin/builder/Toolbar.tsx`
- Modify: `apps/web/src/components/admin/builder/Toolbar.test.tsx`

**Context:** Wave 1A toolbar has a single `Image` button that drops a placeholder image. Wave 2A converts that button into a split-button: clicking opens a tiny popover with `Upload image` (existing behavior — drops a placeholder element, Wave 1B will wire real upload) and `From PSD` (opens the PSD picker drawer via a window event). Keeps the keyboard + screen-reader ergonomics straightforward.

#### Steps

1. Append a new test to the existing `Toolbar.test.tsx`. Edit `apps/web/src/components/admin/builder/Toolbar.test.tsx` and add at the bottom of the `describe("Toolbar", ...)` block:

   ```tsx
   it("Image button opens a popover with Upload + From PSD sub-options", () => {
     render(<Toolbar />);
     fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
     expect(screen.getByRole("menuitem", { name: /upload image/i })).toBeInTheDocument();
     expect(screen.getByRole("menuitem", { name: /from psd/i })).toBeInTheDocument();
   });

   it("clicking Upload image still drops the placeholder image element", () => {
     render(<Toolbar />);
     fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
     fireEvent.click(screen.getByRole("menuitem", { name: /upload image/i }));
     const els = useBuilderStore.getState().design!.scenes[0].elements;
     expect(els[0].elementType).toBe("image");
     expect(els[0].content?.assetId).toBe("image-placeholder");
   });

   it("clicking From PSD fires the open-psd-picker window event", () => {
     const handler = vi.fn();
     window.addEventListener("builder:open-psd-picker", handler);
     render(<Toolbar />);
     fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
     fireEvent.click(screen.getByRole("menuitem", { name: /from psd/i }));
     expect(handler).toHaveBeenCalled();
     window.removeEventListener("builder:open-psd-picker", handler);
   });
   ```

   Also relax the existing "clicking Image adds an image-placeholder element" test — the Image button now opens a popover instead of inserting directly. Replace the existing test body with:

   ```tsx
   it("Image button opens popover (does not insert directly)", () => {
     render(<Toolbar />);
     fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
     const els = useBuilderStore.getState().design!.scenes[0].elements;
     expect(els).toHaveLength(0);
   });
   ```

2. Run the test — expect FAIL (Image button still has Wave 1A behavior):

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/Toolbar.test.tsx
   ```

   Expected: existing image-button assertion fails because no popover renders + new menuitem assertions fail.

3. Update the toolbar. Replace the `Image` button section in `apps/web/src/components/admin/builder/Toolbar.tsx` — find the `<ToolButton label="Image" ...>` block and replace it with a popover-driven equivalent. The full updated component:

   ```tsx
   "use client";

   import { useState, useRef, useEffect } from "react";
   import { useStore } from "zustand/react";
   import {
     MousePointer2,
     Square,
     Type,
     Image as ImageIcon,
     Database,
     Undo2,
     Redo2,
     Layers,
   } from "lucide-react";
   import { useBuilderStore, useTemporalStore } from "@/state/builder/store";

   /**
    * Wave 2A — left-rail toolbar (updated).
    *
    * Image button became a split-button popover with two options:
    *   - Upload image → existing Wave 1A behavior (drops a placeholder
    *     image element; Wave 1B wires real upload).
    *   - From PSD → fires `builder:open-psd-picker` window event so the
    *     PsdPlaceDrawer (rendered by the editor shell) can list PSDs +
    *     hand a layer back as an image element.
    */
   export function Toolbar() {
     const [mode, setMode] = useState<"select" | "insert">("select");
     const [imageMenuOpen, setImageMenuOpen] = useState(false);
     const imageBtnRef = useRef<HTMLButtonElement | null>(null);
     const activeSceneId = useBuilderStore((s) => s.activeSceneId);
     const addElement = useBuilderStore((s) => s.addElement);
     const undo = useStore(useTemporalStore, (s) => s.undo);
     const redo = useStore(useTemporalStore, (s) => s.redo);

     useEffect(() => {
       if (!imageMenuOpen) return;
       function onDocClick(e: MouseEvent) {
         if (!imageBtnRef.current?.contains(e.target as Node)) setImageMenuOpen(false);
       }
       document.addEventListener("mousedown", onDocClick);
       return () => document.removeEventListener("mousedown", onDocClick);
     }, [imageMenuOpen]);

     function addRect() {
       if (!activeSceneId) return;
       addElement(activeSceneId, "rect", {
         transform: { x: 860, y: 490, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: { fill: "#6bcd06" },
         zIndex: 0,
       });
     }

     function addText() {
       if (!activeSceneId) return;
       addElement(activeSceneId, "text", {
         transform: { x: 860, y: 510, width: 200, height: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: { color: "#ffffff", fontFamily: "Agharti", fontSize: 48, fontWeight: 600 },
         content: { text: "Text" },
         zIndex: 0,
       });
     }

     function addPlaceholderImage() {
       if (!activeSceneId) return;
       addElement(activeSceneId, "image", {
         transform: { x: 860, y: 440, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
         style: {},
         content: { assetId: "image-placeholder", imageFit: "cover" },
         zIndex: 0,
       });
       setImageMenuOpen(false);
     }

     function openPsdPicker() {
       window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
       setImageMenuOpen(false);
     }

     function openDataSlots() {
       window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
     }

     return (
       <aside aria-label="Toolbar" className="relative flex w-16 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-zinc-950 py-3">
         <ToolButton label="Select" active={mode === "select"} onClick={() => setMode("select")}>
           <MousePointer2 size={18} />
         </ToolButton>
         <ToolButton label="Rect" onClick={addRect}>
           <Square size={18} />
         </ToolButton>
         <ToolButton label="Text" onClick={addText}>
           <Type size={18} />
         </ToolButton>
         <div className="relative">
           <button
             ref={imageBtnRef}
             type="button"
             aria-label="Image"
             aria-haspopup="menu"
             aria-expanded={imageMenuOpen}
             title="Image"
             onClick={() => setImageMenuOpen((v) => !v)}
             className={`flex h-10 w-10 items-center justify-center rounded text-white/80 transition hover:bg-white/10 hover:text-white ${
               imageMenuOpen ? "bg-white/10 text-white" : ""
             }`}
           >
             <ImageIcon size={18} />
           </button>
           {imageMenuOpen && (
             <div
               role="menu"
               className="absolute left-12 top-0 z-50 w-44 rounded-md border border-white/10 bg-zinc-900 p-1 shadow-xl"
             >
               <button
                 role="menuitem"
                 type="button"
                 onClick={addPlaceholderImage}
                 className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
               >
                 <ImageIcon size={14} />
                 Upload image
               </button>
               <button
                 role="menuitem"
                 type="button"
                 onClick={openPsdPicker}
                 className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
               >
                 <Layers size={14} />
                 From PSD
               </button>
             </div>
           )}
         </div>
         <ToolButton label="Data Slot" onClick={openDataSlots}>
           <Database size={18} />
         </ToolButton>
         <hr className="my-2 w-8 border-white/10" />
         <ToolButton label="Undo" onClick={() => undo()}>
           <Undo2 size={18} />
         </ToolButton>
         <ToolButton label="Redo" onClick={() => redo()}>
           <Redo2 size={18} />
         </ToolButton>
       </aside>
     );
   }

   function ToolButton({
     label,
     onClick,
     active,
     children,
   }: {
     label: string;
     onClick: () => void;
     active?: boolean;
     children: React.ReactNode;
   }) {
     return (
       <button
         type="button"
         aria-label={label}
         title={label}
         onClick={onClick}
         className={`flex h-10 w-10 items-center justify-center rounded text-white/80 transition hover:bg-white/10 hover:text-white ${
           active ? "bg-[#6bcd06]/15 text-[#6bcd06]" : ""
         }`}
       >
         {children}
       </button>
     );
   }
   ```

4. Run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/Toolbar.test.tsx
   ```

   Expected: all toolbar tests green (existing 7 + new 3 = 10, with the relaxed Image assertion).

5. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/builder/Toolbar.tsx apps/web/src/components/admin/builder/Toolbar.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2a): toolbar Image button gains From PSD sub-option

   Image button became a split-button popover:
     - Upload image → existing Wave 1A placeholder insert
     - From PSD     → dispatches builder:open-psd-picker window event

   Popover closes on outside-click + on either menuitem activation.
   ARIA: aria-haspopup="menu" / aria-expanded / role="menu" + "menuitem"
   so keyboard + screen-reader users get the same surface.

   The PsdPlaceDrawer (added in the next task) listens for the window
   event and opens its layer picker.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 7: `PsdPlaceDrawer` — layer picker + place-on-canvas

**Files:**

- Create: `apps/web/src/components/admin/builder/PsdPlaceDrawer.tsx`
- Create: `apps/web/src/components/admin/builder/PsdPlaceDrawer.test.tsx`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.ts`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.test.ts`
- Modify: `apps/web/src/components/admin/builder/CanvasEditorShell.tsx` (mount the drawer)

**Context:** The drawer listens for `builder:open-psd-picker`, fetches PSDs + their layers via server actions (`listPsdsAction`, `listLayersAction`), and renders a two-column UI: PSDs on the left, layers on the right. Clicking a layer (or "Flatten") spawns an `image` element on the active scene with the layer's storage path as `content.assetId` — the compiler resolves the storage path at render time per Wave 1A's image-element pipeline.

The data-fetch server actions are read-only — they still gate on `overlay.design.manage` so non-admin sessions can't browse asset metadata.

#### Steps

1. Write the data-fetch action tests. Create `apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.test.ts`:

   ```ts
   import { describe, expect, it, vi, beforeEach } from "vitest";

   const gateMock = vi.fn();
   const listPsdAssetsMock = vi.fn();
   const listPsdLayersMock = vi.fn();

   vi.mock("../../assets-actions-gate", () => ({ gate: gateMock }));
   vi.mock("@/server/overlays/builder/assets", () => ({
     listPsdAssets: (...a: unknown[]) => listPsdAssetsMock(...a),
     listPsdLayers: (...a: unknown[]) => listPsdLayersMock(...a),
   }));

   import { listPsdsAction, listLayersAction } from "./psd-data-actions";

   describe("psd-data-actions", () => {
     beforeEach(() => {
       gateMock.mockReset();
       listPsdAssetsMock.mockReset();
       listPsdLayersMock.mockReset();
       gateMock.mockResolvedValue({
         sb: { __mock: true } as never,
         actor: { userId: "u-1", roles: ["admin"] },
       });
     });

     it("listPsdsAction returns rows on happy path", async () => {
       listPsdAssetsMock.mockResolvedValueOnce([
         { id: "p-1", originalFilename: "a.psd", width: 1, height: 1, sizeBytes: 1, layerCount: 1, flatAssetPath: null, createdAt: "now" },
       ]);
       const res = await listPsdsAction();
       expect(res.ok).toBe(true);
       if (res.ok) expect(res.psds).toHaveLength(1);
     });

     it("listPsdsAction returns ok:false on Forbidden", async () => {
       gateMock.mockRejectedValueOnce(new Error("Forbidden: missing overlay.design.manage"));
       const res = await listPsdsAction();
       expect(res.ok).toBe(false);
       if (!res.ok) expect(res.code).toBe("forbidden");
     });

     it("listLayersAction returns layers ordered by index", async () => {
       listPsdLayersMock.mockResolvedValueOnce([
         { id: "l-1", psdLayerIndex: 0, name: "Bg", filePath: "psd/x-layer-0.png", width: 64, height: 64 },
         { id: "l-2", psdLayerIndex: 1, name: "Fg", filePath: "psd/x-layer-1.png", width: 32, height: 32 },
       ]);
       const res = await listLayersAction("p-1");
       expect(res.ok).toBe(true);
       if (res.ok) {
         expect(res.layers).toHaveLength(2);
         expect(res.layers[0].name).toBe("Bg");
       }
     });

     it("listLayersAction returns ok:false on Forbidden", async () => {
       gateMock.mockRejectedValueOnce(new Error("Forbidden: missing overlay.design.manage"));
       const res = await listLayersAction("p-1");
       expect(res.ok).toBe(false);
     });
   });
   ```

2. Run the test — expect FAIL (`Cannot find module './psd-data-actions'`).

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.test.ts
   ```

3. Author the data-fetch actions. Create `apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.ts`:

   ```ts
   "use server";

   import { gate } from "../../assets-actions-gate";
   import { listPsdAssets, listPsdLayers } from "@/server/overlays/builder/assets";

   /**
    * Wave 2A — read-only server actions for the PsdPlaceDrawer.
    *
    * Still perm-gated on overlay.design.manage so non-admin sessions
    * can't browse PSD metadata.
    */

   type PsdSummary = Awaited<ReturnType<typeof listPsdAssets>>[number];
   type LayerSummary = Awaited<ReturnType<typeof listPsdLayers>>[number];

   export type ListPsdsResponse =
     | { ok: true; psds: PsdSummary[] }
     | { ok: false; code: "forbidden" | "unknown"; error: string };

   export type ListLayersResponse =
     | { ok: true; layers: LayerSummary[] }
     | { ok: false; code: "forbidden" | "unknown"; error: string };

   export async function listPsdsAction(): Promise<ListPsdsResponse> {
     try {
       const { sb } = await gate();
       const psds = await listPsdAssets(sb);
       return { ok: true, psds };
     } catch (e) {
       const msg = e instanceof Error ? e.message : String(e);
       if (/^Forbidden/.test(msg)) return { ok: false, code: "forbidden", error: msg };
       return { ok: false, code: "unknown", error: msg };
     }
   }

   export async function listLayersAction(parentAssetId: string): Promise<ListLayersResponse> {
     try {
       const { sb } = await gate();
       const layers = await listPsdLayers(sb, parentAssetId);
       return { ok: true, layers };
     } catch (e) {
       const msg = e instanceof Error ? e.message : String(e);
       if (/^Forbidden/.test(msg)) return { ok: false, code: "forbidden", error: msg };
       return { ok: false, code: "unknown", error: msg };
     }
   }
   ```

4. Re-run the action test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.test.ts
   ```

   Expected: 4 tests pass.

5. Write the drawer test. Create `apps/web/src/components/admin/builder/PsdPlaceDrawer.test.tsx`:

   ```tsx
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { render, screen, fireEvent, waitFor } from "@testing-library/react";
   import { useBuilderStore } from "@/state/builder/store";
   import { PsdPlaceDrawer } from "./PsdPlaceDrawer";

   const listPsdsMock = vi.fn();
   const listLayersMock = vi.fn();
   vi.mock("@/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions", () => ({
     listPsdsAction: () => listPsdsMock(),
     listLayersAction: (id: string) => listLayersMock(id),
   }));

   function fixtureDesign() {
     return {
       id: "d1",
       slug: "test",
       title: "T",
       mode: "single" as const,
       status: "draft" as const,
       canvasWidth: 1920,
       canvasHeight: 1080,
       scenes: [{
         id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
         transitionIn: "fade", transitionOut: "fade", elements: [],
       }],
     };
   }

   describe("PsdPlaceDrawer", () => {
     beforeEach(() => {
       listPsdsMock.mockReset();
       listLayersMock.mockReset();
       useBuilderStore.setState({
         design: fixtureDesign(),
         selectedElementIds: [],
         activeSceneId: "s1",
         zoomLevel: 1,
         dirty: false,
       });
     });

     it("does not render until the open-psd-picker event fires", () => {
       render(<PsdPlaceDrawer />);
       expect(screen.queryByRole("dialog", { name: /place psd/i })).not.toBeInTheDocument();
     });

     it("opens on builder:open-psd-picker, lists PSDs", async () => {
       listPsdsMock.mockResolvedValueOnce({
         ok: true,
         psds: [{
           id: "p-1", originalFilename: "score.psd", width: 1920, height: 1080,
           sizeBytes: 1024, layerCount: 3, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
         }],
       });
       render(<PsdPlaceDrawer />);
       window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
       expect(await screen.findByRole("dialog", { name: /place psd/i })).toBeInTheDocument();
       expect(await screen.findByText("score.psd")).toBeInTheDocument();
     });

     it("clicking a PSD loads its layers", async () => {
       listPsdsMock.mockResolvedValueOnce({
         ok: true,
         psds: [{
           id: "p-1", originalFilename: "score.psd", width: 1, height: 1,
           sizeBytes: 1, layerCount: 2, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
         }],
       });
       listLayersMock.mockResolvedValueOnce({
         ok: true,
         layers: [
           { id: "l-1", psdLayerIndex: 0, name: "Bg", filePath: "psd/p-1-layer-0.png", width: 1920, height: 1080 },
           { id: "l-2", psdLayerIndex: 1, name: "Score", filePath: "psd/p-1-layer-1.png", width: 400, height: 200 },
         ],
       });
       render(<PsdPlaceDrawer />);
       window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
       fireEvent.click(await screen.findByText("score.psd"));
       expect(await screen.findByText("Bg")).toBeInTheDocument();
       expect(await screen.findByText("Score")).toBeInTheDocument();
     });

     it("clicking a layer spawns an image element with the layer assetId", async () => {
       listPsdsMock.mockResolvedValueOnce({
         ok: true,
         psds: [{
           id: "p-1", originalFilename: "score.psd", width: 1, height: 1,
           sizeBytes: 1, layerCount: 1, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
         }],
       });
       listLayersMock.mockResolvedValueOnce({
         ok: true,
         layers: [
           { id: "l-1", psdLayerIndex: 0, name: "Bg", filePath: "psd/p-1-layer-0.png", width: 1920, height: 1080 },
         ],
       });
       render(<PsdPlaceDrawer />);
       window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
       fireEvent.click(await screen.findByText("score.psd"));
       fireEvent.click(await screen.findByRole("button", { name: /^place: bg$/i }));
       await waitFor(() => {
         const els = useBuilderStore.getState().design!.scenes[0].elements;
         expect(els).toHaveLength(1);
         expect(els[0].elementType).toBe("image");
         expect(els[0].content?.assetId).toBe("l-1");
       });
     });

     it("clicking Flatten spawns an image element with the flat PNG assetId", async () => {
       listPsdsMock.mockResolvedValueOnce({
         ok: true,
         psds: [{
           id: "p-1", originalFilename: "score.psd", width: 1920, height: 1080,
           sizeBytes: 1, layerCount: 0, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
         }],
       });
       listLayersMock.mockResolvedValueOnce({ ok: true, layers: [] });
       render(<PsdPlaceDrawer />);
       window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
       fireEvent.click(await screen.findByText("score.psd"));
       fireEvent.click(await screen.findByRole("button", { name: /flatten/i }));
       await waitFor(() => {
         const els = useBuilderStore.getState().design!.scenes[0].elements;
         expect(els[0].content?.assetId).toBe("psd/p-1-flat.png");
       });
     });

     it("surfaces error message when listPsdsAction returns ok:false", async () => {
       listPsdsMock.mockResolvedValueOnce({ ok: false, code: "forbidden", error: "Forbidden: missing overlay.design.manage" });
       render(<PsdPlaceDrawer />);
       window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
       expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
     });

     it("Esc closes the dialog", async () => {
       listPsdsMock.mockResolvedValueOnce({ ok: true, psds: [] });
       render(<PsdPlaceDrawer />);
       window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
       expect(await screen.findByRole("dialog", { name: /place psd/i })).toBeInTheDocument();
       fireEvent.keyDown(document, { key: "Escape" });
       await waitFor(() => {
         expect(screen.queryByRole("dialog", { name: /place psd/i })).not.toBeInTheDocument();
       });
     });
   });
   ```

6. Run the test — expect FAIL (`Cannot find module './PsdPlaceDrawer'`).

7. Author the drawer. Create `apps/web/src/components/admin/builder/PsdPlaceDrawer.tsx`:

   ```tsx
   "use client";

   import { useCallback, useEffect, useState } from "react";
   import { FileImage, Layers, X } from "lucide-react";
   import { useBuilderStore } from "@/state/builder/store";
   import {
     listPsdsAction,
     listLayersAction,
   } from "@/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions";

   type PsdRow = {
     id: string;
     originalFilename: string;
     width: number | null;
     height: number | null;
     sizeBytes: number;
     layerCount: number;
     flatAssetPath: string | null;
     createdAt: string;
   };

   type LayerRow = {
     id: string;
     psdLayerIndex: number;
     name: string;
     filePath: string;
     width: number | null;
     height: number | null;
   };

   /**
    * Wave 2A — PSD layer-picker drawer.
    *
    * Listens for `builder:open-psd-picker` window event (fired by the
    * Toolbar's "From PSD" sub-option), fetches PSDs via server action,
    * lets the user pick a PSD then a layer (or "Flatten" for the whole
    * composite). Each pick calls `addElement(...)` on the builder store
    * with an `image` element whose `content.assetId` is the layer's
    * asset id (server-side image renderer resolves to a storage path).
    *
    * Flatten path stores the flat PNG's storage path directly (not its
    * row id) so the compiler can serve it without an extra DB lookup.
    * This is the only place where assetId is a path rather than a uuid;
    * the image-element renderer in the compiler tolerates both shapes.
    */
   export function PsdPlaceDrawer() {
     const [open, setOpen] = useState(false);
     const [psds, setPsds] = useState<PsdRow[] | null>(null);
     const [layers, setLayers] = useState<LayerRow[] | null>(null);
     const [activePsd, setActivePsd] = useState<PsdRow | null>(null);
     const [error, setError] = useState<string | null>(null);
     const [loadingPsds, setLoadingPsds] = useState(false);
     const [loadingLayers, setLoadingLayers] = useState(false);
     const activeSceneId = useBuilderStore((s) => s.activeSceneId);
     const addElement = useBuilderStore((s) => s.addElement);

     useEffect(() => {
       function onOpen() {
         setOpen(true);
         setActivePsd(null);
         setLayers(null);
         setError(null);
       }
       window.addEventListener("builder:open-psd-picker", onOpen);
       return () => window.removeEventListener("builder:open-psd-picker", onOpen);
     }, []);

     useEffect(() => {
       if (!open || psds !== null) return;
       setLoadingPsds(true);
       listPsdsAction()
         .then((res) => {
           if (res.ok) {
             setPsds(res.psds as PsdRow[]);
           } else {
             setError(res.error);
             setPsds([]);
           }
         })
         .catch((e: unknown) => {
           setError(e instanceof Error ? e.message : String(e));
           setPsds([]);
         })
         .finally(() => setLoadingPsds(false));
     }, [open, psds]);

     useEffect(() => {
       if (!open) return;
       function onKey(e: KeyboardEvent) {
         if (e.key === "Escape") setOpen(false);
       }
       document.addEventListener("keydown", onKey);
       return () => document.removeEventListener("keydown", onKey);
     }, [open]);

     const pickPsd = useCallback((psd: PsdRow) => {
       setActivePsd(psd);
       setLayers(null);
       setError(null);
       setLoadingLayers(true);
       listLayersAction(psd.id)
         .then((res) => {
           if (res.ok) setLayers(res.layers as LayerRow[]);
           else {
             setError(res.error);
             setLayers([]);
           }
         })
         .catch((e: unknown) => {
           setError(e instanceof Error ? e.message : String(e));
           setLayers([]);
         })
         .finally(() => setLoadingLayers(false));
     }, []);

     const placeLayer = useCallback(
       (layer: LayerRow) => {
         if (!activeSceneId) return;
         const w = layer.width ?? 200;
         const h = layer.height ?? 200;
         addElement(activeSceneId, "image", {
           transform: {
             x: Math.max(0, 960 - w / 2),
             y: Math.max(0, 540 - h / 2),
             width: w,
             height: h,
             rotation: 0,
             scaleX: 1,
             scaleY: 1,
             opacity: 1,
           },
           style: {},
           content: { assetId: layer.id, imageFit: "cover", imageSourceName: layer.name },
           zIndex: 0,
         });
         setOpen(false);
       },
       [activeSceneId, addElement],
     );

     const placeFlat = useCallback(
       (psd: PsdRow) => {
         if (!activeSceneId || !psd.flatAssetPath) return;
         const w = psd.width ?? 1920;
         const h = psd.height ?? 1080;
         addElement(activeSceneId, "image", {
           transform: {
             x: Math.max(0, 960 - w / 2),
             y: Math.max(0, 540 - h / 2),
             width: w,
             height: h,
             rotation: 0,
             scaleX: 1,
             scaleY: 1,
             opacity: 1,
           },
           style: {},
           content: { assetId: psd.flatAssetPath, imageFit: "cover", imageSourceName: psd.originalFilename },
           zIndex: 0,
         });
         setOpen(false);
       },
       [activeSceneId, addElement],
     );

     if (!open) return null;

     return (
       <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="presentation">
         <div
           role="dialog"
           aria-label="Place PSD"
           className="flex h-[80vh] w-[min(960px,90vw)] flex-col rounded-lg border border-white/10 bg-zinc-950 shadow-2xl"
         >
           <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
             <h2 className="text-lg font-semibold text-white">Place PSD</h2>
             <button
               type="button"
               aria-label="Close"
               onClick={() => setOpen(false)}
               className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
             >
               <X size={18} />
             </button>
           </header>

           <div className="grid flex-1 grid-cols-2 gap-0 overflow-hidden">
             <section className="overflow-y-auto border-r border-white/10 p-4">
               <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
                 PSDs
               </h3>
               {loadingPsds && <p className="text-sm text-white/60">Loading…</p>}
               {error && <p className="text-sm text-red-300">{error}</p>}
               {psds && psds.length === 0 && !error && (
                 <p className="text-sm text-white/50">No PSDs uploaded yet.</p>
               )}
               <ul className="space-y-1">
                 {(psds ?? []).map((p) => (
                   <li key={p.id}>
                     <button
                       type="button"
                       onClick={() => pickPsd(p)}
                       className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition ${
                         activePsd?.id === p.id ? "bg-[#6bcd06]/15 text-[#6bcd06]" : "text-white/80 hover:bg-white/5"
                       }`}
                     >
                       <FileImage size={14} />
                       <span className="flex-1 truncate">{p.originalFilename}</span>
                       <span className="text-xs text-white/40">{p.layerCount}L</span>
                     </button>
                   </li>
                 ))}
               </ul>
             </section>

             <section className="overflow-y-auto p-4">
               <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
                 Layers
               </h3>
               {!activePsd && <p className="text-sm text-white/50">Pick a PSD on the left to see its layers.</p>}
               {activePsd && (
                 <>
                   <button
                     type="button"
                     onClick={() => placeFlat(activePsd)}
                     disabled={!activePsd.flatAssetPath}
                     className="mb-3 flex w-full items-center justify-center gap-2 rounded bg-[#6bcd06] px-3 py-2 text-sm font-semibold text-black disabled:bg-zinc-700 disabled:text-white/50"
                   >
                     <Layers size={14} />
                     Flatten — place full composite
                   </button>
                   {loadingLayers && <p className="text-sm text-white/60">Loading layers…</p>}
                   <ul className="space-y-1">
                     {(layers ?? []).map((l) => (
                       <li key={l.id}>
                         <button
                           type="button"
                           aria-label={`Place: ${l.name}`}
                           onClick={() => placeLayer(l)}
                           className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"
                         >
                           <span className="text-xs text-white/40">#{l.psdLayerIndex}</span>
                           <span className="flex-1 truncate">{l.name}</span>
                           {l.width && l.height && (
                             <span className="text-xs text-white/40">
                               {l.width}×{l.height}
                             </span>
                           )}
                         </button>
                       </li>
                     ))}
                   </ul>
                 </>
               )}
             </section>
           </div>
         </div>
       </div>
     );
   }
   ```

8. Run the drawer test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/PsdPlaceDrawer.test.tsx
   ```

   Expected: 7 tests pass.

9. Mount the drawer inside the canvas editor shell. Edit `apps/web/src/components/admin/builder/CanvasEditorShell.tsx` and add the import + render:

   ```tsx
   import { PsdPlaceDrawer } from "./PsdPlaceDrawer";
   ```

   And inside the returned JSX, immediately after the existing `<DataSlotsPanel />` (or wherever drawers are mounted at the top level of the shell), add:

   ```tsx
   <PsdPlaceDrawer />
   ```

   Verify the existing shell test still passes:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/CanvasEditorShell
   ```

10. Stage and commit:

    ```bash
    git add apps/web/src/components/admin/builder/PsdPlaceDrawer.tsx apps/web/src/components/admin/builder/PsdPlaceDrawer.test.tsx apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.ts apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions.test.ts apps/web/src/components/admin/builder/CanvasEditorShell.tsx
    git commit -m "$(cat <<'EOF'
    feat(overlay-builder/wave-2a): PsdPlaceDrawer — layer picker + place flow

    New drawer listens for `builder:open-psd-picker` (fired by the
    toolbar's "From PSD" menuitem), fetches PSDs + layers via two new
    read-only server actions (psd-data-actions.ts, both perm-gated on
    overlay.design.manage), and lets the user pick a layer or "Flatten"
    to drop the whole composite. Picks spawn an `image` element on the
    active scene at canvas-center with the layer's asset id (or the
    flat PNG's storage path for Flatten) wired into content.assetId.

    UX: two-column dialog (PSDs left, layers right), Esc closes, sample
    error states surfaced when actions return ok:false, loading
    indicators while server actions are in flight.

    Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
    EOF
    )"
    ```

---

### Task 8: OOM safety net + integration smoke

**Files:**

- Create: `apps/web/scripts/_wave-2a-psd-smoke.mjs` (one-shot script, delete after run per existing convention)
- Modify: `apps/web/src/server/overlays/builder/psd-parser.ts` (add try/catch around the parser's largest hot path so OOM-class failures surface as PsdParseError instead of process crashes)

**Context:** `ag-psd` can hit Node's V8 heap limit (~1.7 GB on Vercel default) when parsing a 100 MB PSD with many layers. The action layer already returns a friendly `parse_failed` code on `PsdParseError`, but the parser's main `readPsd(...)` call is the riskiest hot path. We add a second try/catch wrap there + a documentation block explaining the failure mode for future maintainers.

Then we run a one-shot smoke that uploads the tiny.psd fixture through the live action against a local dev server to prove the full server pipeline works end-to-end before E2E.

#### Steps

1. Re-read the parser. The existing implementation in Task 2 already wraps `readPsd()` in a try/catch. Verify by re-running the parser tests + add one new defensive test that simulates a synchronous V8 OOM by mocking `readPsd` to throw a `RangeError`:

   Edit `apps/web/src/server/overlays/builder/psd-parser.test.ts` and append:

   ```ts
   import { vi } from "vitest";
   import * as agPsd from "ag-psd";

   describe("parsePsd — OOM safety net", () => {
     it("wraps V8 RangeError (out-of-memory) into PsdParseError", async () => {
       const spy = vi.spyOn(agPsd, "readPsd").mockImplementationOnce(() => {
         throw new RangeError("Invalid string length");
       });
       const validHeader = Buffer.concat([
         Buffer.from([0x38, 0x42, 0x50, 0x53]), // 8BPS
         Buffer.alloc(30, 0),
       ]);
       try {
         await expect(parsePsd(validHeader)).rejects.toMatchObject({
           name: "PsdParseError",
           message: expect.stringMatching(/parser raised/i),
         });
       } finally {
         spy.mockRestore();
       }
     });
   });
   ```

   Run the parser tests — confirm both old (6) + new (1) pass:

   ```bash
   npm --workspace apps/web run test -- src/server/overlays/builder/psd-parser.test.ts
   ```

   Expected: `Tests 7 passed (7)`.

2. Author the smoke script. Create `apps/web/scripts/_wave-2a-psd-smoke.mjs`:

   ```js
   #!/usr/bin/env node
   /**
    * Wave 2A — one-shot integration smoke for the PSD pipeline.
    *
    * Walks the full path:
    *   1. Authenticate as admin against the local dev server.
    *   2. POST the tiny.psd fixture to /admin/broadcast/v2/builder/assets
    *      via the form action.
    *   3. Hit `/admin/broadcast/v2/builder/assets` and assert the
    *      uploaded PSD shows up in the listing.
    *
    * Delete this file after the run — it's not a recurring CI gate (the
    * vitest psd-parser + assets + assets-actions tests + the E2E
    * spec cover the long-haul case).
    */
   import { readFile } from "node:fs/promises";
   import path from "node:path";

   const BASE = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3030";
   const FIXTURE = path.resolve(
     "apps/web/src/server/overlays/builder/__fixtures__/tiny.psd",
   );

   function fail(msg) {
     console.error("FAIL:", msg);
     process.exit(1);
   }

   const bytes = await readFile(FIXTURE);
   console.log(`Fixture bytes: ${bytes.byteLength}`);

   // 1. Login (admin).
   const loginRes = await fetch(`${BASE}/api/auth/login`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ email: "admin@cade.local", password: "dev-admin-2026" }),
   });
   if (!loginRes.ok) fail(`login failed ${loginRes.status}`);
   const cookie = loginRes.headers.get("set-cookie") ?? "";
   if (!cookie) fail("no cookie returned");
   console.log("OK: login");

   // 2. Upload via form action.
   const fd = new FormData();
   fd.append("file", new Blob([bytes], { type: "image/vnd.adobe.photoshop" }), "tiny.psd");
   const uploadRes = await fetch(`${BASE}/admin/broadcast/v2/builder/assets`, {
     method: "POST",
     body: fd,
     headers: { cookie, "Next-Action": "uploadPsdAction" },
   });
   if (!uploadRes.ok) fail(`upload failed ${uploadRes.status} ${await uploadRes.text()}`);
   const uploadText = await uploadRes.text();
   if (!/parentAssetId/.test(uploadText)) fail(`response missing parentAssetId: ${uploadText.slice(0, 200)}`);
   console.log("OK: upload");

   // 3. Re-fetch listing.
   const listRes = await fetch(`${BASE}/admin/broadcast/v2/builder/assets`, { headers: { cookie } });
   const listHtml = await listRes.text();
   if (!/tiny\.psd/.test(listHtml)) fail("uploaded PSD not in listing");
   console.log("OK: listing shows uploaded PSD");

   console.log("\nWave 2A PSD smoke: ALL GREEN");
   ```

3. Run the smoke against a local dev server (only if a dev server is running on port 3030; this is operator-invoked, not a CI gate):

   ```bash
   node apps/web/scripts/_wave-2a-psd-smoke.mjs
   ```

   Expected output:

   ```
   Fixture bytes: 2048
   OK: login
   OK: upload
   OK: listing shows uploaded PSD

   Wave 2A PSD smoke: ALL GREEN
   ```

   If steps 1-3 fail, diagnose against the dev-server log, fix root cause, re-run.

4. Delete the smoke after a successful run (it's a one-shot per existing `_overlay-design-smoke.mjs` convention):

   ```bash
   rm apps/web/scripts/_wave-2a-psd-smoke.mjs
   ```

5. Stage and commit the parser OOM-safety-net test addition (the smoke script is deleted, so only the parser test is staged):

   ```bash
   git add apps/web/src/server/overlays/builder/psd-parser.test.ts
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/wave-2a): parsePsd wraps V8 RangeError into PsdParseError

   Defensive test: mock ag-psd's readPsd to throw a RangeError (the
   V8 OOM symptom) and assert parsePsd returns PsdParseError with
   the friendly "could not parse PSD — parser raised" message rather
   than letting the process crash.

   The smoke script run end-to-end against the local dev server passed
   green (tiny.psd → upload → listing) — script was one-shot and deleted
   per the _overlay-design-smoke.mjs convention.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 9: E2E spec — full upload → place → save → render

**Files:**

- Create: `apps/web/tests/e2e/overlay-builder-wave-2a.spec.ts`
- Copy: `apps/web/src/server/overlays/builder/__fixtures__/tiny.psd` → `apps/web/tests/e2e/fixtures/wave-2a-tiny.psd` (Playwright fixtures live under `tests/e2e/fixtures/`)

**Context:** Acceptance criterion: an admin can upload a PSD, place a layer onto the canvas, save the design, and the published overlay route renders the placed sprite. This spec covers the full Wave 2A loop.

#### Steps

1. Copy the fixture into the Playwright tree:

   ```bash
   mkdir -p apps/web/tests/e2e/fixtures
   cp apps/web/src/server/overlays/builder/__fixtures__/tiny.psd apps/web/tests/e2e/fixtures/wave-2a-tiny.psd
   ```

2. Author the spec. Create `apps/web/tests/e2e/overlay-builder-wave-2a.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";
   import path from "node:path";

   /**
    * Wave 2A E2E — upload a PSD, place its first layer onto the canvas,
    * save, then verify the published overlay route renders the placed
    * sprite as an <img>.
    *
    * Requires NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true.
    */

   const FIXTURE = path.resolve(__dirname, "fixtures", "wave-2a-tiny.psd");

   test.describe("Overlay Builder — Wave 2A PSD pipeline", () => {
     test.beforeEach(async ({ page }) => {
       await page.goto("/login");
       await page.getByTestId("login-email-input").fill("admin@cade.local");
       await page.getByTestId("login-password-input").fill("dev-admin-2026");
       await page.getByRole("button", { name: /sign in/i }).click();
       await page.waitForURL(/\/admin/);
     });

     test("upload PSD via assets page", async ({ page }) => {
       await page.goto("/admin/broadcast/v2/builder/assets");
       await expect(page.getByRole("heading", { name: /asset library/i })).toBeVisible();

       const file = await page.locator('input[type="file"][accept*=".psd"]');
       await file.setInputFiles(FIXTURE);

       await expect(page.getByText(/parsing psd/i)).toBeVisible();
       await expect(page.getByText("wave-2a-tiny.psd")).toBeVisible({ timeout: 60_000 });
       await expect(page.getByText(/2 layers/i)).toBeVisible();
     });

     test("place a PSD layer onto a design and verify render", async ({ page }) => {
       // 1. Ensure a design exists (create one).
       await page.goto("/admin/broadcast/v2/builder");
       await page.getByRole("button", { name: /new design/i }).click();
       await page.getByLabel("Title").fill("Wave 2A PSD Demo");
       await page.getByRole("button", { name: /create/i }).click();
       await page.waitForURL(/\/admin\/broadcast\/v2\/builder\/.+\/edit/);

       // 2. Open the Image → From PSD popover.
       await page.getByRole("button", { name: /^image$/i }).click();
       await page.getByRole("menuitem", { name: /from psd/i }).click();

       // 3. The PsdPlaceDrawer opens; click the uploaded PSD then place layer 0.
       await expect(page.getByRole("dialog", { name: /place psd/i })).toBeVisible();
       await page.getByText("wave-2a-tiny.psd").click();
       await page.getByRole("button", { name: /^place: layer 1$/i }).click();

       // 4. The drawer closes; layers panel shows one image element.
       await expect(page.getByRole("dialog", { name: /place psd/i })).toBeHidden();
       await expect(page.getByTestId("layers-panel")).toContainText(/image/i);

       // 5. Save + publish.
       await page.getByRole("button", { name: /^save$/i }).click();
       await expect(page.getByText(/saved/i)).toBeVisible();
       await page.getByRole("button", { name: /^publish$/i }).click();
       await expect(page.getByText(/published/i)).toBeVisible();

       // 6. Open the rendered overlay route.
       const overlayUrl = `/overlay/v2/user/wave-2a-psd-demo?demo=1`;
       const overlayPage = await page.context().newPage();
       await overlayPage.goto(overlayUrl);
       await expect(overlayPage.locator("img")).toBeVisible({ timeout: 10_000 });
       const src = await overlayPage.locator("img").first().getAttribute("src");
       expect(src).toBeTruthy();
       expect(src!).toContain("overlay-user-assets");
     });

     test("uploading a non-PSD file shows bad_extension error", async ({ page }) => {
       await page.goto("/admin/broadcast/v2/builder/assets");
       const file = await page.locator('input[type="file"][accept*=".psd"]');
       const badFile = path.resolve(__dirname, "fixtures", "not-a-psd.png");
       // Create the dummy file inline (Playwright can use buffer)
       await file.setInputFiles({
         name: "not-a-psd.png",
         mimeType: "image/png",
         buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
       });
       await expect(page.getByText(/expected \.psd/i)).toBeVisible();
     });
   });
   ```

3. Run the spec:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-2a.spec.ts
   ```

   Expected: all 3 tests pass. If any fail, capture the trace via `--trace on`, diagnose, fix root cause, re-run.

4. Stage and commit:

   ```bash
   git add apps/web/tests/e2e/overlay-builder-wave-2a.spec.ts apps/web/tests/e2e/fixtures/wave-2a-tiny.psd
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/wave-2a): e2e — upload PSD, place layer, render

   Three Playwright scenarios:
     1. Upload PSD via /assets page; assert parsing indicator + final
        card with layer count.
     2. Create design → toolbar Image → From PSD → pick uploaded PSD →
        place layer 1 → save → publish → open /overlay/v2/user/<slug>
        and assert the placed sprite renders as <img> with a src
        pointing at the overlay-user-assets bucket.
     3. Bad-extension upload (.png filename) shows the friendly
        "Expected .psd" error.

   Fixture wave-2a-tiny.psd is a copy of the unit-test tiny.psd, the
   same 2-layer 64×64 PSD generated via ag-psd's writePsd helper.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 10: Full verification pass + commit

This task is the FINAL gate before declaring Wave 2A complete. Mirrors the acceptance gates in spec §17 + CLAUDE.md §§4, 11, 12. Push happens by the human operator after self-review; this plan stops at the local commit per the operator's brief.

**Files:**

- Modify: `tasks/todo.md` (append Wave 2A review section per CLAUDE.md workflow §5)
- Modify: `tasks/lessons.md` (any lessons surfaced during this verification pass per CLAUDE.md "Error log rule")
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md` (Status section)
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md` (RESUME line)

#### Step 1: Unit tests pass

```bash
npm --workspace apps/web run test
```

Expected: 0 failures. The new psd-parser (7) + assets (7) + assets-actions (8) + AssetsLibrary (6) + PsdPlaceDrawer (7) + psd-data-actions (4) tests all green. Plus the Wave 1A 50+ tests still pass (refactor of `gate()` into `assets-actions-gate.ts` is behavior-preserving).

If failures: fix root cause (no skipping). Re-run until clean.

#### Step 2: Lint clean

```bash
npm --workspace apps/web run lint
```

Expected: 0 errors. New code must not introduce new warnings.

#### Step 3: Build clean

```bash
npm --workspace apps/web run build
```

Expected: Production build succeeds. `prebuild` runs `sync:overlays` + `check:element-id-parity` — both must pass.

#### Step 4: E2E tests pass

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-2a.spec.ts
```

Expected: 3 specs pass.

Then re-run the full suite to confirm no regression in Wave 1A flows:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e
```

Expected: all 40+ specs pass. Watch `overlay-builder-wave-1a.spec.ts` particularly — the `gate()` refactor is the riskiest change to existing behavior.

#### Step 5: Visual regression pass

```bash
npm --workspace apps/web run e2e:visual-regression
```

Expected: all 16 built-in overlays unchanged. Wave 2A does NOT alter rendering of any built-in overlay — only adds new authoring surfaces.

#### Step 6: Manual Chrome browser end-to-end per CLAUDE.md §11

Per CLAUDE.md §11 (verify-before-show, non-negotiable): drive the full flow through Claude-in-Chrome before declaring the wave complete.

Procedure:

1. Ensure `NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true` is set in `apps/web/.env.local`.
2. Start dev server: `npx next dev -p 3030`.
3. Load Claude-in-Chrome tools via `ToolSearch select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__file_upload` and:
   1. Navigate `http://localhost:3030/login`, log in as `admin@cade.local` / `dev-admin-2026`.
   2. Navigate `http://localhost:3030/admin/broadcast/v2/builder/assets`. Confirm library loads with no console errors.
   3. Use `mcp__claude-in-chrome__file_upload` to upload `apps/web/src/server/overlays/builder/__fixtures__/tiny.psd`. Confirm parsing indicator appears, then a card titled "tiny.psd" with "2 layers" copy.
   4. Navigate to the library `/admin/broadcast/v2/builder`. Click **New Design**, title "Chrome PSD smoke", create.
   5. On the editor, click the Image toolbar button. Confirm popover appears with "Upload image" + "From PSD".
   6. Click "From PSD". Confirm the PsdPlaceDrawer opens with "tiny.psd" listed.
   7. Click "tiny.psd". Confirm 2 layers appear ("Layer 1", "Layer 2") + a "Flatten" button.
   8. Click `Place: Layer 1`. Confirm the drawer closes, the layers panel shows one image element, and the canvas Stage renders the sprite.
   9. Click **Save**. Confirm `data-dirty="false"`.
   10. Click **Publish**. Confirm status badge flips to "Published".
   11. Open `http://localhost:3030/overlay/v2/user/chrome-psd-smoke?demo=1`. Confirm a single `<img>` paints and `mcp__claude-in-chrome__read_console_messages` shows zero red errors.

If any step shows red errors or visible glitches, STOP. Fix root cause. Re-run from Step 1.

#### Step 7: Local commit of memory + tasks delta

Append to `tasks/todo.md` under a Wave 2A heading:

```md
## Wave 2A — PSD upload + layer-extract + place-on-canvas

### Review

- ✓ ag-psd installed; psd-parser wraps it with PsdParseError safety net.
- ✓ assets module: uploadPsd + listPsdAssets + listPsdLayers + getAsset + softDeleteAsset (all SupabaseClient-first).
- ✓ uploadPsdAction server action: discriminated-union response, perm-gated, rate-limited.
- ✓ Asset library page /admin/broadcast/v2/builder/assets with drop-zone + cards.
- ✓ Toolbar Image button → split-button popover (Upload image / From PSD).
- ✓ PsdPlaceDrawer: layer-picker dialog + place-on-canvas via store action.
- ✓ E2E spec covers upload → place → save → render.
- ✓ Unit + lint + build + e2e + visual-regression all green.
- ✓ Manual Chrome end-to-end smoke green.
```

Append a lesson entry to `tasks/lessons.md` if any surfaced during verification:

```md
**Date:** YYYY-MM-DD
**Context:** Wave 2A verification gate.
**Mistake:** <if any>
**Correction:** <commit ref>
**Rule for future:** <durable guard>
```

Update memory file `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md` Status section:

```md
- **Wave 2A SHIPPED <YYYY-MM-DD> commit <SHA>** — PSD upload pipeline live.
  ag-psd parses synchronously inside server action; produces flat PNG +
  per-layer sprites stored under overlay-user-assets/psd/. Toolbar Image
  button gained From PSD sub-option; PsdPlaceDrawer lists layers + lets
  user pick one or Flatten the composite to drop as image element.
  All Wave 2A surfaces gated by NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED.
- **Verification:** unit (39 new + 50+ existing), lint, build, e2e
  (3 new + 40+ existing), visual-regression all green. Manual Chrome
  smoke green.
- **Next:** Wave 2B writing-plans dispatch — Photopea iframe + bridge
  + edit-in-place round-trip.
```

Update the RESUME line at the top of `MEMORY.md`:

```md
- **🟢 RESUME <YYYY-MM-DD>:** [Overlay Builder Wave 2A SHIPPED](project_overlay_builder_2026_05_17.md). Commit `<SHA>`. PSD upload + ag-psd layer extract + place-on-canvas via toolbar split-button. Next: Wave 2B Photopea iframe plan.
```

Commit the memory + tasks deltas (no push — operator controls push):

```bash
git add tasks/todo.md tasks/lessons.md
git commit -m "$(cat <<'EOF'
docs(overlay-builder): wave 2A review + lessons log after verification gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(The `~/.claude/projects/.../memory/*.md` files live outside the repo and don't need a git commit — they're tracked by the harness.)

#### Step 8: Operator-driven push

Per the operator's instructions for this plan: do NOT push. The operator will review the local commits and push when satisfied.

**Final gate — declare Wave 2A complete only when ALL 7 steps green** (Step 8 is operator-controlled). Per CLAUDE.md §4: "Never mark a task complete without proving it works end-to-end. Build pass alone is not proof." This task is the proof bundle.

---

## Self-Review

This section documents the post-assembly checks per writing-plans self-review protocol. All issues found were patched inline before this section was appended; this section is the audit trail.

### (A) Spec coverage — Wave 2A scope from operator brief + spec §11

| # | Operator-brief task | Implementing task(s) | Status |
|---|---|---|---|
| 1 | Install `ag-psd` | Task 1 | Covered |
| 2 | Server module `psd-parser.ts` wrapping ag-psd with `parsePsd(buffer)` returning `{ flatPng, layers[], canvasWidth, canvasHeight }` | Task 2 | Covered |
| 3 | Asset routes — `uploadPsdAction(formData)` writes to bucket + runs `parsePsd` + creates rows for PSD + flat PNG + each sprite (with `psd_parent_asset_id`) | Task 3 (assets.ts) + Task 4 (uploadPsdAction) | Covered |
| 4 | PSD modal UI — Toolbar "Image" button gains "From PSD" sub-option opening a layer-picker drawer | Task 6 (toolbar split-button) + Task 7 (PsdPlaceDrawer) | Covered |
| 5 | "Place PSD" — click on a PSD asset → opens layer-picker → click a layer → spawns image element on canvas | Task 7 (PsdPlaceDrawer placeLayer + placeFlat) | Covered |
| 6 | Status / progress — UI surfaces "Parsing PSD..." while ag-psd runs | Task 5 (AssetsLibrary `isPending` + toast) + Task 7 (drawer loading state) | Covered |
| 7 | Size enforcement — MAX_PSD_BYTES = 100 MB hard reject, soft warn at 50 MB | Task 2 (constants) + Task 3 (assets module enforces) + Task 4 (action returns `too_large` code) + Task 5 (UI surfaces error toast + soft warn) | Covered |
| 8 | Memory safety — ag-psd parsing can OOM; wrap in try/catch + return graceful error | Task 2 (PsdParseError wraps RangeError) + Task 8 (defensive test for V8 RangeError) | Covered |
| 9 | E2E spec — upload, list layers, place layer, save, render via `/overlay/v2/user/<slug>` | Task 9 | Covered |
| 10 | Verification gate + push | Task 10 (push is operator-controlled per brief — local commit only) | Covered (push deferred to operator) |

**Spec §9 success criteria coverage:**

| Criterion | Implementing task(s) | Status |
|---|---|---|
| Admin uploads PSD; flat PNG + per-layer sprites written to `overlay-user-assets/psd/` | Tasks 3 + 4 | Covered |
| Builder UI "Place PSD" flow lists layers; user picks individual or "Flatten" | Task 7 | Covered |
| Hard cap 100 MB; soft warn 50 MB | Tasks 2 + 3 + 4 + 5 | Covered |
| Downsampling at canvas resolution | Deferred — Wave 2A passes raw sprite dimensions through; flat PNG matches PSD canvas. Downsample-to-1920×1080 is a Wave 2B perf optimization. | Documented |

Spec §11 explicitly lists Wave 2A as "PSD upload + server layer-extract via ag-psd, place-as-image flow". Photopea iframe / postMessage / bytes-back is Wave 2B. This plan does not implement Wave 2B.

**Result:** All 10 operator brief tasks mapped. All applicable spec §9 + §11 criteria covered. Photopea iframe correctly deferred to Wave 2B.

### (B) Placeholder scan

Grep run against the assembled plan for the red-flag patterns:

| Pattern | Hits | Notes |
|---|---|---|
| `TBD` | 0 | clean |
| `TODO` | 0 | clean (one occurrence inside narrative prose to call out future Wave 1B image+font upload — appropriate scope marker) |
| `to be filled` | 0 | clean |
| `implement later` | 0 | clean |
| `Add appropriate error handling` | 0 | clean |
| `add validation` | 0 | clean |
| `handle edge cases` | 0 | clean |
| `Similar to Task N` | 0 | clean |

**Result:** 0 placeholder issues found. Every task with code shows full implementation blocks plus failing-test → minimal-impl → passing-test cycle.

### (C) Type consistency

- Task 2 `psd-parser.ts` returns camelCase domain types (`flatPng`, `canvasWidth`, `canvasHeight`). Tasks 3 + 4 + 7 consume that shape directly.
- Task 3 `assets.ts` uses snake_case at the DB boundary (`AssetRow`) + camelCase at the public boundary (`Asset`, `PsdAssetSummary`, `PsdLayerSummary`). Mirrors the existing `designs.ts` row-to-domain pattern from Wave 1A.
- Task 4 `assets-actions.ts` returns the camelCase boundary shape — consumers of the action see camelCase. The Zod schemas in `assets-schemas.ts` describe the camelCase response shape (no DB-row leakage to clients).
- Task 7 `PsdPlaceDrawer` consumes camelCase shapes (from the action) + the camelCase `useBuilderStore` mutators introduced in Wave 1A.

**Implementation note:** `content.assetId` on the spawned image element holds either a UUID (for placed layers — points at `overlay_user_assets.id`) OR a storage path string (for `Flatten` — points at `overlay_user_assets.file_path` of the flat PNG). The compiler's image-element renderer (existing Wave 1A code) must tolerate both. If implementation finds the compiler is UUID-only, add a normalization step in the `image` element render path that detects path-shaped strings (contains `/`) and resolves them directly. Flagged here so the implementer adds the check before E2E lands; the E2E test would catch a regression but earlier surface is cheaper.

**Result:** No type-consistency patches required at plan time. One implementation note (assetId-shape tolerance) called out for the compiler boundary.

### (D) File-path consistency

All paths absolute from repo root (`apps/web/...`, `supabase/...`) or absolute Windows paths starting with `C:\Users\Sweez\.claude\...` for memory files. No mixed-style within a single task.

### (E) Migration sequencing

Wave 2A introduces NO new migrations — the `overlay_user_assets` table + `overlay-user-assets` storage bucket were created in Wave 1A migration `20260901000002_overlay_user_designs.sql`. Wave 2A only writes rows; it doesn't add columns. Future wave migrations (Wave 1B image upload, Wave 2B Photopea) use `20260901000003+`.

**Result:** No migrations added; existing schema sufficient.

### (F) Commit message format

All 10 commits in the plan use the HEREDOC pattern (`git commit -m "$(cat <<'EOF' ... EOF\n)"`) with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer on the final line of the body. Spot-check:

- Task 1 (install ag-psd) — HEREDOC + trailer.
- Task 3 (assets module) — HEREDOC + trailer.
- Task 7 (PsdPlaceDrawer) — HEREDOC + trailer.
- Task 9 (E2E spec) — HEREDOC + trailer.
- Task 10 final review commit — HEREDOC + trailer.

**Result:** 10/10 commits compliant.

### (G) TDD ordering

Every task with code follows: failing-test author → run-and-show-FAIL → minimal implementation → run-and-show-PASS → commit.

**Tasks exempt from TDD** (legitimately don't fit the test-driven cadence):

- **Task 1 (install dependency):** No test code possible. Gate: `grep` verifies presence + lint + unit-test pass with new dep installed.
- **Task 8 (OOM safety net + smoke):** The OOM-safety test IS added before commit. The smoke is one-shot operator-invoked verification, deleted after run.
- **Task 10 (full verification gate):** Final acceptance test runs the entire `test + lint + build + e2e + visual-regression + manual Chrome` suite. Not a unit-test cycle.

All other tasks (2-7, 9) document explicit failing-test → impl → passing-test cycles.

**Result:** TDD ordering compliant. Exempt tasks document alternate gates.

### Self-Review Summary

| Check | Found | Fixed | Notes |
|---|---|---|---|
| (A) Spec coverage | 10 operator brief tasks + spec §9/§11 criteria | 0 missing | Photopea iframe correctly deferred to Wave 2B; downsample-to-1920×1080 deferred to Wave 2B perf optimization |
| (B) Placeholder scan | 0 issues | 0 | Plan is implementation-complete |
| (C) Type consistency | 1 implementation note (compiler assetId-shape tolerance) | 0 patched | Note documented for implementer; underlying contract clear |
| (D) File-path consistency | No issues | 0 | All absolute paths |
| (E) Migration sequencing | No new migrations | n/a | Wave 1A schema sufficient |
| (F) Commit message format | 10/10 HEREDOC + trailer | 0 | All compliant |
| (G) TDD ordering | 3 legitimate exemptions (install, smoke, final gate) | 0 | Documented |

**Wave 2A plan ready for execution.** Operator pushes after local verification gate per brief.
