import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TEMPLATE_REGISTRY,
  isTemplateKey,
  type TemplateKey,
} from "./registry";
import { triggerOverlay } from "@/server/broadcast/events";
import { triggerInstance } from "./instances";

/**
 * Plan 37 — overlay_presets server module.
 *
 * Generic preset library keyed by template_key. Payloads validated against
 * the registry's Zod schema at write + load time. Service-role caller only
 * (admin gating done in actions.ts via requirePermAsync).
 */

export type Preset = {
  id: string;
  templateKey: TemplateKey;
  label: string;
  payload: Record<string, unknown>;
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type PresetRow = {
  id: string;
  template_key: string;
  label: string;
  payload: Record<string, unknown>;
  is_default: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function toPreset(r: PresetRow): Preset {
  return {
    id: r.id,
    templateKey: r.template_key as TemplateKey,
    label: r.label,
    payload: r.payload,
    isDefault: r.is_default,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listPresets(
  sb: SupabaseClient,
  templateKey?: string,
): Promise<Preset[]> {
  let q = sb
    .from("overlay_presets")
    .select(
      "id, template_key, label, payload, is_default, created_by, created_at, updated_at",
    )
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("label", { ascending: true });
  if (templateKey) q = q.eq("template_key", templateKey);
  const { data, error } = await q;
  if (error) throw new Error(`listPresets failed: ${error.message}`);
  return (data ?? []).map((r) => toPreset(r as PresetRow));
}

export async function getPreset(
  sb: SupabaseClient,
  id: string,
): Promise<Preset | null> {
  const { data, error } = await sb
    .from("overlay_presets")
    .select(
      "id, template_key, label, payload, is_default, created_by, created_at, updated_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getPreset failed: ${error.message}`);
  return data ? toPreset(data as PresetRow) : null;
}

export async function createPreset(
  sb: SupabaseClient,
  input: {
    templateKey: string;
    label: string;
    payload: unknown;
    userId: string;
    isDefault?: boolean;
  },
): Promise<{ id: string }> {
  if (!isTemplateKey(input.templateKey)) {
    throw new Error(`unknown templateKey: ${input.templateKey}`);
  }
  const key: TemplateKey = input.templateKey;
  const schema = TEMPLATE_REGISTRY[key].schema;
  const parsed = schema.parse(input.payload);

  const { data, error } = await sb
    .from("overlay_presets")
    .insert({
      template_key: key,
      label: input.label.trim(),
      payload: parsed as Record<string, unknown>,
      is_default: input.isDefault ?? false,
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createPreset insert failed: ${error?.message ?? "no row"}`);
  }
  return { id: (data as { id: string }).id };
}

export async function updatePreset(
  sb: SupabaseClient,
  id: string,
  input: {
    label?: string;
    payload?: unknown;
    isDefault?: boolean;
    userId: string;
  },
): Promise<void> {
  void input.userId; // audit trigger reads from session GUC

  const existing = await getPreset(sb, id);
  if (!existing) throw new Error(`preset not found: ${id}`);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) update.label = input.label.trim();
  if (input.isDefault !== undefined) update.is_default = input.isDefault;
  if (input.payload !== undefined) {
    const schema = TEMPLATE_REGISTRY[existing.templateKey].schema;
    update.payload = schema.parse(input.payload) as Record<string, unknown>;
  }

  const { error } = await sb
    .from("overlay_presets")
    .update(update)
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`updatePreset failed: ${error.message}`);
}

export async function deletePreset(
  sb: SupabaseClient,
  id: string,
  userId: string,
): Promise<void> {
  void userId;
  const { error } = await sb
    .from("overlay_presets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`deletePreset failed: ${error.message}`);
}

export async function restorePreset(
  sb: SupabaseClient,
  id: string,
  userId: string,
): Promise<void> {
  void userId;
  const { error } = await sb
    .from("overlay_presets")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) throw new Error(`restorePreset failed: ${error.message}`);
}

/**
 * Convenience: load preset → trigger overlay (or instance for lower_third).
 * For lower_third the caller must supply `instanceSlot` (1..3).
 */
export async function loadPresetIntoEvent(
  sb: SupabaseClient,
  input: {
    presetId: string;
    sessionId: string;
    userId: string;
    instanceSlot?: number;
  },
): Promise<{ id: string }> {
  const p = await getPreset(sb, input.presetId);
  if (!p) throw new Error(`preset not found: ${input.presetId}`);

  if (p.templateKey === "lower_third") {
    if (!input.instanceSlot || input.instanceSlot < 1 || input.instanceSlot > 3) {
      throw new Error("lower_third requires instanceSlot 1..3");
    }
    return triggerInstance(sb, {
      sessionId: input.sessionId,
      templateKey: p.templateKey,
      instanceSlot: input.instanceSlot,
      payload: p.payload,
      userId: input.userId,
    });
  }
  return triggerOverlay(sb, {
    sessionId: input.sessionId,
    templateKey: p.templateKey,
    payload: p.payload,
    userId: input.userId,
  });
}
