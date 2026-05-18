"use server";

import { revalidatePath } from "next/cache";
import {
  createDesign,
  updateDesign,
  publishDesign,
  unpublishDesign,
  softDeleteDesign,
} from "@/server/overlays/builder/designs";
import type { Style } from "@/server/overlays/builder/types";
import { snapshotDesign } from "@/server/overlays/builder/history";
import {
  updateScenes,
  addScene as addSceneCrud,
  updateScene as updateSceneCrud,
  reorderScenes as reorderScenesCrud,
  deleteScene as deleteSceneCrud,
  cloneScene as cloneSceneCrud,
} from "@/server/overlays/builder/scenes";
import {
  updateElements,
  addElement as addElementCrud,
  deleteElement as deleteElementCrud,
} from "@/server/overlays/builder/elements";
import {
  CreateDesignSchema,
  SaveDesignSchema,
  AddSceneInputSchema,
  UpdateSceneInputSchema,
  ReorderScenesInputSchema,
  DeleteSceneInputSchema,
  CloneSceneInputSchema,
} from "./schemas";
import type { UpdateDesignMetaInput } from "./schemas";
import { gate } from "./assets-actions-gate";

/**
 * Wave 1A — admin server actions for the overlay builder.
 *
 * All actions perm-gate on `overlay.design.manage` + rate-limit via
 * `enforceAuthedWrite`. Mirrors the pattern in
 * `apps/web/src/app/admin/broadcast/v2/design/actions.ts`. Per
 * CLAUDE.md §10 this file exports ONLY async functions; the schemas
 * + types live in the sibling `schemas.ts` file.
 *
 * Wave 2A: gate() lifted to shared assets-actions-gate.ts — behavior
 * unchanged; both action files share one implementation.
 */

/**
 * Create a new overlay design. Returns the new design's `{ id, slug }`.
 *
 * FormData fields:
 *   - title  — required; 1..120 chars
 *   - mode   — required; "single" | "sequence"
 */
export async function createDesignAction(
  formData: FormData,
): Promise<{ id: string; slug: string }> {
  const parsed = CreateDesignSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    mode: String(formData.get("mode") ?? ""),
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  const { sb, actor } = await gate();
  const result = await createDesign(sb, actor, {
    title: parsed.data.title,
    mode: parsed.data.mode,
    createdBy: actor.userId,
  });
  revalidatePath("/admin/broadcast/v2/builder");
  return { id: result.id, slug: result.slug };
}

/**
 * Persist the full design state (meta + all scenes + all elements).
 * Snapshots the prior state first so revert is always available.
 *
 * Bug 4 (2026-05-18): the prior implementation only flushed updates —
 * elements added in the client never reached the DB because no INSERT
 * path was wired. The save now diffs payload-vs-DB and routes each row
 * to INSERT / UPDATE / soft-DELETE so a fresh rect drawn on canvas
 * survives a page reload.
 *
 * Diff strategy:
 *   - Scenes: client must always round-trip a scene through
 *     `addSceneAction` before save, so payload scenes are expected to
 *     exist in DB. Missing scenes (id in DB, not in payload) get
 *     soft-deleted to support sequence-mode trims.
 *   - Elements: client generates v4 UUIDs (store.ts::makeUuid) and
 *     keeps them stable across save → reload. Payload elements not in
 *     DB get INSERTed with their client id; DB elements not in payload
 *     get soft-deleted; intersections route through `updateElements`.
 *
 * FormData fields:
 *   - designId  — required; existing design UUID
 *   - design    — required; JSON-serialised SaveDesignInput
 */
export async function saveDesignAction(formData: FormData): Promise<void> {
  const designId = String(formData.get("designId") ?? "");
  if (!designId) throw new Error("designId required");

  const designRaw = String(formData.get("design") ?? "");
  let designParsed: unknown;
  try {
    designParsed = JSON.parse(designRaw);
  } catch {
    throw new Error("design must be valid JSON");
  }

  const parsed = SaveDesignSchema.safeParse(designParsed);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }

  const { sb, actor } = await gate();

  // Snapshot BEFORE mutating so revert can always reach the prior state.
  await snapshotDesign(sb, actor, designId, "auto-save");

  // Update design metadata (title, mode, status, canvas dims).
  await updateDesign(sb, actor, designId, {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    mode: parsed.data.mode,
    status: parsed.data.status,
    canvas_width: parsed.data.canvas_width,
    canvas_height: parsed.data.canvas_height,
  });

  // ── Scene diff: payload vs live DB ─────────────────────────────
  const { data: existingScenes, error: sceneListErr } = await sb
    .from("overlay_user_design_scenes")
    .select("id")
    .eq("design_id", designId)
    .is("deleted_at", null);
  if (sceneListErr) {
    throw new Error(`saveDesignAction scenes list: ${sceneListErr.message}`);
  }
  const existingSceneIds = new Set(
    ((existingScenes ?? []) as Array<{ id: string }>).map((r) => r.id),
  );
  const payloadSceneIds = new Set(parsed.data.scenes.map((s) => s.id));

  // Soft-delete scenes that vanished from the payload (sequence trims).
  for (const id of existingSceneIds) {
    if (!payloadSceneIds.has(id)) {
      await deleteSceneCrud(sb, id);
    }
  }

  // Update scenes that exist in both. New scenes are NOT expected here
  // — the ScenePicker always round-trips via `addSceneAction` before
  // save, so any payload scene id missing from DB indicates a client
  // bug. Warn loud rather than silently inserting.
  const scenesToUpdate = parsed.data.scenes.filter((s) =>
    existingSceneIds.has(s.id),
  );
  if (scenesToUpdate.length !== parsed.data.scenes.length) {
    const missing = parsed.data.scenes
      .filter((s) => !existingSceneIds.has(s.id))
      .map((s) => s.id);
    console.warn(
      `saveDesignAction: ${missing.length} scene id(s) not in DB; skipping update: ${missing.join(",")}`,
    );
  }
  await updateScenes(
    sb,
    actor,
    designId,
    scenesToUpdate.map((s) => ({
      id: s.id,
      patch: {
        name: s.name ?? null,
        durationMs: s.duration_ms,
        transitionIn: s.transition_in,
        transitionOut: s.transition_out,
        orderIndex: s.order_index,
      },
    })),
  );

  // ── Element diff: payload vs live DB ───────────────────────────
  // Build live-element set scoped to surviving scenes (post-delete).
  const liveSceneIds = parsed.data.scenes
    .map((s) => s.id)
    .filter((id) => existingSceneIds.has(id));
  let existingElementIds = new Set<string>();
  if (liveSceneIds.length > 0) {
    const { data: existingElements, error: elListErr } = await sb
      .from("overlay_user_design_elements")
      .select("id")
      .in("scene_id", liveSceneIds)
      .is("deleted_at", null);
    if (elListErr) {
      throw new Error(`saveDesignAction elements list: ${elListErr.message}`);
    }
    existingElementIds = new Set(
      ((existingElements ?? []) as Array<{ id: string }>).map((r) => r.id),
    );
  }

  const payloadElements = parsed.data.scenes.flatMap((s) =>
    s.elements.map((el) => ({ sceneId: s.id, el })),
  );
  const payloadElementIds = new Set(payloadElements.map(({ el }) => el.id));

  // INSERT elements present in payload but missing from DB.
  for (const { sceneId, el } of payloadElements) {
    if (existingElementIds.has(el.id)) continue;
    // Skip elements whose owning scene was never created server-side.
    if (!existingSceneIds.has(sceneId)) continue;
    await addElementCrud(sb, sceneId, {
      id: el.id,
      elementType: el.element_type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform: el.transform as any,
      style: el.style as Style,
      content: (el.content ?? {}) as Record<string, unknown>,
      // The schemas.ts wire shape allows `feed: string` but the runtime
      // AddElementInput accepts the validated `FeedName` enum. The
      // `validateBinding` gate inside addElementCrud will reject any
      // payload that doesn't match the enum, so the cast is safe.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      binding: (el.binding ?? null) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      animation: (el.animation ?? {}) as any,
      parentGroupId: el.parent_group_id ?? null,
    });
  }

  // UPDATE elements present in both. Cast to ElementBulkUpdate[]:
  // schemas.ts uses .nullable() for round-trip safety but domain types
  // use .optional()-only. Values are Zod-validated at runtime so the
  // cast is safe — null fields are absent in practice.
  const elementsToUpdate = payloadElements
    .filter(({ el }) => existingElementIds.has(el.id))
    .map(({ sceneId, el }) => ({
      id: el.id,
      patch: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transform: el.transform as any,
        style: el.style as Style | undefined,
        content: el.content ?? undefined,
        binding: el.binding ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animation: el.animation as any,
        locked: el.locked,
        visible: el.visible,
        scene_id: sceneId,
      },
    })) as import("@/server/overlays/builder/elements").ElementBulkUpdate[];
  await updateElements(sb, actor, designId, elementsToUpdate);

  // Soft-delete elements that vanished from the payload.
  for (const id of existingElementIds) {
    if (!payloadElementIds.has(id)) {
      await deleteElementCrud(sb, id);
    }
  }

  revalidatePath("/admin/broadcast/v2/builder");
  revalidatePath(`/admin/broadcast/v2/builder/${parsed.data.slug}/edit`);
  revalidatePath(`/overlay/v2/user/${parsed.data.slug}`);
}

/**
 * Publish a design — sets status = "published" and inserts a sibling
 * row in `overlay_template_variants` (kind = "dynamic").
 *
 * Also revalidates the `[slug]/edit` page so the in-canvas TopBar pill +
 * Publish/Unpublish button swap reflect the new status without forcing
 * the user to hard-reload (previously caused stale UI bug).
 */
export async function publishDesignAction(designId: string): Promise<void> {
  if (!designId) throw new Error("designId required");
  const { sb, actor } = await gate();
  await publishDesign(sb, actor, designId);
  revalidatePath("/admin/broadcast/v2/builder");
  // Look up the slug so we can revalidate the editor route too.
  const { data: row } = await sb
    .from("overlay_user_designs")
    .select("slug")
    .eq("id", designId)
    .maybeSingle();
  if (row?.slug) {
    revalidatePath(`/admin/broadcast/v2/builder/${row.slug}/edit`);
    revalidatePath(`/overlay/v2/user/${row.slug}`);
  }
}

/**
 * Unpublish a design — sets status = "draft" and soft-deletes the
 * `overlay_template_variants` row so the broadcast control panel hides it.
 *
 * Also revalidates the `[slug]/edit` page so the in-canvas TopBar pill +
 * Publish/Unpublish button swap reflect the new status without forcing
 * the user to hard-reload.
 */
export async function unpublishDesignAction(designId: string): Promise<void> {
  if (!designId) throw new Error("designId required");
  const { sb, actor } = await gate();
  await unpublishDesign(sb, actor, designId);
  revalidatePath("/admin/broadcast/v2/builder");
  const { data: row } = await sb
    .from("overlay_user_designs")
    .select("slug")
    .eq("id", designId)
    .maybeSingle();
  if (row?.slug) {
    revalidatePath(`/admin/broadcast/v2/builder/${row.slug}/edit`);
    revalidatePath(`/overlay/v2/user/${row.slug}`);
  }
}

/**
 * Soft-delete a design. Sets `deleted_at` on the design row. Scenes +
 * elements cascade when the design is later hard-deleted.
 */
export async function softDeleteDesignAction(designId: string): Promise<void> {
  if (!designId) throw new Error("designId required");
  const { sb, actor } = await gate();
  await softDeleteDesign(sb, actor, designId);
  revalidatePath("/admin/broadcast/v2/builder");
}

/**
 * Patch design metadata only (title, description, mode, status).
 * Does NOT update scenes or elements.
 */
export async function updateDesignMetaAction(
  designId: string,
  patch: UpdateDesignMetaInput,
): Promise<void> {
  if (!designId) throw new Error("designId required");
  const { sb, actor } = await gate();
  await updateDesign(sb, actor, designId, {
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.mode !== undefined && { mode: patch.mode }),
    ...(patch.status !== undefined && { status: patch.status }),
  });
  revalidatePath("/admin/broadcast/v2/builder");
}

// ────────────── Wave 3A — Scene-scoped server actions ──────────────
//
// Each gates on `overlay.design.manage` via the shared `gate()` helper
// (perm check + rate limit), then delegates to the scenes.ts CRUD layer.
// Sync Zod schemas live in `./schemas` per CLAUDE.md §10.

/**
 * Insert a new scene into a design after the scene currently at
 * `afterOrderIndex`. Pass `-1` to insert at position 0 (the front).
 */
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

/**
 * Patch a scene's editable fields (name, duration, transitions). Only
 * provided keys are updated.
 */
export async function updateSceneAction(
  raw: unknown,
): Promise<{ ok: true }> {
  const input = UpdateSceneInputSchema.parse(raw);
  const { sb } = await gate();
  await updateSceneCrud(sb, input.sceneId, input.patch);
  revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
  return { ok: true };
}

/**
 * Reassign `order_index` across a design's scenes in one transaction.
 * `sceneIdOrder` must list every live scene id for the design.
 */
export async function reorderScenesAction(
  raw: unknown,
): Promise<{ ok: true }> {
  const input = ReorderScenesInputSchema.parse(raw);
  const { sb } = await gate();
  await reorderScenesCrud(sb, input.designId, input.sceneIdOrder);
  revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
  return { ok: true };
}

/**
 * Soft-delete a scene. The CRUD layer also reindexes remaining scenes
 * so `order_index` stays dense.
 */
export async function deleteSceneAction(
  raw: unknown,
): Promise<{ ok: true }> {
  const input = DeleteSceneInputSchema.parse(raw);
  const { sb } = await gate();
  await deleteSceneCrud(sb, input.sceneId);
  revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
  return { ok: true };
}

/**
 * Duplicate a scene (deep copy elements). The clone is appended at the
 * end of the design's scene chain.
 */
export async function cloneSceneAction(
  raw: unknown,
): Promise<{ ok: true; scene: Awaited<ReturnType<typeof cloneSceneCrud>> }> {
  const input = CloneSceneInputSchema.parse(raw);
  const { sb } = await gate();
  const scene = await cloneSceneCrud(sb, input.sceneId);
  revalidatePath(`/admin/broadcast/v2/builder/${input.designSlug}/edit`);
  return { ok: true, scene };
}
