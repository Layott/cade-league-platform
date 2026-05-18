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
import { updateScenes } from "@/server/overlays/builder/scenes";
import { updateElements } from "@/server/overlays/builder/elements";
import { CreateDesignSchema, SaveDesignSchema } from "./schemas";
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

  // Bulk-update scenes from the parsed scene list.
  await updateScenes(
    sb,
    actor,
    designId,
    parsed.data.scenes.map((s) => ({
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

  // Flatten all elements across scenes for one bulk update call.
  // Cast to ElementBulkUpdate[]: schemas.ts uses .nullable() for round-trip
  // safety but domain types use .optional()-only. Values are Zod-validated
  // at runtime so the cast is safe — null fields are absent in practice.
  await updateElements(
    sb,
    actor,
    designId,
    parsed.data.scenes.flatMap((s) =>
      s.elements.map((el) => ({
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
          scene_id: s.id,
        },
      })),
    ) as import("@/server/overlays/builder/elements").ElementBulkUpdate[],
  );

  revalidatePath("/admin/broadcast/v2/builder");
  revalidatePath(`/admin/broadcast/v2/builder/${parsed.data.slug}/edit`);
  revalidatePath(`/overlay/v2/user/${parsed.data.slug}`);
}

/**
 * Publish a design — sets status = "published" and inserts a sibling
 * row in `overlay_template_variants` (kind = "dynamic").
 */
export async function publishDesignAction(designId: string): Promise<void> {
  if (!designId) throw new Error("designId required");
  const { sb, actor } = await gate();
  await publishDesign(sb, actor, designId);
  revalidatePath("/admin/broadcast/v2/builder");
}

/**
 * Unpublish a design — sets status = "draft" and soft-deletes the
 * `overlay_template_variants` row so the broadcast control panel hides it.
 */
export async function unpublishDesignAction(designId: string): Promise<void> {
  if (!designId) throw new Error("designId required");
  const { sb, actor } = await gate();
  await unpublishDesign(sb, actor, designId);
  revalidatePath("/admin/broadcast/v2/builder");
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
