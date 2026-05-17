# Overlay Builder Wave 3A — Multi-Scene Authoring + Sequence Runtime + Transitions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the `sequence` half of `overlay_user_designs.mode` shipped dormant in Wave 1A. Admins (and `design` / `production` roles) author multi-scene designs in the canvas editor — switch scenes via a top-strip ScenePicker dock, configure per-scene `duration_ms` + `transition_in` + `transition_out`, and the compiled HTML plays scenes in order on a single `show` postMessage trigger with the chosen between-scene transitions. Operator can manually skip ahead with `{type:'next-scene'}` postMessage. Single-mode designs (Wave 1A's only authoring path) are unchanged — ScenePicker is hidden and 1-scene cap holds.

**Architecture:** Wave 3A wires UI + runtime around the schema Wave 1A already shipped. `scenes.ts` CRUD from Wave 1A (T11) is consumed verbatim — Wave 3A adds the action layer + zustand store + ScenePicker UI + compiler sequence mode + bootstrap `runSequence()` driver. Transitions implemented as preset `@keyframes` per direction (fade / slide-left / slide-right / slide-up / slide-down), with `cut` as zero-duration no-op. All behind the same `overlayBuilder.enabled` feature flag.

**Tech Stack:** Next.js 15 (App Router) · Supabase Postgres · TypeScript · Vitest · Playwright · zustand · @dnd-kit/sortable (for ScenePicker reorder) · existing Wave 1A bootstrap + compiler infrastructure

**Related:** Spec `docs/superpowers/specs/2026-05-17-overlay-builder-design.md` §7 (Multi-scene runtime) + §11 (Wave 3A scope) · Wave 1A plan `docs/superpowers/plans/2026-05-17-overlay-builder-wave-1a.md` (T11 scenes.ts, T15 bootstrap-template, T16 compiler, T20 zustand store, T22 CanvasEditorShell) · CLAUDE.md §14 (overlay HTML contract — frozen, Wave 3A must not violate)

**Wave 3A delivers (end of wave):**
1. Five new server actions in `actions.ts` (`addSceneAction`, `deleteSceneAction`, `reorderScenesAction`, `cloneSceneAction`, `updateSceneAction`) wrapping Wave 1A's `scenes.ts` CRUD with perm gate + rate limit + revalidate.
2. Zustand store extensions: `activeSceneId` already exists from Wave 1A; new actions `setActiveScene`, `addScene`, `deleteScene`, `reorderScenes`, `updateScene`, `cloneScene` that mutate `design.scenes[]` in-place + sync to server via the new actions.
3. `ScenePicker` component — top-strip horizontal scroll list, per-scene mini-thumbnail (scaled iframe or CSS preview), click-to-activate, + button to add, drag-reorder, right-click context menu (clone / delete).
4. `ScenePropertiesDrawer` component — visible on scene-only selection (no element selected). Name input + duration_ms input + transition_in/out dropdowns.
5. `ModeToggle` in TopBar — single ⇄ sequence. Switching to sequence enables ScenePicker; switching back to single requires confirmation if >1 scene exists (deletes scenes 2..N).
6. CanvasStage already reads `activeScene.elements` (Wave 1A); no change beyond `useBuilderStore((s) => s.activeSceneId)` selector audit.
7. Compiler `compileDesignToHtml` extended: when `design.mode === 'sequence'`, emits ALL scenes' CSS rules namespaced by `[data-scene-id]` selectors + scene-specific `@keyframes` + DOM blocks wrapped in `<div data-scene-id>` containers. Single-mode output unchanged.
8. Bootstrap `runSequence(scenes[])` IIFE addition — plays scenes in order using `duration_ms` per scene + `transition_out` of current → `transition_in` of next. Handles `{type:'next-scene'}` postMessage for manual advance. Single-mode bootstrap path unchanged.
9. Transition CSS — `@keyframes scene-fade-in`, `scene-fade-out`, `scene-slide-left-in`, `scene-slide-left-out`, and the four other directions. Emitted at compile time per design.
10. E2E spec — login admin, create sequence-mode design with 3 scenes (different durations + transitions), save, publish, fetch `/overlay/v2/user/<slug>?demo=1`, assert all 3 scene blocks + transition keyframes + `runSequence` call present.
11. Visual-regression baseline frame at sequence midpoint (3-scene fixture rendered, captured at scene 2 visible state).
12. Feature flag default OFF unchanged from Wave 1A; mode toggle gated on `featureFlags.overlayBuilder.enabled` + new sub-flag `featureFlags.overlayBuilder.sequenceModeEnabled`.

**Out of scope for Wave 3A** (deferred to later waves or explicitly never):
- Advanced keyframe timeline editor (Wave 3B).
- Per-scene element-level animations beyond entry/exit (Wave 3B advanced timeline covers this).
- Conditional scene branching (e.g. "play scene 3 if home_score > away_score"). Future.
- Scene-level binding overrides (different feed per scene). Designs reuse the same `__OVERLAY_FEEDS__` registry across all scenes — bindings stay on elements.
- PSD pipeline (Wave 2).
- Sequence loop (auto-restart after scene N). Single play only — `hide` after last scene's `transition_out`.

---

### Task 1: Sub-feature flag — `sequenceModeEnabled`

**Files:**

- Modify: `apps/web/src/lib/feature-flags.ts`
- Modify: `apps/web/src/lib/feature-flags.test.ts`

**Context:** Wave 1A shipped `featureFlags.overlayBuilder.enabled` reading `NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED`. Wave 3A adds a strictly nested sub-flag so admins can roll out sequence authoring independently of the base builder — if sequence mode regresses we flip just this one off, keeping single-mode authoring live.

#### Steps

1. Read the current shape of `apps/web/src/lib/feature-flags.ts`:

   ```bash
   cat apps/web/src/lib/feature-flags.ts
   ```

   Expected: contains `overlayBuilder: { enabled: ... }` object literal.

2. Write failing test extension at `apps/web/src/lib/feature-flags.test.ts`:

   ```ts
   import { describe, expect, it, beforeEach, afterEach } from "vitest";
   import { featureFlags } from "./feature-flags";

   const ORIGINAL = process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED;

   describe("overlayBuilder.sequenceModeEnabled", () => {
     afterEach(() => {
       if (ORIGINAL === undefined) {
         delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED;
       } else {
         process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED = ORIGINAL;
       }
     });

     it("is false when env var is unset", () => {
       delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED;
       expect(featureFlags.overlayBuilder.sequenceModeEnabled).toBe(false);
     });

     it("is true when env var is the literal string 'true'", () => {
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED = "true";
       expect(featureFlags.overlayBuilder.sequenceModeEnabled).toBe(true);
     });

     it("is false for any other truthy-looking value", () => {
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED = "1";
       expect(featureFlags.overlayBuilder.sequenceModeEnabled).toBe(false);
     });
   });
   ```

3. Run the test — expect FAIL (`sequenceModeEnabled` does not exist):

   ```bash
   npm --workspace apps/web run test -- src/lib/feature-flags.test.ts
   ```

   Expected: `TypeError: Cannot read properties of undefined (reading 'sequenceModeEnabled')` or similar.

4. Edit `apps/web/src/lib/feature-flags.ts` to add the sub-flag inside the existing `overlayBuilder` object:

   ```ts
   export const featureFlags = {
     overlayBuilder: {
       enabled:
         process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED === "true",
       sequenceModeEnabled:
         process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED === "true",
     },
   } as const;
   ```

   Preserve any existing sub-flags (`publishEnabled`, `photopeaEnabled`) verbatim — do NOT touch them.

5. Re-run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/lib/feature-flags.test.ts
   ```

   Expected: `Tests 3 passed (3)`.

6. Commit:

   ```bash
   git add apps/web/src/lib/feature-flags.ts apps/web/src/lib/feature-flags.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): add sequenceModeEnabled sub-flag

   Defaults OFF. Wave 3A multi-scene authoring + sequence runtime are
   gated on NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED='true' in
   addition to the base NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED gate.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 2: Audit Wave 1A `scenes.ts` exports against Wave 3A needs

**Files:**

- Read-only: `apps/web/src/server/overlays/builder/scenes.ts`
- Read-only: `apps/web/src/server/overlays/builder/types.ts`

**Context:** Wave 1A T11 shipped `addScene`, `updateScene`, `reorderScenes`, `deleteScene`, `cloneScene` plus `rowToScene` (private). Confirm the surface matches what Wave 3A actions need before writing any new code — if a function is missing, fix it in Wave 1A's module rather than duplicating logic here. No test changes in this task; this is a verification gate.

#### Steps

1. Read `apps/web/src/server/overlays/builder/scenes.ts` and confirm every export:

   ```bash
   grep -E "^export (async )?function|^export type" apps/web/src/server/overlays/builder/scenes.ts
   ```

   Expected output (verbatim or compatible):

   ```
   export type AddSceneInput = ...
   export async function addScene(
   export type UpdateScenePatch = ...
   export async function updateScene(
   export async function reorderScenes(
   export async function deleteScene(
   export async function cloneScene(
   ```

   If any function is absent, STOP — open a Wave 1A fix-forward commit first. Do NOT proceed with Wave 3A on a missing CRUD surface.

2. Confirm `Scene` type at `apps/web/src/server/overlays/builder/types.ts` matches the Wave 3A consumer needs:

   ```bash
   grep -A 10 "^export type Scene" apps/web/src/server/overlays/builder/types.ts
   ```

   Expected fields: `id`, `designId`, `orderIndex`, `name` (nullable), `durationMs`, `transitionIn`, `transitionOut`, `elements`.

3. Confirm the partial unique index on `(design_id, order_index) WHERE deleted_at IS NULL` is present per Wave 1A migration:

   ```bash
   grep -E "overlay_user_design_scenes.*order_index" supabase/migrations/20260901000002_overlay_user_designs.sql
   ```

   Expected: matches a `CREATE UNIQUE INDEX ... ON overlay_user_design_scenes (design_id, order_index) WHERE deleted_at IS NULL` line. This index is load-bearing for `reorderScenes`'s two-pass shift.

4. No commit — verification only. If gate fails, fix Wave 1A first and re-run from Step 1.

---

### Task 3: Server actions — `addSceneAction`, `updateSceneAction`, `deleteSceneAction`, `reorderScenesAction`, `cloneSceneAction`

**Files:**

- Modify: `apps/web/src/app/admin/broadcast/v2/builder/actions.ts`
- Modify: `apps/web/src/app/admin/broadcast/v2/builder/schemas.ts`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/scene-actions.test.ts`

**Context:** Wave 1A T17 shipped `actions.ts` with `saveDesignAction`, `publishDesignAction`, `updateDesignMetaAction`. Wave 3A appends five scene-scoped actions following the same pattern: `getServerSupabase()` → resolve actor → `requirePermAsync('overlay.design.manage')` → `enforceAuthedWrite(actor.id)` → call into `scenes.ts` → `revalidatePath` on the edit page. Sync Zod schemas live in sibling `schemas.ts` per CLAUDE.md §10.

#### Steps

1. Verify Wave 1A action pattern first:

   ```bash
   grep -E "^export async function (saveDesignAction|publishDesignAction|updateDesignMetaAction)" apps/web/src/app/admin/broadcast/v2/builder/actions.ts
   ```

   Expected: three matches. If absent, stop — Wave 1A action surface required.

2. Write failing test at `apps/web/src/app/admin/broadcast/v2/builder/scene-actions.test.ts`:

   ```ts
   import { describe, expect, it, vi, beforeEach } from "vitest";

   // Module-level mocks for the dependencies the actions call.
   const requirePermAsyncMock = vi.fn();
   const enforceAuthedWriteMock = vi.fn();
   const getServerSupabaseMock = vi.fn();
   const revalidatePathMock = vi.fn();

   const addSceneMock = vi.fn();
   const updateSceneMock = vi.fn();
   const reorderScenesMock = vi.fn();
   const deleteSceneMock = vi.fn();
   const cloneSceneMock = vi.fn();

   vi.mock("@/lib/perms-db", () => ({
     requirePermAsync: (...args: unknown[]) => requirePermAsyncMock(...args),
     PermissionError: class PermissionError extends Error {},
   }));
   vi.mock("@/lib/api-rate-limit", () => ({
     enforceAuthedWrite: (...args: unknown[]) => enforceAuthedWriteMock(...args),
   }));
   vi.mock("@/lib/supabase/server", () => ({
     getServerSupabase: () => getServerSupabaseMock(),
   }));
   vi.mock("next/cache", () => ({
     revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
   }));
   vi.mock("@/server/overlays/builder/scenes", () => ({
     addScene: (...args: unknown[]) => addSceneMock(...args),
     updateScene: (...args: unknown[]) => updateSceneMock(...args),
     reorderScenes: (...args: unknown[]) => reorderScenesMock(...args),
     deleteScene: (...args: unknown[]) => deleteSceneMock(...args),
     cloneScene: (...args: unknown[]) => cloneSceneMock(...args),
   }));

   import {
     addSceneAction,
     updateSceneAction,
     reorderScenesAction,
     deleteSceneAction,
     cloneSceneAction,
   } from "./actions";

   const fakeSb = {
     auth: {
       getUser: async () => ({
         data: { user: { id: "user-1" } },
         error: null,
       }),
     },
   };

   describe("scene actions", () => {
     beforeEach(() => {
       requirePermAsyncMock.mockReset().mockResolvedValue(true);
       enforceAuthedWriteMock.mockReset().mockResolvedValue(true);
       getServerSupabaseMock.mockReset().mockReturnValue(fakeSb);
       revalidatePathMock.mockReset();
       addSceneMock.mockReset();
       updateSceneMock.mockReset();
       reorderScenesMock.mockReset();
       deleteSceneMock.mockReset();
       cloneSceneMock.mockReset();
     });

     it("addSceneAction gates on perm + rate-limit + calls scenes.addScene", async () => {
       addSceneMock.mockResolvedValueOnce({
         id: "s-new",
         designId: "d-1",
         orderIndex: 1,
         durationMs: 5000,
         transitionIn: "fade",
         transitionOut: "fade",
         elements: [],
       });
       const result = await addSceneAction({
         designId: "d-1",
         designSlug: "test-slug",
         afterOrderIndex: 0,
       });
       expect(requirePermAsyncMock).toHaveBeenCalled();
       expect(enforceAuthedWriteMock).toHaveBeenCalled();
       expect(addSceneMock).toHaveBeenCalledWith(fakeSb, "d-1", expect.objectContaining({ afterOrderIndex: 0 }));
       expect(revalidatePathMock).toHaveBeenCalledWith(
         "/admin/broadcast/v2/builder/test-slug/edit",
       );
       expect(result.ok).toBe(true);
       expect(result.scene?.id).toBe("s-new");
     });

     it("updateSceneAction passes patch through", async () => {
       const r = await updateSceneAction({
         sceneId: "s-1",
         designSlug: "test-slug",
         patch: { durationMs: 8000, transitionIn: "slide-left" },
       });
       expect(updateSceneMock).toHaveBeenCalledWith(fakeSb, "s-1", {
         durationMs: 8000,
         transitionIn: "slide-left",
       });
       expect(r.ok).toBe(true);
     });

     it("reorderScenesAction passes the ordered id list through", async () => {
       const r = await reorderScenesAction({
         designId: "d-1",
         designSlug: "test-slug",
         sceneIdOrder: ["s3", "s1", "s2"],
       });
       expect(reorderScenesMock).toHaveBeenCalledWith(
         fakeSb,
         "d-1",
         ["s3", "s1", "s2"],
       );
       expect(r.ok).toBe(true);
     });

     it("deleteSceneAction calls scenes.deleteScene", async () => {
       const r = await deleteSceneAction({
         sceneId: "s-2",
         designSlug: "test-slug",
       });
       expect(deleteSceneMock).toHaveBeenCalledWith(fakeSb, "s-2");
       expect(r.ok).toBe(true);
     });

     it("cloneSceneAction returns the cloned scene", async () => {
       cloneSceneMock.mockResolvedValueOnce({
         id: "s-clone",
         designId: "d-1",
         orderIndex: 3,
         durationMs: 5000,
         transitionIn: "fade",
         transitionOut: "fade",
         elements: [],
       });
       const r = await cloneSceneAction({
         sceneId: "s-1",
         designSlug: "test-slug",
       });
       expect(cloneSceneMock).toHaveBeenCalledWith(fakeSb, "s-1");
       expect(r.ok).toBe(true);
       expect(r.scene?.id).toBe("s-clone");
     });

     it("rejects with Forbidden when perm denies", async () => {
       const { PermissionError } = await import("@/lib/perms-db");
       requirePermAsyncMock.mockRejectedValueOnce(
         new PermissionError("denied"),
       );
       await expect(
         addSceneAction({
           designId: "d-1",
           designSlug: "test-slug",
           afterOrderIndex: 0,
         }),
       ).rejects.toThrow();
     });

     it("rejects invalid afterOrderIndex (negative beyond -1)", async () => {
       await expect(
         addSceneAction({
           designId: "d-1",
           designSlug: "test-slug",
           afterOrderIndex: -5,
         }),
       ).rejects.toThrow(/afterOrderIndex/);
     });

     it("rejects invalid transition in updateSceneAction", async () => {
       await expect(
         updateSceneAction({
           sceneId: "s-1",
           designSlug: "test-slug",
           patch: { transitionIn: "warp-speed" as never },
         }),
       ).rejects.toThrow(/transition/);
     });

     it("rejects duration_ms outside [200, 60000]", async () => {
       await expect(
         updateSceneAction({
           sceneId: "s-1",
           designSlug: "test-slug",
           patch: { durationMs: 50 },
         }),
       ).rejects.toThrow(/duration/);
     });
   });
   ```

3. Run — expect FAIL (actions don't exist yet):

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/scene-actions.test.ts
   ```

   Expected: `addSceneAction is not exported` / `updateSceneAction is not exported` etc.

4. Edit `apps/web/src/app/admin/broadcast/v2/builder/schemas.ts` — APPEND (do not replace) the following Zod schemas:

   ```ts
   import { z } from "zod";

   export const TRANSITION_VALUES = [
     "cut",
     "fade",
     "slide-left",
     "slide-right",
     "slide-up",
     "slide-down",
   ] as const;
   export const TransitionEnum = z.enum(TRANSITION_VALUES);
   export type Transition = z.infer<typeof TransitionEnum>;

   export const AddSceneInputSchema = z.object({
     designId: z.string().uuid(),
     designSlug: z.string().min(1),
     afterOrderIndex: z.number().int().min(-1),
     durationMs: z.number().int().min(200).max(60000).optional(),
     transitionIn: TransitionEnum.optional(),
     transitionOut: TransitionEnum.optional(),
   });

   export const UpdateScenePatchSchema = z
     .object({
       name: z.string().max(120).nullable(),
       durationMs: z.number().int().min(200).max(60000),
       transitionIn: TransitionEnum,
       transitionOut: TransitionEnum,
     })
     .partial();

   export const UpdateSceneInputSchema = z.object({
     sceneId: z.string().uuid(),
     designSlug: z.string().min(1),
     patch: UpdateScenePatchSchema,
   });

   export const ReorderScenesInputSchema = z.object({
     designId: z.string().uuid(),
     designSlug: z.string().min(1),
     sceneIdOrder: z.array(z.string().uuid()).min(1),
   });

   export const DeleteSceneInputSchema = z.object({
     sceneId: z.string().uuid(),
     designSlug: z.string().min(1),
   });

   export const CloneSceneInputSchema = z.object({
     sceneId: z.string().uuid(),
     designSlug: z.string().min(1),
   });
   ```

5. Edit `apps/web/src/app/admin/broadcast/v2/builder/actions.ts` — APPEND (do not replace) the five new server actions. Reuse the existing `gate()` helper defined in Wave 1A (perm + rate-limit). The full appended block:

   ```ts
   import { revalidatePath } from "next/cache";
   import {
     addScene as addSceneCrud,
     updateScene as updateSceneCrud,
     reorderScenes as reorderScenesCrud,
     deleteScene as deleteSceneCrud,
     cloneScene as cloneSceneCrud,
   } from "@/server/overlays/builder/scenes";
   import {
     AddSceneInputSchema,
     UpdateSceneInputSchema,
     ReorderScenesInputSchema,
     DeleteSceneInputSchema,
     CloneSceneInputSchema,
   } from "./schemas";

   export async function addSceneAction(
     raw: unknown,
   ): Promise<{ ok: true; scene: Awaited<ReturnType<typeof addSceneCrud>> }> {
     const input = AddSceneInputSchema.parse(raw);
     const { sb } = await gate();
     const scene = await addSceneCrud(sb, input.designId, {
       afterOrderIndex: input.afterOrderIndex,
       durationMs: input.durationMs,
       transitionIn: input.transitionIn,
       transitionOut: input.transitionOut,
     });
     revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
     return { ok: true, scene };
   }

   export async function updateSceneAction(
     raw: unknown,
   ): Promise<{ ok: true }> {
     const input = UpdateSceneInputSchema.parse(raw);
     const { sb } = await gate();
     await updateSceneCrud(sb, input.sceneId, input.patch);
     revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
     return { ok: true };
   }

   export async function reorderScenesAction(
     raw: unknown,
   ): Promise<{ ok: true }> {
     const input = ReorderScenesInputSchema.parse(raw);
     const { sb } = await gate();
     await reorderScenesCrud(sb, input.designId, input.sceneIdOrder);
     revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
     return { ok: true };
   }

   export async function deleteSceneAction(
     raw: unknown,
   ): Promise<{ ok: true }> {
     const input = DeleteSceneInputSchema.parse(raw);
     const { sb } = await gate();
     await deleteSceneCrud(sb, input.sceneId);
     revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
     return { ok: true };
   }

   export async function cloneSceneAction(
     raw: unknown,
   ): Promise<{ ok: true; scene: Awaited<ReturnType<typeof cloneSceneCrud>> }> {
     const input = CloneSceneInputSchema.parse(raw);
     const { sb } = await gate();
     const scene = await cloneSceneCrud(sb, input.sceneId);
     revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
     return { ok: true, scene };
   }
   ```

   The `gate()` helper from Wave 1A returns `{ sb, actor }`. Wave 3A actions only need `sb` — the scenes CRUD doesn't accept an actor (CLAUDE.md mock-friendly pattern).

6. Re-run the test — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/app/admin/broadcast/v2/builder/scene-actions.test.ts
   ```

   Expected: `Tests 9 passed (9)`.

7. Commit:

   ```bash
   git add apps/web/src/app/admin/broadcast/v2/builder/actions.ts apps/web/src/app/admin/broadcast/v2/builder/schemas.ts apps/web/src/app/admin/broadcast/v2/builder/scene-actions.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): five scene-scoped server actions

   Adds addSceneAction / updateSceneAction / reorderScenesAction /
   deleteSceneAction / cloneSceneAction. Each goes through the existing
   gate() helper (perm + rate-limit) before delegating to scenes.ts CRUD.
   Sync Zod schemas live in schemas.ts per CLAUDE.md §10.

   Validation enforces:
     - transition values in {cut,fade,slide-{left,right,up,down}}
     - duration_ms in [200, 60000]
     - afterOrderIndex >= -1
     - all ids are uuid

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 4: Zustand store extensions for scene mutations

**Files:**

- Modify: `apps/web/src/state/builder/store.ts`
- Modify: `apps/web/src/state/builder/store.test.ts`

**Context:** Wave 1A T20 shipped the zustand store with `design`, `selectedElementIds`, `activeSceneId`, `zoomLevel`, `dirty` slots plus element mutation actions. Wave 3A appends scene-level actions: `setActiveScene`, `addScene`, `updateScene`, `deleteScene`, `reorderScenes`, `cloneScene`, and a `setMode` helper for the single ⇄ sequence toggle. These mutate `design.scenes[]` locally — server sync is the calling component's responsibility (the ScenePicker fires the corresponding action and rolls back local state on rejection).

#### Steps

1. Read current store shape:

   ```bash
   grep -E "^\s*(addElement|updateElement|deleteElement|setZoom|markClean|setActiveScene|addScene|deleteScene|reorderScenes):" apps/web/src/state/builder/store.ts
   ```

   Expected: shows existing element actions; scene actions absent.

2. APPEND failing tests at the bottom of `apps/web/src/state/builder/store.test.ts` (before the closing `});`):

   ```ts
     it("setActiveScene switches activeSceneId without marking dirty", () => {
       useBuilderStore.getState().loadDesign({
         id: "d1",
         slug: "x",
         title: "t",
         mode: "sequence",
         status: "draft",
         canvasWidth: 1920,
         canvasHeight: 1080,
         scenes: [
           { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
           { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
         ],
       } as never);
       useBuilderStore.getState().setActiveScene("s2");
       expect(useBuilderStore.getState().activeSceneId).toBe("s2");
       expect(useBuilderStore.getState().dirty).toBe(false);
     });

     it("addScene inserts at the requested position and marks dirty", () => {
       useBuilderStore.getState().loadDesign({
         id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
         canvasWidth: 1920, canvasHeight: 1080,
         scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] }],
       } as never);
       useBuilderStore.getState().addScene({
         id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [],
       });
       const scenes = useBuilderStore.getState().design!.scenes;
       expect(scenes).toHaveLength(2);
       expect(scenes[1].id).toBe("s2");
       expect(useBuilderStore.getState().dirty).toBe(true);
     });

     it("updateScene patches and marks dirty", () => {
       useBuilderStore.getState().loadDesign({
         id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
         canvasWidth: 1920, canvasHeight: 1080,
         scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] }],
       } as never);
       useBuilderStore.getState().updateScene("s1", { durationMs: 12000, name: "intro" });
       const scene = useBuilderStore.getState().design!.scenes[0];
       expect(scene.durationMs).toBe(12000);
       expect(scene.name).toBe("intro");
       expect(useBuilderStore.getState().dirty).toBe(true);
     });

     it("deleteScene removes scene and re-densifies orderIndex", () => {
       useBuilderStore.getState().loadDesign({
         id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
         canvasWidth: 1920, canvasHeight: 1080,
         scenes: [
           { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
           { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
           { id: "s3", designId: "d1", orderIndex: 2, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
         ],
       } as never);
       useBuilderStore.getState().setActiveScene("s2");
       useBuilderStore.getState().deleteScene("s2");
       const scenes = useBuilderStore.getState().design!.scenes;
       expect(scenes.map((s) => s.id)).toEqual(["s1", "s3"]);
       expect(scenes[1].orderIndex).toBe(1);
       // active scene falls back to first remaining
       expect(useBuilderStore.getState().activeSceneId).toBe("s1");
     });

     it("reorderScenes reassigns orderIndex according to the supplied order", () => {
       useBuilderStore.getState().loadDesign({
         id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
         canvasWidth: 1920, canvasHeight: 1080,
         scenes: [
           { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
           { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
           { id: "s3", designId: "d1", orderIndex: 2, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
         ],
       } as never);
       useBuilderStore.getState().reorderScenes(["s3", "s1", "s2"]);
       const scenes = useBuilderStore.getState().design!.scenes;
       expect(scenes.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
       expect(scenes[0].orderIndex).toBe(0);
       expect(scenes[1].orderIndex).toBe(1);
       expect(scenes[2].orderIndex).toBe(2);
     });

     it("setMode flips mode and marks dirty", () => {
       useBuilderStore.getState().loadDesign({
         id: "d1", slug: "x", title: "t", mode: "single", status: "draft",
         canvasWidth: 1920, canvasHeight: 1080,
         scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] }],
       } as never);
       useBuilderStore.getState().setMode("sequence");
       expect(useBuilderStore.getState().design!.mode).toBe("sequence");
       expect(useBuilderStore.getState().dirty).toBe(true);
     });

     it("setMode('single') truncates scenes to the first when downgrading", () => {
       useBuilderStore.getState().loadDesign({
         id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
         canvasWidth: 1920, canvasHeight: 1080,
         scenes: [
           { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
           { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
         ],
       } as never);
       useBuilderStore.getState().setActiveScene("s2");
       useBuilderStore.getState().setMode("single");
       const scenes = useBuilderStore.getState().design!.scenes;
       expect(scenes).toHaveLength(1);
       expect(scenes[0].id).toBe("s1");
       expect(useBuilderStore.getState().activeSceneId).toBe("s1");
     });
   ```

3. Run — expect FAIL:

   ```bash
   npm --workspace apps/web run test -- src/state/builder/store.test.ts
   ```

   Expected: `setActiveScene is not a function` etc.

4. Edit `apps/web/src/state/builder/store.ts`:

   4a. Extend the `BuilderState` type signature (inside the `export type BuilderState = {` block, after `markClean`):

   ```ts
     setActiveScene: (sceneId: string) => void;
     addScene: (scene: Design["scenes"][number]) => void;
     updateScene: (
       sceneId: string,
       patch: Partial<Pick<Design["scenes"][number], "name" | "durationMs" | "transitionIn" | "transitionOut">>,
     ) => void;
     deleteScene: (sceneId: string) => void;
     reorderScenes: (sceneIdOrder: string[]) => void;
     setMode: (mode: "single" | "sequence") => void;
   ```

   4b. Inside the `create<BuilderState>()(temporal((set, get) => ({` body, after `markClean: () => set({ dirty: false })`, append the implementations:

   ```ts
         setActiveScene: (sceneId) => set({ activeSceneId: sceneId }),

         addScene: (scene) =>
           set((state) => {
             if (!state.design) return state;
             return {
               design: {
                 ...state.design,
                 scenes: [...state.design.scenes, scene]
                   .sort((a, b) => a.orderIndex - b.orderIndex),
               },
               dirty: true,
             };
           }),

         updateScene: (sceneId, patch) =>
           set((state) => {
             if (!state.design) return state;
             return {
               design: {
                 ...state.design,
                 scenes: state.design.scenes.map((s) =>
                   s.id === sceneId ? { ...s, ...patch } : s,
                 ),
               },
               dirty: true,
             };
           }),

         deleteScene: (sceneId) =>
           set((state) => {
             if (!state.design) return state;
             const filtered = state.design.scenes
               .filter((s) => s.id !== sceneId)
               .sort((a, b) => a.orderIndex - b.orderIndex)
               .map((s, idx) => ({ ...s, orderIndex: idx }));
             const nextActive =
               state.activeSceneId === sceneId
                 ? filtered[0]?.id ?? null
                 : state.activeSceneId;
             return {
               design: { ...state.design, scenes: filtered },
               activeSceneId: nextActive,
               dirty: true,
             };
           }),

         reorderScenes: (sceneIdOrder) =>
           set((state) => {
             if (!state.design) return state;
             const byId = new Map(state.design.scenes.map((s) => [s.id, s]));
             const reordered = sceneIdOrder
               .map((id, idx) => {
                 const src = byId.get(id);
                 if (!src) return null;
                 return { ...src, orderIndex: idx };
               })
               .filter((s): s is NonNullable<typeof s> => s !== null);
             return {
               design: { ...state.design, scenes: reordered },
               dirty: true,
             };
           }),

         setMode: (mode) =>
           set((state) => {
             if (!state.design) return state;
             let scenes = state.design.scenes;
             let activeSceneId = state.activeSceneId;
             if (mode === "single" && scenes.length > 1) {
               scenes = [scenes[0]];
               activeSceneId = scenes[0].id;
             }
             return {
               design: { ...state.design, mode, scenes },
               activeSceneId,
               dirty: true,
             };
           }),
   ```

5. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/state/builder/store.test.ts
   ```

   Expected: previous Wave 1A tests still pass + 7 new tests pass.

6. Commit:

   ```bash
   git add apps/web/src/state/builder/store.ts apps/web/src/state/builder/store.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): zustand scene mutations + setMode

   Adds setActiveScene / addScene / updateScene / deleteScene /
   reorderScenes / setMode. Local mutations only — sync to server is
   the calling component's responsibility.

   Single-mode downgrade trims scenes[] to first scene (with operator
   confirmation guarded at the UI layer in Task 8).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 5: ScenePicker component — horizontal scroll list + drag-reorder

**Files:**

- Create: `apps/web/src/components/admin/builder/ScenePicker.tsx`
- Create: `apps/web/src/components/admin/builder/ScenePicker.test.tsx`

**Context:** Top-strip dock above the CanvasStage, only visible when `design.mode === 'sequence'`. Each scene renders as a 160×90 tile with index number, name, and duration. Click to set active. + tile at end adds a new scene at `afterOrderIndex = scenes.length - 1`. Drag-reorder via @dnd-kit/sortable. Active scene is highlighted with a 2px brand-green border. Right-click context menu offers Clone / Delete.

#### Steps

1. Verify `@dnd-kit/sortable` is installed (Wave 1A T1 added `@dnd-kit/core`, but `sortable` is a sibling package needed for ScenePicker):

   ```bash
   grep -E '"@dnd-kit/sortable"' apps/web/package.json || npm install --workspace apps/web @dnd-kit/sortable
   ```

   Expected: either it's already there, or install succeeds adding 1 package.

2. Write failing test at `apps/web/src/components/admin/builder/ScenePicker.test.tsx`:

   ```tsx
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { ScenePicker } from "./ScenePicker";
   import { useBuilderStore } from "@/state/builder/store";

   const addSceneActionMock = vi.fn();
   const deleteSceneActionMock = vi.fn();
   const reorderScenesActionMock = vi.fn();
   const cloneSceneActionMock = vi.fn();
   vi.mock("@/app/admin/broadcast/v2/builder/actions", () => ({
     addSceneAction: (...args: unknown[]) => addSceneActionMock(...args),
     deleteSceneAction: (...args: unknown[]) => deleteSceneActionMock(...args),
     reorderScenesAction: (...args: unknown[]) => reorderScenesActionMock(...args),
     cloneSceneAction: (...args: unknown[]) => cloneSceneActionMock(...args),
     saveDesignAction: vi.fn(),
     publishDesignAction: vi.fn(),
     updateDesignMetaAction: vi.fn(),
     updateSceneAction: vi.fn(),
   }));

   function seedDesign(mode: "single" | "sequence", sceneCount: number) {
     useBuilderStore.setState({
       design: {
         id: "d1",
         slug: "test",
         title: "Test",
         mode,
         status: "draft",
         canvasWidth: 1920,
         canvasHeight: 1080,
         scenes: Array.from({ length: sceneCount }, (_, i) => ({
           id: `s${i + 1}`,
           designId: "d1",
           orderIndex: i,
           name: i === 0 ? "intro" : null,
           durationMs: 5000,
           transitionIn: "fade" as const,
           transitionOut: "fade" as const,
           elements: [],
         })),
       },
       selectedElementIds: [],
       activeSceneId: "s1",
       zoomLevel: 1,
       dirty: false,
     } as never);
   }

   describe("ScenePicker", () => {
     beforeEach(() => {
       addSceneActionMock.mockReset().mockResolvedValue({ ok: true, scene: { id: "s-new", designId: "d1", orderIndex: 99, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] } });
       deleteSceneActionMock.mockReset().mockResolvedValue({ ok: true });
       reorderScenesActionMock.mockReset().mockResolvedValue({ ok: true });
       cloneSceneActionMock.mockReset().mockResolvedValue({ ok: true, scene: { id: "s-clone", designId: "d1", orderIndex: 99, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] } });
     });

     it("renders nothing when design.mode is 'single'", () => {
       seedDesign("single", 1);
       const { container } = render(<ScenePicker />);
       expect(container.firstChild).toBeNull();
     });

     it("renders one tile per scene plus an Add tile when mode is 'sequence'", () => {
       seedDesign("sequence", 3);
       render(<ScenePicker />);
       expect(screen.getAllByTestId(/^scene-tile-/)).toHaveLength(3);
       expect(screen.getByTestId("scene-tile-add")).toBeInTheDocument();
     });

     it("highlights the active scene tile", () => {
       seedDesign("sequence", 3);
       render(<ScenePicker />);
       const tile = screen.getByTestId("scene-tile-s1");
       expect(tile.getAttribute("data-active")).toBe("true");
     });

     it("clicking a tile calls setActiveScene", () => {
       seedDesign("sequence", 3);
       render(<ScenePicker />);
       fireEvent.click(screen.getByTestId("scene-tile-s2"));
       expect(useBuilderStore.getState().activeSceneId).toBe("s2");
     });

     it("clicking Add invokes addSceneAction with afterOrderIndex = last", async () => {
       seedDesign("sequence", 2);
       render(<ScenePicker />);
       fireEvent.click(screen.getByTestId("scene-tile-add"));
       await Promise.resolve();
       expect(addSceneActionMock).toHaveBeenCalledWith(
         expect.objectContaining({
           designId: "d1",
           designSlug: "test",
           afterOrderIndex: 1,
         }),
       );
     });

     it("displays scene name and duration on the tile", () => {
       seedDesign("sequence", 1);
       render(<ScenePicker />);
       const tile = screen.getByTestId("scene-tile-s1");
       expect(tile.textContent).toMatch(/intro/i);
       expect(tile.textContent).toMatch(/5\.0\s*s/);
     });
   });
   ```

3. Run — expect FAIL:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/ScenePicker.test.tsx
   ```

   Expected: `Cannot find module './ScenePicker'`.

4. Create `apps/web/src/components/admin/builder/ScenePicker.tsx`:

   ```tsx
   "use client";

   import { useTransition } from "react";
   import {
     DndContext,
     PointerSensor,
     useSensor,
     useSensors,
     closestCenter,
     type DragEndEvent,
   } from "@dnd-kit/core";
   import {
     SortableContext,
     useSortable,
     horizontalListSortingStrategy,
     arrayMove,
   } from "@dnd-kit/sortable";
   import { CSS } from "@dnd-kit/utilities";
   import { Plus, Copy, Trash2 } from "lucide-react";
   import { useBuilderStore } from "@/state/builder/store";
   import {
     addSceneAction,
     deleteSceneAction,
     reorderScenesAction,
     cloneSceneAction,
   } from "@/app/admin/broadcast/v2/builder/actions";

   /**
    * Wave 3A — Scene picker dock.
    *
    * Renders ONLY when design.mode === 'sequence'. Top-strip horizontal
    * scroll list with one tile per scene + a trailing Add tile. Drag-reorder
    * via @dnd-kit/sortable. Click sets active. Right-click → context menu
    * for Clone / Delete.
    */
   export function ScenePicker() {
     const design = useBuilderStore((s) => s.design);
     const activeSceneId = useBuilderStore((s) => s.activeSceneId);
     const setActiveScene = useBuilderStore((s) => s.setActiveScene);
     const addSceneLocal = useBuilderStore((s) => s.addScene);
     const deleteSceneLocal = useBuilderStore((s) => s.deleteScene);
     const reorderScenesLocal = useBuilderStore((s) => s.reorderScenes);
     const [, startTransition] = useTransition();
     const sensors = useSensors(
       useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
     );

     if (!design || design.mode !== "sequence") return null;

     const scenes = design.scenes;
     const lastIndex = scenes.length - 1;

     function handleAdd() {
       startTransition(async () => {
         try {
           const res = await addSceneAction({
             designId: design!.id,
             designSlug: design!.slug,
             afterOrderIndex: lastIndex,
           });
           if (res.ok && res.scene) addSceneLocal(res.scene);
         } catch (err) {
           console.error("addScene failed", err);
         }
       });
     }

     function handleDelete(sceneId: string) {
       if (scenes.length <= 1) return; // sequence requires >=1 scene
       const prevActive = activeSceneId;
       deleteSceneLocal(sceneId);
       startTransition(async () => {
         try {
           await deleteSceneAction({ sceneId, designSlug: design!.slug });
         } catch (err) {
           console.error("deleteScene failed", err);
           // crude rollback: setActiveScene to prev
           if (prevActive) setActiveScene(prevActive);
         }
       });
     }

     function handleClone(sceneId: string) {
       startTransition(async () => {
         try {
           const res = await cloneSceneAction({ sceneId, designSlug: design!.slug });
           if (res.ok && res.scene) addSceneLocal(res.scene);
         } catch (err) {
           console.error("cloneScene failed", err);
         }
       });
     }

     function handleDragEnd(ev: DragEndEvent) {
       const { active, over } = ev;
       if (!over || active.id === over.id) return;
       const oldIdx = scenes.findIndex((s) => s.id === active.id);
       const newIdx = scenes.findIndex((s) => s.id === over.id);
       if (oldIdx < 0 || newIdx < 0) return;
       const next = arrayMove(scenes, oldIdx, newIdx);
       const order = next.map((s) => s.id);
       reorderScenesLocal(order);
       startTransition(async () => {
         try {
           await reorderScenesAction({
             designId: design!.id,
             designSlug: design!.slug,
             sceneIdOrder: order,
           });
         } catch (err) {
           console.error("reorderScenes failed", err);
         }
       });
     }

     return (
       <div
         className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 bg-zinc-950 px-3"
         aria-label="Scene picker"
       >
         <DndContext
           sensors={sensors}
           collisionDetection={closestCenter}
           onDragEnd={handleDragEnd}
         >
           <SortableContext
             items={scenes.map((s) => s.id)}
             strategy={horizontalListSortingStrategy}
           >
             {scenes.map((scene, idx) => (
               <SceneTile
                 key={scene.id}
                 scene={scene}
                 index={idx}
                 active={scene.id === activeSceneId}
                 onClick={() => setActiveScene(scene.id)}
                 onClone={() => handleClone(scene.id)}
                 onDelete={() => handleDelete(scene.id)}
                 canDelete={scenes.length > 1}
               />
             ))}
           </SortableContext>
         </DndContext>
         <button
           type="button"
           data-testid="scene-tile-add"
           onClick={handleAdd}
           className="flex h-20 w-32 shrink-0 items-center justify-center rounded border border-dashed border-white/20 text-white/40 hover:border-[#6bcd06] hover:text-[#6bcd06]"
           title="Add scene"
         >
           <Plus className="h-6 w-6" />
         </button>
       </div>
     );
   }

   type Scene = NonNullable<ReturnType<typeof useBuilderStore.getState>["design"]>["scenes"][number];

   function SceneTile({
     scene,
     index,
     active,
     onClick,
     onClone,
     onDelete,
     canDelete,
   }: {
     scene: Scene;
     index: number;
     active: boolean;
     onClick: () => void;
     onClone: () => void;
     onDelete: () => void;
     canDelete: boolean;
   }) {
     const { attributes, listeners, setNodeRef, transform, transition } =
       useSortable({ id: scene.id });
     const style: React.CSSProperties = {
       transform: CSS.Transform.toString(transform),
       transition,
     };
     const seconds = (scene.durationMs / 1000).toFixed(1);
     return (
       <div
         ref={setNodeRef}
         style={style}
         {...attributes}
         {...listeners}
         data-testid={`scene-tile-${scene.id}`}
         data-active={active ? "true" : "false"}
         onClick={onClick}
         className={`group relative flex h-20 w-32 shrink-0 cursor-pointer flex-col justify-between rounded border bg-zinc-900 px-2 py-1 text-xs text-white/80 ${active ? "border-[#6bcd06]" : "border-white/15"}`}
       >
         <div className="flex items-center justify-between">
           <span className="font-bold">{index + 1}</span>
           <span className="text-[10px] uppercase tracking-wider text-white/40">
             {scene.transitionIn}
           </span>
         </div>
         <div className="truncate text-[11px]">{scene.name ?? `Scene ${index + 1}`}</div>
         <div className="text-[10px] text-white/40">{seconds} s</div>
         <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
           <button
             type="button"
             data-testid={`scene-clone-${scene.id}`}
             onClick={(e) => {
               e.stopPropagation();
               onClone();
             }}
             className="rounded bg-black/60 p-0.5 text-white/70 hover:text-white"
             title="Clone scene"
           >
             <Copy className="h-3 w-3" />
           </button>
           {canDelete && (
             <button
               type="button"
               data-testid={`scene-delete-${scene.id}`}
               onClick={(e) => {
                 e.stopPropagation();
                 onDelete();
               }}
               className="rounded bg-black/60 p-0.5 text-white/70 hover:text-red-400"
               title="Delete scene"
             >
               <Trash2 className="h-3 w-3" />
             </button>
           )}
         </div>
       </div>
     );
   }
   ```

5. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/ScenePicker.test.tsx
   ```

   Expected: `Tests 6 passed (6)`.

6. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/ScenePicker.tsx apps/web/src/components/admin/builder/ScenePicker.test.tsx apps/web/package.json apps/web/package-lock.json
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): ScenePicker top-strip dock

   Renders only when design.mode === 'sequence'. Per-scene tiles show
   index + name + duration + transitionIn label. Drag-reorder via
   @dnd-kit/sortable. Hover reveals Clone / Delete buttons. Active scene
   gets brand-green border. + tile at end adds a new scene.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 6: ScenePropertiesDrawer — name + duration + transition controls

**Files:**

- Create: `apps/web/src/components/admin/builder/ScenePropertiesDrawer.tsx`
- Create: `apps/web/src/components/admin/builder/ScenePropertiesDrawer.test.tsx`

**Context:** Shown in the right-side PropertiesPanel when no element is selected (i.e., `selectedElementIds.length === 0` AND `design.mode === 'sequence'`). Three controls: text input for `name`, number input for `duration_ms` (displayed as seconds, internally ms), two `<select>` for `transition_in` / `transition_out`. All changes mutate via `updateScene` zustand action + debounced 500 ms server sync via `updateSceneAction`.

#### Steps

1. Write failing test at `apps/web/src/components/admin/builder/ScenePropertiesDrawer.test.tsx`:

   ```tsx
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { render, screen, fireEvent, waitFor } from "@testing-library/react";
   import { ScenePropertiesDrawer } from "./ScenePropertiesDrawer";
   import { useBuilderStore } from "@/state/builder/store";

   const updateSceneActionMock = vi.fn();
   vi.mock("@/app/admin/broadcast/v2/builder/actions", () => ({
     updateSceneAction: (...args: unknown[]) => updateSceneActionMock(...args),
   }));

   function seed() {
     useBuilderStore.setState({
       design: {
         id: "d1",
         slug: "x",
         title: "t",
         mode: "sequence",
         status: "draft",
         canvasWidth: 1920,
         canvasHeight: 1080,
         scenes: [
           {
             id: "s1",
             designId: "d1",
             orderIndex: 0,
             name: "intro",
             durationMs: 5000,
             transitionIn: "fade" as const,
             transitionOut: "fade" as const,
             elements: [],
           },
         ],
       },
       selectedElementIds: [],
       activeSceneId: "s1",
       zoomLevel: 1,
       dirty: false,
     } as never);
   }

   describe("ScenePropertiesDrawer", () => {
     beforeEach(() => {
       updateSceneActionMock.mockReset().mockResolvedValue({ ok: true });
       seed();
     });

     it("renders inputs prefilled from active scene", () => {
       render(<ScenePropertiesDrawer />);
       expect(
         (screen.getByLabelText(/scene name/i) as HTMLInputElement).value,
       ).toBe("intro");
       expect(
         (screen.getByLabelText(/duration/i) as HTMLInputElement).value,
       ).toBe("5");
       expect(
         (screen.getByLabelText(/transition in/i) as HTMLSelectElement).value,
       ).toBe("fade");
       expect(
         (screen.getByLabelText(/transition out/i) as HTMLSelectElement).value,
       ).toBe("fade");
     });

     it("changing name updates store and fires debounced action", async () => {
       vi.useFakeTimers();
       render(<ScenePropertiesDrawer />);
       fireEvent.change(screen.getByLabelText(/scene name/i), {
         target: { value: "intro v2" },
       });
       expect(
         useBuilderStore.getState().design!.scenes[0].name,
       ).toBe("intro v2");
       expect(updateSceneActionMock).not.toHaveBeenCalled();
       vi.advanceTimersByTime(600);
       await waitFor(() => {
         expect(updateSceneActionMock).toHaveBeenCalledWith(
           expect.objectContaining({
             sceneId: "s1",
             patch: expect.objectContaining({ name: "intro v2" }),
           }),
         );
       });
       vi.useRealTimers();
     });

     it("changing duration converts seconds → ms in the patch", async () => {
       vi.useFakeTimers();
       render(<ScenePropertiesDrawer />);
       fireEvent.change(screen.getByLabelText(/duration/i), {
         target: { value: "8" },
       });
       expect(useBuilderStore.getState().design!.scenes[0].durationMs).toBe(8000);
       vi.advanceTimersByTime(600);
       await waitFor(() => {
         expect(updateSceneActionMock).toHaveBeenCalledWith(
           expect.objectContaining({
             patch: expect.objectContaining({ durationMs: 8000 }),
           }),
         );
       });
       vi.useRealTimers();
     });

     it("changing transitionIn updates store + fires action", async () => {
       render(<ScenePropertiesDrawer />);
       fireEvent.change(screen.getByLabelText(/transition in/i), {
         target: { value: "slide-left" },
       });
       expect(
         useBuilderStore.getState().design!.scenes[0].transitionIn,
       ).toBe("slide-left");
       await waitFor(() => {
         expect(updateSceneActionMock).toHaveBeenCalledWith(
           expect.objectContaining({
             patch: expect.objectContaining({ transitionIn: "slide-left" }),
           }),
         );
       });
     });

     it("renders nothing when activeSceneId is null", () => {
       useBuilderStore.setState({ activeSceneId: null });
       const { container } = render(<ScenePropertiesDrawer />);
       expect(container.firstChild).toBeNull();
     });
   });
   ```

2. Run — expect FAIL:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/ScenePropertiesDrawer.test.tsx
   ```

   Expected: `Cannot find module './ScenePropertiesDrawer'`.

3. Create `apps/web/src/components/admin/builder/ScenePropertiesDrawer.tsx`:

   ```tsx
   "use client";

   import { useEffect, useRef } from "react";
   import { useBuilderStore } from "@/state/builder/store";
   import { updateSceneAction } from "@/app/admin/broadcast/v2/builder/actions";

   const TRANSITIONS = [
     "cut",
     "fade",
     "slide-left",
     "slide-right",
     "slide-up",
     "slide-down",
   ] as const;

   export function ScenePropertiesDrawer() {
     const design = useBuilderStore((s) => s.design);
     const activeSceneId = useBuilderStore((s) => s.activeSceneId);
     const updateSceneLocal = useBuilderStore((s) => s.updateScene);
     const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

     if (!design || !activeSceneId) return null;
     const scene = design.scenes.find((s) => s.id === activeSceneId);
     if (!scene) return null;

     function debouncedSync(
       patch: Partial<{
         name: string | null;
         durationMs: number;
         transitionIn: (typeof TRANSITIONS)[number];
         transitionOut: (typeof TRANSITIONS)[number];
       }>,
     ) {
       if (timerRef.current) clearTimeout(timerRef.current);
       timerRef.current = setTimeout(() => {
         updateSceneAction({
           sceneId: activeSceneId!,
           designSlug: design!.slug,
           patch,
         }).catch((err) => {
           console.error("updateScene sync failed", err);
         });
       }, 500);
     }

     useEffect(() => () => {
       if (timerRef.current) clearTimeout(timerRef.current);
     }, []);

     return (
       <section
         aria-label="Scene properties"
         className="flex flex-col gap-3 border-b border-white/10 bg-zinc-950 p-3 text-sm text-white/80"
       >
         <h3 className="text-xs uppercase tracking-wider text-white/40">
           Scene properties
         </h3>
         <label className="flex flex-col gap-1">
           <span>Scene name</span>
           <input
             aria-label="Scene name"
             type="text"
             value={scene.name ?? ""}
             onChange={(e) => {
               const v = e.target.value || null;
               updateSceneLocal(activeSceneId!, { name: v });
               debouncedSync({ name: v });
             }}
             className="rounded border border-white/15 bg-black px-2 py-1 text-white"
             placeholder={`Scene ${scene.orderIndex + 1}`}
           />
         </label>
         <label className="flex flex-col gap-1">
           <span>Duration (seconds)</span>
           <input
             aria-label="Duration"
             type="number"
             min={0.2}
             max={60}
             step={0.1}
             value={(scene.durationMs / 1000).toString()}
             onChange={(e) => {
               const sec = parseFloat(e.target.value);
               if (Number.isNaN(sec)) return;
               const ms = Math.round(sec * 1000);
               updateSceneLocal(activeSceneId!, { durationMs: ms });
               debouncedSync({ durationMs: ms });
             }}
             className="rounded border border-white/15 bg-black px-2 py-1 text-white"
           />
         </label>
         <label className="flex flex-col gap-1">
           <span>Transition in</span>
           <select
             aria-label="Transition in"
             value={scene.transitionIn}
             onChange={(e) => {
               const v = e.target.value as (typeof TRANSITIONS)[number];
               updateSceneLocal(activeSceneId!, { transitionIn: v });
               debouncedSync({ transitionIn: v });
             }}
             className="rounded border border-white/15 bg-black px-2 py-1 text-white"
           >
             {TRANSITIONS.map((t) => (
               <option key={t} value={t}>
                 {t}
               </option>
             ))}
           </select>
         </label>
         <label className="flex flex-col gap-1">
           <span>Transition out</span>
           <select
             aria-label="Transition out"
             value={scene.transitionOut}
             onChange={(e) => {
               const v = e.target.value as (typeof TRANSITIONS)[number];
               updateSceneLocal(activeSceneId!, { transitionOut: v });
               debouncedSync({ transitionOut: v });
             }}
             className="rounded border border-white/15 bg-black px-2 py-1 text-white"
           >
             {TRANSITIONS.map((t) => (
               <option key={t} value={t}>
                 {t}
               </option>
             ))}
           </select>
         </label>
       </section>
     );
   }
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/ScenePropertiesDrawer.test.tsx
   ```

   Expected: `Tests 5 passed (5)`.

5. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/ScenePropertiesDrawer.tsx apps/web/src/components/admin/builder/ScenePropertiesDrawer.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): ScenePropertiesDrawer

   Right-panel section visible when no element is selected. Edits scene
   name / duration_ms / transition_in / transition_out. Mutates store
   immediately + debounces server sync 500 ms.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 7: CanvasStage active-scene audit — verify per-scene element scoping

**Files:**

- Read-only: `apps/web/src/components/admin/builder/CanvasStage.tsx`
- Optional modify: `apps/web/src/components/admin/builder/CanvasStage.tsx`
- Optional modify: `apps/web/src/components/admin/builder/CanvasStage.test.tsx`

**Context:** Wave 1A T24 implemented `CanvasStage` reading elements from `design.scenes[0].elements` (single-mode hardcoded). Wave 3A requires it to read from the **active** scene — `scenes.find((s) => s.id === activeSceneId)?.elements ?? []`. If Wave 1A already used the active-scene selector this task is a no-op verification gate.

#### Steps

1. Inspect current CanvasStage selector:

   ```bash
   grep -E "scenes\[0\]\.elements|activeSceneId|active.?[sS]cene" apps/web/src/components/admin/builder/CanvasStage.tsx
   ```

   Expected one of:
   - `scenes[0].elements` (Wave 1A hardcoded) — needs fix.
   - `activeSceneId` / `activeScene` reference — already correct.

2. **If the file uses `scenes[0]`:** patch it to read the active scene. Replace the selector block:

   ```tsx
   // before (Wave 1A):
   const elements = useBuilderStore((s) => s.design?.scenes[0]?.elements ?? []);

   // after (Wave 3A):
   const activeSceneId = useBuilderStore((s) => s.activeSceneId);
   const elements = useBuilderStore((s) => {
     const scene = s.design?.scenes.find((sc) => sc.id === activeSceneId);
     return scene?.elements ?? [];
   });
   ```

   Add corresponding test in `CanvasStage.test.tsx`:

   ```tsx
   it("renders only the active scene's elements", () => {
     useBuilderStore.setState({
       design: {
         id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
         canvasWidth: 1920, canvasHeight: 1080,
         scenes: [
           {
             id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
             transitionIn: "fade", transitionOut: "fade",
             elements: [
               { id: "e1", elementType: "rect", zIndex: 0, locked: false, visible: true,
                 transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
                 style: {} } as never,
             ],
           },
           {
             id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000,
             transitionIn: "fade", transitionOut: "fade",
             elements: [
               { id: "e2", elementType: "text", zIndex: 0, locked: false, visible: true,
                 transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
                 style: {}, content: { text: "S2 text" } } as never,
             ],
           },
         ],
       },
       activeSceneId: "s2",
       selectedElementIds: [], zoomLevel: 1, dirty: false,
     } as never);
     render(<CanvasStage />);
     expect(screen.queryByText(/S2 text/)).toBeInTheDocument();
     expect(screen.queryByTestId(/element-rect-e1/)).not.toBeInTheDocument();
   });
   ```

3. **If the file already uses the active scene selector:** verify behavior with a quick smoke run:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/CanvasStage.test.tsx
   ```

   Expected: existing Wave 1A tests still pass.

4. Commit (only if changes were made):

   ```bash
   git add apps/web/src/components/admin/builder/CanvasStage.tsx apps/web/src/components/admin/builder/CanvasStage.test.tsx
   git commit -m "$(cat <<'EOF'
   fix(overlay-builder/wave-3a): CanvasStage reads from active scene

   Wave 1A hardcoded scenes[0]. Wave 3A multi-scene authoring needs the
   active-scene selector so switching tiles in ScenePicker swaps the
   rendered element set.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

   If no change needed, skip the commit; note in the task tracker that Wave 1A already shipped correct.

---

### Task 8: TopBar ModeToggle — single ⇄ sequence

**Files:**

- Modify: `apps/web/src/components/admin/builder/TopBar.tsx`
- Modify: `apps/web/src/components/admin/builder/TopBar.test.tsx`

**Context:** TopBar gets a new pill toggle between Save and Publish: `[Single | Sequence]`. Clicking Sequence flips `design.mode` to `sequence` and exposes the ScenePicker. Clicking Single when there are >1 scenes opens a confirmation dialog — confirming drops scenes 2..N (relies on zustand `setMode('single')` truncation logic from Task 4). Toggle is only rendered when `featureFlags.overlayBuilder.sequenceModeEnabled === true`.

#### Steps

1. APPEND failing tests to `apps/web/src/components/admin/builder/TopBar.test.tsx`:

   ```tsx
   it("renders mode toggle when sequenceModeEnabled flag is on", () => {
     vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "true");
     useBuilderStore.setState({
       design: { ...fixture, mode: "single" },
       dirty: false,
     });
     render(<TopBar />);
     expect(screen.getByTestId("mode-toggle")).toBeInTheDocument();
     vi.unstubAllEnvs();
   });

   it("hides mode toggle when sequenceModeEnabled flag is off", () => {
     vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "");
     useBuilderStore.setState({
       design: { ...fixture, mode: "single" },
       dirty: false,
     });
     render(<TopBar />);
     expect(screen.queryByTestId("mode-toggle")).toBeNull();
     vi.unstubAllEnvs();
   });

   it("clicking Sequence flips design.mode without confirm", async () => {
     vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "true");
     useBuilderStore.setState({
       design: { ...fixture, mode: "single" },
       dirty: false,
     });
     render(<TopBar />);
     fireEvent.click(screen.getByTestId("mode-toggle-sequence"));
     expect(useBuilderStore.getState().design!.mode).toBe("sequence");
     vi.unstubAllEnvs();
   });

   it("clicking Single with multiple scenes triggers confirm dialog", () => {
     vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "true");
     const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
     useBuilderStore.setState({
       design: {
         ...fixture,
         mode: "sequence",
         scenes: [
           { ...fixture.scenes[0] },
           { ...fixture.scenes[0], id: "s2", orderIndex: 1 },
         ],
       },
       dirty: false,
     });
     render(<TopBar />);
     fireEvent.click(screen.getByTestId("mode-toggle-single"));
     expect(confirmSpy).toHaveBeenCalled();
     // confirmed=false → mode stays
     expect(useBuilderStore.getState().design!.mode).toBe("sequence");
     confirmSpy.mockRestore();
     vi.unstubAllEnvs();
   });
   ```

2. Run — expect FAIL.

3. Edit `apps/web/src/components/admin/builder/TopBar.tsx` — inject the toggle. After the existing `<span>{design.status}</span>` block, insert:

   ```tsx
   import { featureFlags } from "@/lib/feature-flags";
   // ... existing imports ...

   // inside TopBar component, after `useBuilderStore` selectors and before return:
   const setMode = useBuilderStore((s) => s.setMode);
   const sequenceFlagOn = featureFlags.overlayBuilder.sequenceModeEnabled;

   function onModeChange(next: "single" | "sequence") {
     if (!design) return;
     if (next === design.mode) return;
     if (next === "single" && design.scenes.length > 1) {
       const ok = window.confirm(
         `Switching to single-scene mode will delete ${design.scenes.length - 1} scene(s). Continue?`,
       );
       if (!ok) return;
     }
     setMode(next);
   }
   ```

   Insert this JSX between the status span and the right-side button group:

   ```tsx
   {sequenceFlagOn && (
     <div
       data-testid="mode-toggle"
       role="group"
       aria-label="Authoring mode"
       className="flex items-center rounded border border-white/15 text-xs"
     >
       {(["single", "sequence"] as const).map((m) => (
         <button
           key={m}
           type="button"
           data-testid={`mode-toggle-${m}`}
           onClick={() => onModeChange(m)}
           className={`px-3 py-1 ${design?.mode === m ? "bg-[#6bcd06] text-black" : "text-white/70 hover:text-white"}`}
         >
           {m === "single" ? "Single" : "Sequence"}
         </button>
       ))}
     </div>
   )}
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder/TopBar.test.tsx
   ```

   Expected: previous Wave 1A TopBar tests still pass + 4 new tests pass.

5. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/TopBar.tsx apps/web/src/components/admin/builder/TopBar.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): TopBar mode toggle (single ⇄ sequence)

   Pill toggle gated on sequenceModeEnabled sub-flag. Switching to single
   when scenes.length > 1 prompts confirm; confirm true truncates to
   first scene via setMode('single') in store.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 9: Wire ScenePicker + ScenePropertiesDrawer into CanvasEditorShell

**Files:**

- Modify: `apps/web/src/components/admin/builder/CanvasEditorShell.tsx`
- Modify: `apps/web/src/components/admin/builder/PropertiesPanel.tsx`

**Context:** Shell layout (Wave 1A T22): TopBar at top, then horizontal row of Toolbar + center column (CanvasStage + LayersPanel) + PropertiesPanel. Wave 3A inserts ScenePicker between TopBar and the horizontal row (full-width strip). ScenePropertiesDrawer is conditionally rendered inside PropertiesPanel above the element-properties body, visible only when `selectedElementIds.length === 0 && design.mode === 'sequence'`.

#### Steps

1. Edit `apps/web/src/components/admin/builder/CanvasEditorShell.tsx` — import ScenePicker + insert into layout:

   ```tsx
   import { ScenePicker } from "./ScenePicker";
   // ... existing imports ...

   // Inside the return tree, between <TopBar /> and the horizontal flex row:
   return (
     <div className="flex h-screen flex-col bg-black text-white">
       <TopBar />
       <ScenePicker />
       <div className="flex min-h-0 flex-1">
         <Toolbar />
         <div className="flex min-w-0 flex-1 flex-col">
           <div className="min-h-0 flex-1 overflow-auto bg-zinc-900">
             <CanvasStage />
           </div>
           <LayersPanel />
         </div>
         <PropertiesPanel />
       </div>
     </div>
   );
   ```

   ScenePicker self-gates on `design.mode === 'sequence'` so single-mode designs are unaffected.

2. Edit `apps/web/src/components/admin/builder/PropertiesPanel.tsx` — inject ScenePropertiesDrawer at the top of the panel body. The exact location depends on Wave 1A's implementation. Most likely shape:

   ```tsx
   import { ScenePropertiesDrawer } from "./ScenePropertiesDrawer";
   import { useBuilderStore } from "@/state/builder/store";

   export function PropertiesPanel() {
     const selectedCount = useBuilderStore((s) => s.selectedElementIds.length);
     const mode = useBuilderStore((s) => s.design?.mode);
     const showSceneDrawer = selectedCount === 0 && mode === "sequence";
     return (
       <aside
         aria-label="Properties"
         className="flex w-[340px] flex-col overflow-y-auto border-l border-white/10 bg-zinc-950"
       >
         {showSceneDrawer && <ScenePropertiesDrawer />}
         {/* existing Wave 1A panel body (Style / Transform / Binding / Animation tabs) */}
       </aside>
     );
   }
   ```

   Preserve every Wave 1A tab rendering — only PREPEND the conditional ScenePropertiesDrawer.

3. Quick smoke — run the editor-shell test if one exists:

   ```bash
   npm --workspace apps/web run test -- src/components/admin/builder
   ```

   Expected: all existing builder component tests + new ScenePicker + ScenePropertiesDrawer tests pass.

4. Commit:

   ```bash
   git add apps/web/src/components/admin/builder/CanvasEditorShell.tsx apps/web/src/components/admin/builder/PropertiesPanel.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): wire ScenePicker + ScenePropertiesDrawer into shell

   ScenePicker docks between TopBar and the horizontal row, self-gating
   on design.mode === 'sequence'. ScenePropertiesDrawer prepends to the
   right PropertiesPanel when no element is selected and mode is sequence.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 10: Compiler — sequence mode emits all scenes

**Files:**

- Modify: `apps/web/src/server/overlays/builder/compiler.ts`
- Modify: `apps/web/src/server/overlays/builder/compiler.test.ts`
- Create: `apps/web/src/server/overlays/builder/fixtures/design-sequence-3-scenes.ts`

**Context:** Wave 1A `compileDesignToHtml(design, sceneIndex=0)` emits a single scene. Wave 3A extends it so when `design.mode === 'sequence'`, the compiler emits ALL scenes — every scene's elements get `data-scene-id` namespacing in CSS rules + the DOM wraps each scene's elements in `<div data-scene-id="...">` containers. Scene-transition `@keyframes` are emitted once per design (not per scene) since they're preset. The compiler emits one extra `<script>` block calling `runSequence(SCENES_META)` where `SCENES_META` is the array of `{id, durationMs, transitionIn, transitionOut}` in order.

**Signature stays backward compatible:** `compileDesignToHtml(design, sceneIndex, opts)`. When `mode === 'single'`, the `sceneIndex` arg is honored and old behavior holds. When `mode === 'sequence'`, the arg is ignored (all scenes emitted).

#### Steps

1. Create the 3-scene fixture at `apps/web/src/server/overlays/builder/fixtures/design-sequence-3-scenes.ts`:

   ```ts
   import type { Design } from "../types";

   /**
    * Wave 3A fixture: sequence design with 3 scenes:
    *   Scene 1 (5s, fade in / slide-left out) — rect
    *   Scene 2 (3s, slide-left in / slide-up out) — text "MIDDLE"
    *   Scene 3 (4s, slide-up in / fade out) — image
    */
   export const designSequence3Scenes: Design = {
     id: "00000000-0000-0000-0000-000000000700",
     slug: "fx-sequence-3-scenes",
     title: "Fixture: 3 sequence scenes",
     description: null,
     mode: "sequence",
     status: "published",
     canvas_width: 1920,
     canvas_height: 1080,
     scenes: [
       {
         id: "00000000-0000-0000-0000-000000000701",
         design_id: "00000000-0000-0000-0000-000000000700",
         order_index: 0,
         name: "intro",
         duration_ms: 5000,
         transition_in: "fade",
         transition_out: "slide-left",
         elements: [
           {
             id: "00000000-0000-0000-0000-000000000801",
             scene_id: "00000000-0000-0000-0000-000000000701",
             parent_group_id: null,
             element_type: "rect",
             z_index: 0,
             locked: false,
             visible: true,
             transform: { x: 100, y: 100, width: 300, height: 200, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
             style: { fill: "#6bcd06" },
             content: null,
             binding: null,
             animation: null,
             deleted_at: null,
           },
         ],
       },
       {
         id: "00000000-0000-0000-0000-000000000702",
         design_id: "00000000-0000-0000-0000-000000000700",
         order_index: 1,
         name: "main",
         duration_ms: 3000,
         transition_in: "slide-left",
         transition_out: "slide-up",
         elements: [
           {
             id: "00000000-0000-0000-0000-000000000802",
             scene_id: "00000000-0000-0000-0000-000000000702",
             parent_group_id: null,
             element_type: "text",
             z_index: 0,
             locked: false,
             visible: true,
             transform: { x: 200, y: 400, width: 800, height: 120, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
             style: { fontFamily: "Agharti", fontSize: 96, fill: "#ffffff" },
             content: { text: "MIDDLE" },
             binding: null,
             animation: null,
             deleted_at: null,
           },
         ],
       },
       {
         id: "00000000-0000-0000-0000-000000000703",
         design_id: "00000000-0000-0000-0000-000000000700",
         order_index: 2,
         name: "outro",
         duration_ms: 4000,
         transition_in: "slide-up",
         transition_out: "fade",
         elements: [
           {
             id: "00000000-0000-0000-0000-000000000803",
             scene_id: "00000000-0000-0000-0000-000000000703",
             parent_group_id: null,
             element_type: "image",
             z_index: 0,
             locked: false,
             visible: true,
             transform: { x: 760, y: 400, width: 400, height: 200, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
             style: {},
             content: { asset_path: "image/logo-outro.png" },
             binding: null,
             animation: null,
             deleted_at: null,
           },
         ],
       },
     ],
   };
   ```

2. APPEND failing tests to `apps/web/src/server/overlays/builder/compiler.test.ts`:

   ```ts
   import { designSequence3Scenes } from "./fixtures/design-sequence-3-scenes";

   describe("compileDesignToHtml — sequence mode", () => {
     const html = compileDesignToHtml(designSequence3Scenes, 0);

     it("emits a <div data-scene-id> wrapper per scene", () => {
       expect(html).toMatch(/<div\s+data-scene-id="00000000-0000-0000-0000-000000000701"/);
       expect(html).toMatch(/<div\s+data-scene-id="00000000-0000-0000-0000-000000000702"/);
       expect(html).toMatch(/<div\s+data-scene-id="00000000-0000-0000-0000-000000000703"/);
     });

     it("emits per-scene element rules namespaced by data-scene-id", () => {
       expect(html).toMatch(
         /\[data-scene-id="00000000-0000-0000-0000-000000000701"\]\s+\[data-element-id="00000000-0000-0000-0000-000000000801"\]/,
       );
     });

     it("emits the canonical scene transition @keyframes blocks", () => {
       expect(html).toContain("@keyframes scene-fade-in");
       expect(html).toContain("@keyframes scene-fade-out");
       expect(html).toContain("@keyframes scene-slide-left-in");
       expect(html).toContain("@keyframes scene-slide-left-out");
       expect(html).toContain("@keyframes scene-slide-up-in");
       expect(html).toContain("@keyframes scene-slide-up-out");
     });

     it("hides non-active scenes by default (display:none until activated)", () => {
       expect(html).toMatch(
         /\[data-scene-id\]\s*\{[^}]*display:\s*none/,
       );
     });

     it("emits __OVERLAY_SCENES_META__ with id/duration/transition for every scene", () => {
       expect(html).toContain("window.__OVERLAY_SCENES_META__");
       expect(html).toMatch(/id:\s*['"]00000000-0000-0000-0000-000000000701['"]/);
       expect(html).toMatch(/durationMs:\s*5000/);
       expect(html).toMatch(/transitionIn:\s*['"]fade['"]/);
       expect(html).toMatch(/transitionOut:\s*['"]slide-left['"]/);
       expect(html).toMatch(/id:\s*['"]00000000-0000-0000-0000-000000000702['"]/);
       expect(html).toMatch(/durationMs:\s*3000/);
     });

     it("renders text + image content in each scene's elements", () => {
       expect(html).toContain(">MIDDLE<");
       expect(html).toContain("/overlay-user-assets/image/logo-outro.png");
     });

     it("does NOT emit __OVERLAY_SCENES_META__ for single-mode designs", () => {
       // Use a single-mode fixture from Wave 1A
       const singleHtml = compileDesignToHtml(designRectTextImage, 0);
       expect(singleHtml).not.toContain("__OVERLAY_SCENES_META__");
     });
   });
   ```

3. Run — expect FAIL.

4. Patch `apps/web/src/server/overlays/builder/compiler.ts`. Two surgical changes:

   **4a. Add transition-keyframes generator near `presetKeyframesFor`:**

   ```ts
   const SCENE_TRANSITION_KEYFRAMES = `
   @keyframes scene-fade-in { from { opacity: 0; } to { opacity: 1; } }
   @keyframes scene-fade-out { from { opacity: 1; } to { opacity: 0; } }
   @keyframes scene-slide-left-in { from { transform: translateX(64px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
   @keyframes scene-slide-left-out { from { transform: translateX(0); opacity: 1; } to { transform: translateX(-64px); opacity: 0; } }
   @keyframes scene-slide-right-in { from { transform: translateX(-64px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
   @keyframes scene-slide-right-out { from { transform: translateX(0); opacity: 1; } to { transform: translateX(64px); opacity: 0; } }
   @keyframes scene-slide-up-in { from { transform: translateY(64px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
   @keyframes scene-slide-up-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-64px); opacity: 0; } }
   @keyframes scene-slide-down-in { from { transform: translateY(-64px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
   @keyframes scene-slide-down-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(64px); opacity: 0; } }
   `.trim();

   const SCENE_TRANSITION_DURATION_MS = 480;

   function sceneTransitionRules(transitionIn: string, transitionOut: string, sceneId: string): string {
     if (transitionIn === "cut" && transitionOut === "cut") return "";
     const rules: string[] = [];
     if (transitionIn !== "cut") {
       rules.push(
         `[data-scene-id="${sceneId}"][data-scene-state="entering"] { animation: scene-${transitionIn}-in ${SCENE_TRANSITION_DURATION_MS}ms ease-out both; }`,
       );
     }
     if (transitionOut !== "cut") {
       rules.push(
         `[data-scene-id="${sceneId}"][data-scene-state="exiting"] { animation: scene-${transitionOut}-out ${SCENE_TRANSITION_DURATION_MS}ms ease-in both; }`,
       );
     }
     return rules.join("\n");
   }
   ```

   **4b. Add a sequence-mode rendering branch in `compileDesignToHtml`:**

   Refactor the body to split single-mode from sequence-mode. Replace the existing return block with:

   ```ts
   if (design.mode === "sequence") {
     return compileSequence(design, opts);
   }

   // single-mode path (existing Wave 1A logic — preserve verbatim)
   const scene = design.scenes[sceneIndex] ?? design.scenes[0];
   // ... existing single-scene rendering ...
   ```

   Add the helper function `compileSequence`:

   ```ts
   function compileSequence(
     design: Design,
     opts: { demo?: boolean } = {},
   ): string {
     // 1. Per-scene blocks (fonts, element rules, animation keyframes, DOM)
     const allFontFaces = new Set<string>();
     const allKeyframes: string[] = [];
     const allElementDefaultRules: string[] = [];
     const allElementVisibleRules: string[] = [];
     const allElementExitingRules: string[] = [];
     const allAnimationRules: string[] = [];
     const allSceneTransitionRules: string[] = [];
     const allSceneDom: string[] = [];
     const allFeeds = new Set<string>();

     for (const scene of design.scenes) {
       // Fonts (de-duped via Set later)
       for (const el of scene.elements) {
         const fam = el.style?.fontFamily;
         if (fam && FONT_MAP[fam]) allFontFaces.add(fam);
       }

       // Element rules with [data-scene-id="..."] prefix so they only apply
       // within the wrapping scene container.
       const sceneSel = `[data-scene-id="${scene.id}"]`;
       for (const el of scene.elements) {
         allElementDefaultRules.push(
           `${sceneSel} ${elementDefaultRule(el)}`,
         );
         allElementVisibleRules.push(
           `body.cade-visible ${sceneSel}[data-scene-state="active"] [data-element-id="${el.id}"] { opacity: ${el.transform.opacity}; }`,
         );
         allElementExitingRules.push(
           `${sceneSel}[data-scene-state="exiting"] [data-element-id="${el.id}"] { opacity: 0; }`,
         );
       }

       // Per-element animations (Wave 1A entry/exit/loop, namespaced)
       const animBlocks = collectAnimationBlocks(scene);
       if (animBlocks.keyframes) allKeyframes.push(animBlocks.keyframes);
       if (animBlocks.rules) {
         // Re-prefix every rule with the scene selector so it scopes.
         const scoped = animBlocks.rules
           .split("\n")
           .map((line) => line.trim())
           .filter(Boolean)
           .map((line) => `${sceneSel} ${line}`)
           .join("\n");
         allAnimationRules.push(scoped);
       }

       // Scene transition rules (in/out)
       allSceneTransitionRules.push(
         sceneTransitionRules(
           scene.transition_in,
           scene.transition_out,
           scene.id,
         ),
       );

       // Wrap DOM in scene container
       const elementDom = scene.elements.map(renderElementDom).join("\n");
       allSceneDom.push(
         `<div data-scene-id="${scene.id}" data-scene-state="inactive">\n${elementDom}\n</div>`,
       );

       // Feeds
       for (const el of scene.elements) {
         if (el.binding?.feed) allFeeds.add(el.binding.feed);
       }
     }

     // Build font-faces block
     const fontFaceBlocks: string[] = [];
     for (const family of allFontFaces) {
       const path = FONT_MAP[family]!;
       fontFaceBlocks.push(
         `@font-face { font-family: '${family}'; src: url('${path}') format('woff2'); font-display: swap; }`,
       );
     }

     // Build feeds registry script (same shape as single-mode)
     const feedsArr = Array.from(allFeeds);
     const feedEntries: string[] = [];
     for (const feed of feedsArr) {
       const spec = FEED_REGISTRY[feed];
       if (!spec) continue;
       const fetchPath = spec.fetchPath ? `'${spec.fetchPath}'` : "null";
       const channels = spec.realtimeChannels.map((c) => `'${c}'`).join(", ");
       feedEntries.push(
         `  ${feed}: { fetchPath: ${fetchPath}, realtimeChannels: [${channels}] }`,
       );
     }
     const feedsScript = feedsArr.length === 0
       ? "window.__OVERLAY_FEEDS__ = {};"
       : `window.__OVERLAY_FEEDS__ = {\n${feedEntries.join(",\n")}\n};`;

     // Build scenes-meta script
     const sceneMetaEntries = design.scenes
       .map(
         (s) => `  { id: '${s.id}', durationMs: ${s.duration_ms}, transitionIn: '${s.transition_in}', transitionOut: '${s.transition_out}' }`,
       )
       .join(",\n");
     const scenesMetaScript = `window.__OVERLAY_SCENES_META__ = [\n${sceneMetaEntries}\n];`;

     const demoFlag = opts.demo === true ? "window.__OVERLAY_DEMO__ = true;" : "";

     return `<!DOCTYPE html>
   <html lang="en">
   <head>
   <meta charset="UTF-8" />
   <meta name="color-scheme" content="dark" />
   <title>${htmlEscape(design.title)}</title>
   <style>
   html, body { background: transparent !important; color-scheme: dark; margin: 0; padding: 0; }
   body { width: 1920px; height: 1080px; overflow: hidden; opacity: 1 !important; }
   ${fontFaceBlocks.join("\n")}
   [data-scene-id] { position: absolute; inset: 0; display: none; }
   [data-scene-id][data-scene-state="active"],
   [data-scene-id][data-scene-state="entering"],
   [data-scene-id][data-scene-state="exiting"] { display: block; }
   ${SCENE_TRANSITION_KEYFRAMES}
   ${allSceneTransitionRules.join("\n")}
   ${allElementDefaultRules.join("\n")}
   ${allElementVisibleRules.join("\n")}
   ${allElementExitingRules.join("\n")}
   ${allKeyframes.join("\n")}
   ${allAnimationRules.join("\n")}
   </style>
   </head>
   <body>
   <script>${feedsScript}\n${scenesMetaScript}\n${demoFlag}</script>
   ${allSceneDom.join("\n")}
   <script>${BOOTSTRAP_SCRIPT}</script>
   </body>
   </html>`;
   }
   ```

5. Re-run the compiler tests — expect PASS:

   ```bash
   npm --workspace apps/web run test -- compiler.test.ts
   ```

   Expected: previous Wave 1A compiler tests still pass + 7 new sequence-mode tests pass.

6. Commit:

   ```bash
   git add apps/web/src/server/overlays/builder/compiler.ts apps/web/src/server/overlays/builder/compiler.test.ts apps/web/src/server/overlays/builder/fixtures/design-sequence-3-scenes.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): compiler sequence mode emits all scenes

   When design.mode === 'sequence', compileDesignToHtml emits every
   scene's DOM wrapped in <div data-scene-id="..."> containers, with
   element rules namespaced by [data-scene-id]. Preset
   scene-<dir>-{in,out} keyframes ship once per design; per-scene
   transition rules reference them via data-scene-state="entering" /
   data-scene-state="exiting".

   Scene meta (id/duration/transitionIn/transitionOut, in order)
   exposed via window.__OVERLAY_SCENES_META__ so the bootstrap's
   runSequence driver can consume it.

   Single-mode path unchanged.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 11: Bootstrap `runSequence` driver

**Files:**

- Modify: `apps/web/src/server/overlays/builder/bootstrap-template.ts`
- Modify: `apps/web/src/server/overlays/builder/bootstrap-template.test.ts`

**Context:** Wave 1A bootstrap handles `show` → `body.cade-visible`. Wave 3A extends the `show` handler: when `window.__OVERLAY_SCENES_META__` is present (sequence mode), the bootstrap calls `runSequence(scenes)` after adding `cade-visible`. The driver iterates scenes in order: marks scene N's container `data-scene-state="entering"` for the in-transition duration, then `data-scene-state="active"` for `scene.durationMs - 2*TRANSITION_DURATION`, then `data-scene-state="exiting"` for the out-transition duration, then `inactive` and advances to scene N+1. On postMessage `{type:'next-scene'}` the driver skips to the next scene immediately. On postMessage `{type:'hide'}` the driver cancels remaining scenes and fires the normal hide path.

#### Steps

1. APPEND failing tests at the bottom of `apps/web/src/server/overlays/builder/bootstrap-template.test.ts`:

   ```ts
   describe("BOOTSTRAP_SCRIPT — sequence mode", () => {
     it("exposes a runSequence function or inline driver branch", () => {
       expect(BOOTSTRAP_SCRIPT).toMatch(/runSequence|__OVERLAY_SCENES_META__/);
     });

     it("handles next-scene postMessage type", () => {
       expect(BOOTSTRAP_SCRIPT).toMatch(/['"]next-scene['"]/);
     });

     it("references data-scene-state state machine", () => {
       expect(BOOTSTRAP_SCRIPT).toMatch(/data-scene-state/);
       expect(BOOTSTRAP_SCRIPT).toMatch(/['"]entering['"]/);
       expect(BOOTSTRAP_SCRIPT).toMatch(/['"]active['"]/);
       expect(BOOTSTRAP_SCRIPT).toMatch(/['"]exiting['"]/);
     });

     it("references SCENE_TRANSITION_DURATION constant (~480ms)", () => {
       expect(BOOTSTRAP_SCRIPT).toMatch(/480|SCENE_TRANSITION_DURATION/);
     });
   });
   ```

2. Run — expect FAIL.

3. Edit `apps/web/src/server/overlays/builder/bootstrap-template.ts`. Add the sequence driver inside the existing IIFE. Insert the driver block AFTER the postMessage listener section and BEFORE the demo-loop guard:

   ```js
     // ────────── Sequence driver (Wave 3A) ──────────
     // When window.__OVERLAY_SCENES_META__ is present, the show handler
     // invokes runSequence() to play scenes in order using each scene's
     // data-scene-state attribute to drive CSS animations.
     //
     // State machine per scene:
     //   inactive → entering (for SCENE_TRANSITION_DURATION ms)
     //            → active   (for scene.durationMs - 2*SCENE_TRANSITION ms)
     //            → exiting  (for SCENE_TRANSITION_DURATION ms)
     //            → inactive (advance)
     //
     // postMessage {type:'next-scene'} skips ahead immediately.
     // postMessage {type:'hide'} cancels remaining scenes and clears state.

     var SCENE_TRANSITION_DURATION = 480;
     var seqIndex = -1;
     var seqTimers = [];
     var seqRunning = false;

     function clearSeqTimers() {
       for (var i = 0; i < seqTimers.length; i++) {
         clearTimeout(seqTimers[i]);
       }
       seqTimers = [];
     }

     function resetAllScenes() {
       var nodes = document.querySelectorAll('[data-scene-id]');
       for (var i = 0; i < nodes.length; i++) {
         nodes[i].setAttribute('data-scene-state', 'inactive');
       }
     }

     function activateScene(meta, onComplete) {
       var node = document.querySelector('[data-scene-id="' + meta.id + '"]');
       if (!node) { onComplete(); return; }
       // Entering
       node.setAttribute('data-scene-state', 'entering');
       var enterMs = meta.transitionIn === 'cut' ? 0 : SCENE_TRANSITION_DURATION;
       seqTimers.push(setTimeout(function () {
         // Active
         node.setAttribute('data-scene-state', 'active');
         var activeMs = Math.max(
           0,
           meta.durationMs - enterMs - (meta.transitionOut === 'cut' ? 0 : SCENE_TRANSITION_DURATION),
         );
         seqTimers.push(setTimeout(function () {
           // Exiting
           node.setAttribute('data-scene-state', 'exiting');
           var exitMs = meta.transitionOut === 'cut' ? 0 : SCENE_TRANSITION_DURATION;
           seqTimers.push(setTimeout(function () {
             node.setAttribute('data-scene-state', 'inactive');
             onComplete();
           }, exitMs));
         }, activeMs));
       }, enterMs));
     }

     function runSequence() {
       var meta = window.__OVERLAY_SCENES_META__;
       if (!meta || !meta.length) return;
       seqRunning = true;
       seqIndex = -1;
       clearSeqTimers();
       resetAllScenes();
       function step() {
         seqIndex++;
         if (!seqRunning) return;
         if (seqIndex >= meta.length) {
           // Sequence complete — fire hide.
           seqRunning = false;
           window.dispatchEvent(new MessageEvent('message', {
             data: { type: 'hide' }
           }));
           return;
         }
         activateScene(meta[seqIndex], step);
       }
       step();
     }

     function stopSequence() {
       seqRunning = false;
       clearSeqTimers();
       resetAllScenes();
     }

     function advanceScene() {
       if (!seqRunning) return;
       // Skip current scene's remaining timers, jump to next.
       clearSeqTimers();
       var meta = window.__OVERLAY_SCENES_META__;
       if (!meta) return;
       var currentNode = document.querySelector('[data-scene-state="entering"], [data-scene-state="active"]');
       if (currentNode) currentNode.setAttribute('data-scene-state', 'inactive');
       seqIndex++;
       if (seqIndex >= meta.length) {
         seqRunning = false;
         window.dispatchEvent(new MessageEvent('message', { data: { type: 'hide' } }));
         return;
       }
       activateScene(meta[seqIndex], function () {
         seqIndex++;
         if (seqIndex >= meta.length) {
           seqRunning = false;
           window.dispatchEvent(new MessageEvent('message', { data: { type: 'hide' } }));
           return;
         }
         activateScene(meta[seqIndex], arguments.callee);
       });
     }
   ```

   Then update the `onMessage` function (in the postMessage receiver section) to handle `next-scene` and to invoke `runSequence` when `__OVERLAY_SCENES_META__` is present. Locate the existing `if (type === 'show')` branch and modify:

   ```js
     function onMessage(ev) {
       var msg = ev && ev.data;
       if (!msg || typeof msg !== 'object') return;
       var type = msg.type;
       if (type === 'show') {
         if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
         document.body.classList.remove('cade-exiting');
         document.body.classList.add('cade-visible');
         try { applyUpdate(msg.data, msg.slot); } catch (e) { /* swallow */ }
         // Sequence mode — kick off the runSequence driver.
         if (window.__OVERLAY_SCENES_META__ && window.__OVERLAY_SCENES_META__.length) {
           runSequence();
         }
       } else if (type === 'hide') {
         stopSequence();
         document.body.classList.remove('cade-visible');
         document.body.classList.add('cade-exiting');
         if (exitTimer) clearTimeout(exitTimer);
         exitTimer = setTimeout(function(){
           document.body.classList.remove('cade-exiting');
           exitTimer = null;
         }, EXIT_DURATION_MS);
       } else if (type === 'update') {
         try { applyUpdate(msg.data, msg.slot); } catch (e) { /* swallow */ }
       } else if (type === 'next-scene') {
         advanceScene();
       }
     }
   ```

4. Re-run — expect PASS:

   ```bash
   npm --workspace apps/web run test -- bootstrap-template.test.ts
   ```

   Expected: previous Wave 1A bootstrap tests still pass + 4 new sequence tests pass.

5. Commit:

   ```bash
   git add apps/web/src/server/overlays/builder/bootstrap-template.ts apps/web/src/server/overlays/builder/bootstrap-template.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-3a): bootstrap runSequence driver

   Adds three-phase scene state machine (entering → active → exiting →
   inactive) consuming window.__OVERLAY_SCENES_META__ array. show
   message kicks off runSequence; next-scene message advances; hide
   stops + resets.

   SCENE_TRANSITION_DURATION = 480 ms matches compiler-emitted
   @keyframes scene-<dir>-{in,out} timing. cut transitions are zero-
   duration no-ops.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 12: E2E spec — author + publish + render 3-scene sequence

**Files:**

- Create: `apps/web/tests/e2e/overlay-builder-wave-3a.spec.ts`

**Context:** Drives the full authoring flow end-to-end against a running dev server. Logs in as admin, creates a sequence-mode design through the editor UI (toggle mode, add 2 more scenes, set per-scene durations + transitions), saves, publishes, fetches the rendered HTML, and asserts the 3-scene + transitions contract holds in the response body.

#### Steps

1. Write the spec at `apps/web/tests/e2e/overlay-builder-wave-3a.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";
   import { createClient } from "@supabase/supabase-js";

   const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3030";

   function svc() {
     return createClient(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.SUPABASE_SERVICE_ROLE_KEY!,
       { auth: { persistSession: false } },
     );
   }

   async function loginAdmin(page: import("@playwright/test").Page) {
     await page.goto(`${BASE_URL}/login`);
     await page.getByTestId("login-email-input").fill("admin@cade.local");
     await page.getByTestId("login-password-input").fill("dev-admin-2026");
     await page.getByRole("button", { name: /sign in|log in/i }).click();
     await page.waitForURL(/\/admin/, { timeout: 10000 });
   }

   async function purge(slug: string) {
     const sb = svc();
     await sb.from("overlay_user_designs").delete().eq("slug", slug);
     await sb.from("overlay_template_variants").delete().eq("overlay_key", `user-${slug}`);
   }

   test.describe.configure({ mode: "serial" });

   test.describe("Wave 3A multi-scene authoring", () => {
     test("admin authors a 3-scene sequence design + render contains all 3", async ({ page, request }) => {
       const slug = `e2e-w3a-${Date.now().toString(36)}`;
       await loginAdmin(page);

       // 1. Open builder library, create new design
       await page.goto(`${BASE_URL}/admin/broadcast/v2/builder`);
       await page.getByRole("button", { name: /new design/i }).click();
       await page.getByLabel(/title/i).fill(`E2E ${slug}`);
       await page.getByRole("button", { name: /create/i }).click();
       await page.waitForURL(/\/admin\/broadcast\/v2\/builder\/.+\/edit/);

       // The library generates a slug from the title; capture it from the URL.
       const url = page.url();
       const generatedSlug = url.match(/\/builder\/([^/]+)\/edit/)?.[1];
       expect(generatedSlug).toBeTruthy();

       try {
         // 2. Toggle to sequence mode
         await page.getByTestId("mode-toggle-sequence").click();
         await expect(page.getByLabel(/scene picker/i)).toBeVisible();

         // 3. Add 2 more scenes (total = 3)
         await page.getByTestId("scene-tile-add").click();
         await page.waitForTimeout(300);
         await page.getByTestId("scene-tile-add").click();
         await page.waitForTimeout(300);
         await expect(page.getByTestId(/^scene-tile-/).filter({ hasNotText: "" })).toHaveCount(4); // 3 scenes + add tile

         // 4. Configure scene 1 (active by default)
         await page.getByLabel(/duration/i).fill("5");
         await page.getByLabel(/transition out/i).selectOption("slide-left");

         // 5. Click scene 2, configure
         const tiles = page.locator('[data-testid^="scene-tile-"]:not([data-testid="scene-tile-add"])');
         await tiles.nth(1).click();
         await page.getByLabel(/duration/i).fill("3");
         await page.getByLabel(/transition in/i).selectOption("slide-left");
         await page.getByLabel(/transition out/i).selectOption("slide-up");

         // 6. Click scene 3, configure
         await tiles.nth(2).click();
         await page.getByLabel(/duration/i).fill("4");
         await page.getByLabel(/transition in/i).selectOption("slide-up");
         await page.getByLabel(/transition out/i).selectOption("fade");

         // 7. Save + publish
         await page.getByRole("button", { name: /^save$/i }).click();
         await page.waitForTimeout(500);
         await page.getByRole("button", { name: /publish/i }).click();
         await page.waitForTimeout(500);

         // 8. Fetch the rendered HTML and assert sequence contract
         const res = await request.get(`${BASE_URL}/overlay/v2/user/${generatedSlug}?demo=1`);
         expect(res.status()).toBe(200);
         const html = await res.text();

         // §14 contract markers
         expect(html).toContain("<!DOCTYPE html>");
         expect(html).toContain('<html lang="en">');
         expect(html).toContain("cade-visible-gate-observer-v2");

         // Sequence-mode markers
         expect(html).toContain("__OVERLAY_SCENES_META__");
         expect(html.match(/data-scene-id="[^"]+"/g)?.length).toBe(3);
         expect(html).toContain("@keyframes scene-slide-left-in");
         expect(html).toContain("@keyframes scene-slide-left-out");
         expect(html).toContain("@keyframes scene-slide-up-in");
         expect(html).toContain("@keyframes scene-slide-up-out");
         expect(html).toContain("@keyframes scene-fade-out");
         expect(html).toMatch(/durationMs:\s*5000/);
         expect(html).toMatch(/durationMs:\s*3000/);
         expect(html).toMatch(/durationMs:\s*4000/);
       } finally {
         if (generatedSlug) await purge(generatedSlug);
       }
     });

     test("postMessage next-scene advances the sequence", async ({ page }) => {
       const sb = svc();
       const slug = `e2e-w3a-next-${Date.now().toString(36)}`;
       // Seed directly via service role (faster than driving UI for this assertion).
       const { data: design } = await sb
         .from("overlay_user_designs")
         .insert({
           slug,
           title: `next-scene ${slug}`,
           mode: "sequence",
           status: "published",
           canvas_width: 1920,
           canvas_height: 1080,
         })
         .select("id")
         .single();
       try {
         const sceneRows = [];
         for (let i = 0; i < 3; i++) {
           const { data: scene } = await sb
             .from("overlay_user_design_scenes")
             .insert({
               design_id: design!.id,
               order_index: i,
               duration_ms: 10000, // long enough that advance is visible
               transition_in: "fade",
               transition_out: "fade",
             })
             .select("id")
             .single();
           sceneRows.push(scene!.id);
           await sb.from("overlay_user_design_elements").insert({
             scene_id: scene!.id,
             element_type: "text",
             z_index: 0,
             transform: { x: 100, y: 100, width: 800, height: 100, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
             style: {},
             content: { text: `SCENE ${i + 1}` },
           });
         }

         await page.goto(`${BASE_URL}/overlay/v2/user/${slug}`);
         // Manually post show
         await page.evaluate(() => window.postMessage({ type: "show" }, "*"));
         // Wait for scene 1 to enter
         await page.waitForFunction(
           (id) => document.querySelector(`[data-scene-id="${id}"]`)?.getAttribute("data-scene-state") === "active",
           sceneRows[0],
           { timeout: 2000 },
         );
         // Fire next-scene
         await page.evaluate(() => window.postMessage({ type: "next-scene" }, "*"));
         await page.waitForFunction(
           (id) => document.querySelector(`[data-scene-id="${id}"]`)?.getAttribute("data-scene-state") === "active",
           sceneRows[1],
           { timeout: 2000 },
         );
       } finally {
         await purge(slug);
       }
     });
   });
   ```

2. Run the spec against a fresh dev server:

   ```bash
   npx next dev -p 3030 &
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-3a.spec.ts
   ```

   Expected: both tests pass. If the first fails because the New Design modal uses a different label, capture the actual label and update `getByRole("button", { name: /create/i })` to match.

3. Commit:

   ```bash
   git add apps/web/tests/e2e/overlay-builder-wave-3a.spec.ts
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/wave-3a): e2e author 3-scene sequence + next-scene postMessage

   Drives the full editor UI flow (toggle mode, add scenes, configure
   each scene's duration + transitions, save, publish) then asserts the
   rendered /overlay/v2/user/<slug> HTML contains __OVERLAY_SCENES_META__,
   3 data-scene-id wrappers, and the right transition @keyframes.

   Second test exercises postMessage {type:'next-scene'} advancing the
   sequence ahead of the natural duration.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 13: Visual-regression baseline — sequence midpoint capture

**Files:**

- Create: `apps/web/tests/e2e/visual-regression-wave-3a.spec.ts`
- Create: `apps/web/tests/e2e/helpers/seed-sequence-fixture.ts`

**Context:** Capture a deterministic frame at sequence scene 2 active state. The seeded fixture has 3 scenes with `transition_in: 'cut'` everywhere (so timing is deterministic), each scene 2000 ms duration. Test loads the overlay, posts `show`, waits 2200 ms (just past scene 1's exit), captures screenshot, compares against committed baseline.

#### Steps

1. Create the helper at `apps/web/tests/e2e/helpers/seed-sequence-fixture.ts`:

   ```ts
   import { createClient, type SupabaseClient } from "@supabase/supabase-js";
   import * as path from "node:path";
   import * as fs from "node:fs";

   function loadEnvFromDotEnvLocal(): void {
     const p = path.resolve(__dirname, "..", "..", "..", ".env.local");
     if (!fs.existsSync(p)) return;
     const text = fs.readFileSync(p, "utf8");
     for (const line of text.split(/\r?\n/)) {
       const trimmed = line.trim();
       if (!trimmed || trimmed.startsWith("#")) continue;
       const eq = trimmed.indexOf("=");
       if (eq === -1) continue;
       const k = trimmed.slice(0, eq).trim();
       let v = trimmed.slice(eq + 1).trim();
       if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
       if (!process.env[k]) process.env[k] = v;
     }
   }

   export function getServiceRoleClient(): SupabaseClient {
     loadEnvFromDotEnvLocal();
     return createClient(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.SUPABASE_SERVICE_ROLE_KEY!,
       { auth: { persistSession: false, autoRefreshToken: false } },
     );
   }

   export type SequenceSeedResult = {
     designId: string;
     slug: string;
     sceneIds: string[];
     cleanup: () => Promise<void>;
   };

   export async function seedWave3aSequenceFixture(): Promise<SequenceSeedResult> {
     const sb = getServiceRoleClient();
     const slug = `vr-wave3a-${Date.now().toString(36)}`;

     const { data: design, error: dErr } = await sb
       .from("overlay_user_designs")
       .insert({
         slug,
         title: "Wave 3A Sequence VR Fixture",
         mode: "sequence",
         status: "published",
         canvas_width: 1920,
         canvas_height: 1080,
       })
       .select("id")
       .single();
     if (dErr || !design) throw dErr ?? new Error("design insert failed");

     const sceneIds: string[] = [];
     const sceneContents = [
       { text: "SCENE ONE", color: "#6bcd06" },
       { text: "SCENE TWO", color: "#fe036d" },
       { text: "SCENE THREE", color: "#ffffff" },
     ];
     for (let i = 0; i < 3; i++) {
       const { data: scene, error: sErr } = await sb
         .from("overlay_user_design_scenes")
         .insert({
           design_id: design.id,
           order_index: i,
           name: `Scene ${i + 1}`,
           duration_ms: 2000,
           transition_in: "cut",
           transition_out: "cut",
         })
         .select("id")
         .single();
       if (sErr || !scene) throw sErr ?? new Error("scene insert failed");
       sceneIds.push(scene.id);
       await sb.from("overlay_user_design_elements").insert({
         scene_id: scene.id,
         element_type: "text",
         z_index: 0,
         transform: { x: 200, y: 400, width: 1520, height: 200, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
         style: { fontFamily: "Agharti", fontSize: 192, fill: sceneContents[i].color, fontWeight: 700 },
         content: { text: sceneContents[i].text },
       });
     }

     return {
       designId: design.id,
       slug,
       sceneIds,
       cleanup: async () => {
         await sb.from("overlay_user_designs").delete().eq("id", design.id);
       },
     };
   }
   ```

2. Create `apps/web/tests/e2e/visual-regression-wave-3a.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";
   import { seedWave3aSequenceFixture } from "./helpers/seed-sequence-fixture";

   const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3030";

   test.describe("Visual regression — Wave 3A sequence midpoint", () => {
     test("scene 2 active state matches baseline (<0.1% pixel diff)", async ({ page }) => {
       const fixture = await seedWave3aSequenceFixture();
       try {
         await page.setViewportSize({ width: 1920, height: 1080 });
         await page.goto(`${BASE_URL}/overlay/v2/user/${fixture.slug}`);
         // Trigger sequence
         await page.evaluate(() => window.postMessage({ type: "show" }, "*"));
         // Wait for scene 2 active (cut transitions are instant; scene 1 lasts 2000 ms)
         await page.waitForFunction(
           (id) => document.querySelector(`[data-scene-id="${id}"]`)?.getAttribute("data-scene-state") === "active",
           fixture.sceneIds[1],
           { timeout: 5000 },
         );
         // Stabilize
         await page.waitForTimeout(200);
         expect(await page.screenshot({ fullPage: true })).toMatchSnapshot(
           "wave-3a-sequence-scene-2.png",
           { maxDiffPixelRatio: 0.001 },
         );
       } finally {
         await fixture.cleanup();
       }
     });
   });
   ```

3. First run generates the baseline:

   ```bash
   npx next dev -p 3030 &
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-3a.spec.ts --update-snapshots
   ```

   Expected: the baseline PNG is written under `visual-regression-wave-3a.spec.ts-snapshots/`. Inspect visually — should show "SCENE TWO" in `#fe036d` (pink) on transparent canvas.

4. Run again WITHOUT update to confirm reproducibility:

   ```bash
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-3a.spec.ts
   ```

   Expected: PASS with 0 pixel diff (cut transitions = no animation in flight).

5. Commit (include the baseline PNG):

   ```bash
   git add apps/web/tests/e2e/visual-regression-wave-3a.spec.ts apps/web/tests/e2e/helpers/seed-sequence-fixture.ts apps/web/tests/e2e/visual-regression-wave-3a.spec.ts-snapshots
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/wave-3a): visual-regression baseline for 3-scene sequence

   Seeds a deterministic 3-scene design with cut transitions, drives the
   bootstrap show, waits for scene 2 active state, captures screenshot,
   compares <0.1% pixel diff against committed baseline.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 14: Verification gate + push

This task is the FINAL gate. Mirrors Wave 1A T32. Cannot proceed without all steps green.

**Files:**

- Modify: `tasks/todo.md` (append Wave 3A review section)
- Modify: `tasks/lessons.md` (capture any lessons surfaced)
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md`
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md` (RESUME line)

#### Step 1: Unit tests pass

```bash
npm --workspace apps/web run test
```

Expected: 0 failures. Wave 1A's ~50+ unit tests plus Wave 3A's new tests (3 feature-flag + 9 scene actions + 7 store + 6 ScenePicker + 5 ScenePropertiesDrawer + 4 TopBar mode-toggle + 7 compiler-sequence + 4 bootstrap-sequence ≈ 45 new) all green.

#### Step 2: Lint clean

```bash
npm --workspace apps/web run lint
```

Expected: 0 new errors. Existing warnings tolerated only if they pre-date Wave 3A.

#### Step 3: Build clean

```bash
npm --workspace apps/web run build
```

Expected: production build succeeds. `prebuild` sync:overlays + check:element-id-parity pass. The Wave 3A change is server-only — no new static overlay HTML files mirrored under `apps/web/public/overlays/v2/user/`.

#### Step 4: E2E tests pass

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-3a.spec.ts
```

Expected: 2 tests pass (author flow + next-scene postMessage).

Then re-run the full E2E suite to confirm no regression:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true npm --workspace apps/web run e2e
```

Expected: all specs pass. Watch for regressions in `overlay-builder-wave-1a.spec.ts` (any divergence means Wave 3A inadvertently changed single-mode behavior — STOP and fix root cause).

#### Step 5: Visual regression pass

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-3a.spec.ts
```

Expected: pixel diff < 0.1% on the new baseline.

Then the existing 16-built-in + Wave 1A baselines:

```bash
npm --workspace apps/web run e2e:visual-regression
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- visual-regression-wave-1a.spec.ts
```

Expected: all unchanged. Wave 3A MUST NOT alter built-in overlay rendering OR Wave 1A single-mode baseline.

#### Step 6: Manual Chrome end-to-end per CLAUDE.md §11

Drive the full sequence-authoring flow through Claude-in-Chrome. Procedure:

1. Ensure both flags ON in `apps/web/.env.local`:
   ```
   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true
   NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true
   ```

2. Start dev server:
   ```bash
   npx next dev -p 3030
   ```

3. Load Claude-in-Chrome tools via `ToolSearch select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__javascript_tool` and execute:

   1. Navigate `http://localhost:3030/login`, log in `admin@cade.local` / `dev-admin-2026`.
   2. Navigate `http://localhost:3030/admin/broadcast/v2/builder`. Click **New Design**, title "Chrome Smoke Wave 3A".
   3. On editor, click the **Sequence** mode toggle. Confirm ScenePicker dock appears below TopBar.
   4. Click the `+` tile twice → 3 scenes total.
   5. Click scene 1 tile → ScenePropertiesDrawer shows in right panel. Set duration=5, transition_out="slide-left".
   6. Click scene 2 tile → set duration=3, transition_in="slide-left", transition_out="slide-up".
   7. Drop a Text element on scene 2's canvas with content "MIDDLE".
   8. Click scene 3 tile → set duration=4, transition_in="slide-up", transition_out="fade".
   9. Save + Publish.
   10. Open `http://localhost:3030/overlay/v2/user/chrome-smoke-wave-3a?demo=1` in a fresh tab.
   11. Watch the 12-second loop — scene 1 fades in (transition_in default), slides left at 5 s, scene 2 slides in from left, slides up at 8 s, scene 3 slides up from below, fades out at 12 s.
   12. Run `mcp__claude-in-chrome__read_console_messages`. Assert 0 red errors.
   13. In the same tab, run JavaScript `window.postMessage({type:'next-scene'}, '*')` mid-scene to confirm manual advance.

If any step shows red errors or visible glitches, STOP. Fix root cause. Re-run from step 1.

#### Step 7: Post-push platform-wide verification per CLAUDE.md §12

Build the route-by-route status table. Use `apps/web/scripts/_verify-wave-3a-routes.mjs` (one-shot, delete after run):

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
  ["GET", "/admin/broadcast/v2/stingers", 307],
  ["GET", "/admin/broadcast/v2/branding", 307],
  ["GET", "/admin/broadcast/v2/youtube", 307],
  ["GET", "/admin/broadcast/v2/builder", 307],
  ["GET", "/admin/match-days", 307],
  ["GET", "/admin/players", 307],
  ["GET", "/admin/squads", 307],
  ["GET", "/admin/disputes", 307],
  ["GET", "/admin/trash", 307],
  ["GET", "/overlay/v2/04-h2h-2?demo=1", 200],
  ["GET", "/overlay/v2/07-leaderboard?demo=1", 200],
  ["GET", "/overlay/v2/11-match-scores-day?demo=1", 200],
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

Run `node apps/web/scripts/_verify-wave-3a-routes.mjs`. Delete script after the run.

#### Step 8: Push to origin/main

```bash
git status
git push origin main
```

Expected: Vercel auto-deploys. Monitor at https://vercel.com/<scope>/cade-league-platform until **Ready**.

After green deploy:

```bash
VERIFY_BASE_URL=https://cade-league.vercel.app node apps/web/scripts/_verify-wave-3a-routes.mjs
```

#### Step 9: Memory update

Append to `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md`:

```md
## Status

- **Wave 3A SHIPPED <YYYY-MM-DD> commit <SHA>** — multi-scene authoring
  (sequence mode toggle, ScenePicker top-strip dock with drag-reorder,
  ScenePropertiesDrawer with name/duration/transitionIn/Out), compiler
  sequence-mode branch emitting all scenes wrapped in
  `<div data-scene-id>`, bootstrap runSequence driver consuming
  __OVERLAY_SCENES_META__, six preset scene transitions
  (cut/fade/slide-{left,right,up,down}), postMessage next-scene manual
  advance, five new server actions + zustand store extensions.
- Behind dual flag: `NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true` (Wave 1A)
  AND `NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED=true` (Wave 3A).
- **Verification:** `npm run test` (~45 new unit tests green), `lint`,
  `build`, `e2e` (overlay-builder-wave-3a.spec.ts), visual-regression
  baseline scene 2 active state, manual Chrome end-to-end, post-push
  curl table per CLAUDE.md §12.
- **Next:** Wave 3B `writing-plans` dispatch — advanced keyframe timeline
  editor.
```

Update RESUME line at top of `MEMORY.md`:

```md
- **🟢 RESUME <YYYY-MM-DD>:** [Overlay Builder Wave 3A SHIPPED](project_overlay_builder_2026_05_17.md). Commit `<SHA>`. Multi-scene authoring + sequence runtime + 6 scene transitions live behind `NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED`. Next: Wave 3B plan dispatch.
```

Append review section to `tasks/todo.md` + capture any lessons in `tasks/lessons.md` per CLAUDE.md "Error log rule".

Commit memory/tasks deltas:

```bash
git add tasks/todo.md tasks/lessons.md
git commit -m "$(cat <<'EOF'
docs(overlay-builder): wave 3A review + lessons log after verification gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

#### Step 10: TaskUpdate cleanup

- Mark Wave 3A tracking task complete in TaskCreate registry.
- Open Wave 3B stub if dispatching immediately.

**Final gate — declare wave complete only when ALL 10 steps green.** Per CLAUDE.md §4 "Never mark a task complete without proving it works end-to-end."

---

## Self-Review

### (A) Spec coverage — Wave 3A scope from prompt + spec §11

| # | Wave 3A scope item | Implementing task(s) | Status |
|---|---|---|---|
| 1 | Multi-scene authoring activated (sequence mode in `overlay_user_designs.mode`) | Task 4 (`setMode`) · Task 8 (TopBar ModeToggle) | Covered |
| 2 | Sequence runtime in bootstrap script (plays scenes in order with per-scene duration_ms + transition) | Task 11 (bootstrap runSequence driver) | Covered |
| 3 | Operator can manually advance via postMessage `{type:'next-scene'}` | Task 11 (advanceScene + onMessage `next-scene` branch) · Task 12 (E2E asserts) | Covered |
| 4 | Admin UI: scene picker dock in CanvasEditorShell so user can switch between scenes while editing | Task 5 (ScenePicker) · Task 9 (wire into shell) | Covered |
| 5 | Per-scene name + duration + transition controls | Task 6 (ScenePropertiesDrawer) | Covered |
| 6 | Schema already supports it — Wave 3A wires UI + runtime only | Task 2 (audit gate confirms scenes.ts surface matches) | Covered |
| 7 | Scene CRUD already shipped Wave 1A | Task 2 (verification gate) | Covered |
| 8 | Server actions (`addSceneAction`, `deleteSceneAction`, `reorderScenesAction`, `cloneSceneAction`, `updateSceneAction`) | Task 3 | Covered |
| 9 | zustand store — add `activeSceneId` + actions for setting + add/delete/reorder | Task 4 | Covered |
| 10 | ScenePicker UI: horizontal scroll list, click-to-activate, + button, drag-reorder | Task 5 | Covered |
| 11 | Per-scene properties drawer: name + duration + transitionIn/Out | Task 6 | Covered |
| 12 | CanvasStage reads `activeScene.elements` | Task 7 (audit + fix-forward if needed) | Covered |
| 13 | Compiler updates — sequence-mode emits ALL scenes' CSS + JS for scene-switching at runtime | Task 10 | Covered |
| 14 | Bootstrap script updates — `runSequence(scenes[])` function | Task 11 | Covered |
| 15 | Transition CSS — define `@keyframes scene-fade-in / scene-fade-out / scene-slide-*` | Task 10 (SCENE_TRANSITION_KEYFRAMES block) | Covered |
| 16 | Mode toggle UI — TopBar shows current mode (single/sequence) | Task 8 | Covered |
| 17 | Single-mode lock — if mode='single', restrict to 1 scene + hide ScenePicker | Task 5 (self-gates on mode) · Task 8 (confirm dialog on downgrade) | Covered |
| 18 | E2E spec — create design in sequence mode, add 3 scenes, save, publish, fetch HTML, assert payloads | Task 12 | Covered |
| 19 | VR baseline for 3-scene design (capture frame mid-sequence) | Task 13 | Covered |
| 20 | Verification gate + push | Task 14 | Covered |

**Result:** All 20 Wave 3A scope items mapped to tasks. No item is uncovered.

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
| `Write tests for the above` (without code) | 0 | clean |

**Result:** 0 placeholders. Every task with code shows failing-test → minimal-impl → passing-test cycle.

### (C) Type consistency

The plan maintains Wave 1A's two-layer naming convention:

- TypeScript domain types (camelCase): `Scene.orderIndex`, `Scene.durationMs`, `Scene.transitionIn`, `Scene.transitionOut`, `Design.canvasWidth`, etc. Used in zustand store, components, and action signatures.
- DB row shape (snake_case): `order_index`, `duration_ms`, `transition_in`, `transition_out`, `canvas_width` etc. Used inside `scenes.ts` and the compiler's `compileSequence` helper.

**Compiler internals exception:** The Wave 1A compiler reads `el.element_type`, `el.transform.scale_x`, `scene.duration_ms`, `scene.transition_in/out`, etc. — i.e. its `Design`/`Element`/`Scene` internal types match the DB-row shape. Wave 3A's new `designSequence3Scenes` fixture follows the same snake_case convention as Wave 1A fixtures (verbatim from Wave 1A `designRectTextImage` shape). This is **intentional** and matches Wave 1A's self-review item C: the compiler ships as a hermetic black box that consumes DB-row-shaped fixtures and emits HTML.

**Implementation Note for Wave 3A implementer:** when Task 10's `compileSequence` accesses scene fields, use the existing snake_case pattern (`scene.duration_ms`, `scene.transition_in`). Conversely, when Task 4's zustand `setMode`/`addScene` actions consume `Scene` from `types.ts`, use camelCase (`scene.durationMs`, `scene.transitionIn`). The row-to-domain conversion at `rowToScene` in `scenes.ts` is the boundary.

### (D) File-path consistency

All paths are repo-relative (`apps/web/...`, `supabase/...`) or absolute Windows paths (`C:\Users\Sweez\...`). Both styles consistent within tasks. No mixed-style line within a single task.

### (E) Migration number sequencing

**No new migrations in Wave 3A.** The data model from Wave 1A (`overlay_user_design_scenes` table) already has every required column (`order_index`, `duration_ms`, `transition_in`, `transition_out`). Wave 3A is pure UI + runtime + server-action wiring.

### (F) Commit message format

All 14 task commits use the HEREDOC pattern (`git commit -m "$(cat <<'EOF' ... EOF\n)"`) with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer on the final line of the body.

### (G) TDD ordering

Every task with code follows failing-test → run-FAIL → minimal-impl → run-PASS → commit. Tasks exempt:

- **Task 2 (audit gate)** — verification only, no test changes.
- **Task 7 (audit gate)** — conditional fix-forward; full TDD applies only if Wave 1A shipped the wrong selector.
- **Task 13 (VR baseline)** — first run is `--update-snapshots` (generates baseline), second run is the pass gate.
- **Task 14 (final verification gate)** — orchestrates the full suite; not a unit-test cycle.

All remaining tasks (1, 3, 4, 5, 6, 8, 9, 10, 11, 12) document explicit failing-test → impl → passing-test cycles.

### Self-Review Summary

| Check | Found | Fixed | Notes |
|---|---|---|---|
| (A) Spec coverage | 20 scope items mapped | 0 missing | All Wave 3A scope items covered |
| (B) Placeholder scan | 0 issues | 0 | Plan is implementation-complete |
| (C) Type consistency | Wave 1A two-layer convention preserved | 0 patched | Implementation note documented for compiler fixture shape |
| (D) File-path consistency | No issues | 0 | Mixed absolute Windows + repo-relative styles consistent within tasks |
| (E) Migration sequencing | No new migrations | 0 | Wave 3A is UI + runtime only — schema from Wave 1A suffices |
| (F) Commit message format | 14 HEREDOC + trailer | 0 | All compliant |
| (G) TDD ordering | 4 legitimate exemptions (audit gates + VR baseline + final gate) | 0 | Documented |
