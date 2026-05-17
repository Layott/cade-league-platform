/**
 * Overlay Builder — Elements CRUD.
 *
 * Every write runs through:
 *   1. validateStyle(elementType, style)
 *   2. validateBinding(binding, AVAILABLE_FEEDS)  if binding present
 *   3. validateAnimation(animation)                if animation present
 *
 * Validation failures aggregate into one thrown Error. The DB row is
 * NEVER touched if any validator rejects.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §4 + §12
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateAnimation } from "./animation-validator";
import { validateBinding } from "./binding-validator";
import { validateStyle } from "./style-validator";
import { FeedNameSchema } from "./types";
import type {
  Animation,
  Binding,
  Element,
  ElementType,
  FeedName,
  Style,
  Transform,
} from "./types";

const AVAILABLE_FEEDS: FeedName[] = FeedNameSchema.options;

type ElementRow = {
  id: string;
  scene_id: string;
  parent_group_id: string | null;
  element_type: string;
  z_index: number;
  locked: boolean;
  visible: boolean;
  transform: unknown;
  style: unknown;
  content: unknown;
  binding: unknown;
  animation: unknown;
  deleted_at?: string | null;
};

function rowToElement(r: ElementRow): Element {
  return {
    id: r.id,
    sceneId: r.scene_id,
    parentGroupId: r.parent_group_id,
    elementType: r.element_type as ElementType,
    zIndex: r.z_index,
    locked: r.locked,
    visible: r.visible,
    transform: r.transform as Transform,
    style: (r.style ?? {}) as Style,
    content: (r.content ?? {}) as Record<string, unknown>,
    binding: (r.binding ?? null) as Binding | null,
    animation: (r.animation ?? {}) as Animation,
  };
}

export type AddElementInput = {
  elementType: ElementType;
  transform: Transform;
  style: unknown;
  content: Record<string, unknown>;
  binding: Binding | null;
  animation: Animation | Record<string, unknown>;
  parentGroupId: string | null;
};

/**
 * Three-stage validation gate — runs before any DB write.
 * Aggregates all errors and throws a single descriptive Error if any
 * stage fails so the admin UI can surface every problem at once.
 */
function validateBundle(
  elementType: ElementType,
  style: unknown,
  binding: Binding | null | undefined,
  animation: unknown,
): { style: Style; binding: Binding | null; animation: Animation } {
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

  if (errors.length > 0) {
    throw new Error(`element validation failed: ${errors.join("; ")}`);
  }
  return {
    style: styleR.ok ? styleR.value : ({} as Style),
    binding: bindingValid,
    animation: animR.ok ? animR.value : ({} as Animation),
  };
}

export async function addElement(
  sb: SupabaseClient,
  sceneId: string,
  input: AddElementInput,
): Promise<Element> {
  // Gate: validate before any DB touch.
  const v = validateBundle(
    input.elementType,
    input.style,
    input.binding,
    input.animation,
  );

  // Determine z_index — append at the top of the stack.
  const { data: siblings, error: sibErr } = await sb
    .from("overlay_user_design_elements")
    .select("z_index")
    .eq("scene_id", sceneId)
    .is("deleted_at", null);
  if (sibErr) throw new Error(`addElement siblings: ${sibErr.message}`);
  const maxZ = ((siblings ?? []) as Array<{ z_index: number }>)
    .filter((s) => (s as unknown as ElementRow).deleted_at == null)
    .reduce((m, s) => Math.max(m, s.z_index), -1);

  const { data, error } = await sb
    .from("overlay_user_design_elements")
    .insert({
      scene_id: sceneId,
      parent_group_id: input.parentGroupId,
      element_type: input.elementType,
      z_index: maxZ + 1,
      locked: false,
      visible: true,
      transform: input.transform,
      style: v.style,
      content: input.content,
      binding: v.binding,
      animation: v.animation,
    })
    .select()
    .single();
  if (error) throw new Error(`addElement insert: ${error.message}`);
  return rowToElement(data as ElementRow);
}

export type UpdateElementPatch = Partial<{
  transform: Transform;
  style: unknown;
  content: Record<string, unknown>;
  binding: Binding | null;
  animation: Animation | Record<string, unknown>;
  locked: boolean;
  visible: boolean;
  parentGroupId: string | null;
}>;

export async function updateElement(
  sb: SupabaseClient,
  elementId: string,
  patch: UpdateElementPatch,
): Promise<void> {
  // Load current row to know element_type for validator dispatch.
  const { data: current, error: getErr } = await sb
    .from("overlay_user_design_elements")
    .select("*")
    .eq("id", elementId)
    .is("deleted_at", null)
    .maybeSingle();
  if (getErr) throw new Error(`updateElement get: ${getErr.message}`);
  if (!current) throw new Error(`updateElement: element ${elementId} not found`);
  const row = current as ElementRow;
  const elementType = row.element_type as ElementType;

  // Re-validate all fields against the patched state.
  const nextStyle = patch.style !== undefined ? patch.style : row.style;
  const nextBinding =
    patch.binding !== undefined ? patch.binding : (row.binding as Binding | null);
  const nextAnimation =
    patch.animation !== undefined ? patch.animation : row.animation;
  validateBundle(elementType, nextStyle, nextBinding ?? null, nextAnimation);

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.transform !== undefined) update.transform = patch.transform;
  if (patch.style !== undefined) update.style = patch.style;
  if (patch.content !== undefined) update.content = patch.content;
  if (patch.binding !== undefined) update.binding = patch.binding;
  if (patch.animation !== undefined) update.animation = patch.animation;
  if (patch.locked !== undefined) update.locked = patch.locked;
  if (patch.visible !== undefined) update.visible = patch.visible;
  if (patch.parentGroupId !== undefined) update.parent_group_id = patch.parentGroupId;

  const { error } = await sb
    .from("overlay_user_design_elements")
    .update(update)
    .eq("id", elementId)
    .select()
    .single();
  if (error) throw new Error(`updateElement: ${error.message}`);
}

export async function deleteElement(
  sb: SupabaseClient,
  elementId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_user_design_elements")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("id", elementId)
    .select()
    .single();
  if (error) throw new Error(`deleteElement: ${error.message}`);
}

export async function reorderElements(
  sb: SupabaseClient,
  sceneId: string,
  elementIdOrder: string[],
): Promise<void> {
  // Two-pass to avoid uniqueness collisions if a partial index on
  // (scene_id, z_index) is ever added.
  for (let i = 0; i < elementIdOrder.length; i++) {
    const id = elementIdOrder[i];
    const { error } = await sb
      .from("overlay_user_design_elements")
      .update({
        z_index: i + 100000,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`reorderElements pass1 ${id}: ${error.message}`);
  }
  for (let i = 0; i < elementIdOrder.length; i++) {
    const id = elementIdOrder[i];
    const { error } = await sb
      .from("overlay_user_design_elements")
      .update({ z_index: i, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`reorderElements pass2 ${id}: ${error.message}`);
  }
  // sceneId retained for future RLS / audit use.
  void sceneId;
}

export async function cloneElement(
  sb: SupabaseClient,
  elementId: string,
): Promise<Element> {
  const { data, error } = await sb
    .from("overlay_user_design_elements")
    .select("*")
    .eq("id", elementId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`cloneElement get: ${error.message}`);
  if (!data) throw new Error(`cloneElement: element ${elementId} not found`);
  const src = data as ElementRow;

  const srcTransform = src.transform as Transform;
  const newTransform: Transform = {
    ...srcTransform,
    x: srcTransform.x + 20,
    y: srcTransform.y + 20,
  };

  // Append clone at the top of the z-stack.
  const { data: siblings, error: sibErr } = await sb
    .from("overlay_user_design_elements")
    .select("z_index")
    .eq("scene_id", src.scene_id)
    .is("deleted_at", null);
  if (sibErr) throw new Error(`cloneElement siblings: ${sibErr.message}`);
  const maxZ = ((siblings ?? []) as Array<{ z_index: number }>)
    .filter((s) => (s as unknown as ElementRow).deleted_at == null)
    .reduce((m, s) => Math.max(m, s.z_index), -1);

  const { data: inserted, error: insertErr } = await sb
    .from("overlay_user_design_elements")
    .insert({
      scene_id: src.scene_id,
      parent_group_id: src.parent_group_id,
      element_type: src.element_type,
      z_index: maxZ + 1,
      locked: src.locked,
      visible: src.visible,
      transform: newTransform,
      style: src.style,
      content: src.content,
      binding: src.binding,
      animation: src.animation,
    })
    .select()
    .single();
  if (insertErr) throw new Error(`cloneElement insert: ${insertErr.message}`);
  return rowToElement(inserted as ElementRow);
}
