import type { SupabaseClient } from "@supabase/supabase-js";
import { publish } from "@/server/broadcast/realtime";
import {
  TEMPLATE_REGISTRY,
  REALTIME,
  isTemplateKey,
  type TemplateKey,
} from "./registry";

/**
 * Plan 37 — overlay_active_instances server module.
 *
 * Multi-active slot model (currently only allowlists `lower_third`, slots
 * 1..3). triggerInstance upserts on the partial unique
 * (session, template_key, slot) where active. updateInstancePayload
 * mutates in place + republishes — no new id, no flicker.
 */

export type ActiveInstance = {
  id: string;
  streamSessionId: string;
  templateKey: TemplateKey;
  instanceSlot: number;
  payload: Record<string, unknown>;
  triggeredAt: string;
  clearedAt: string | null;
  triggeredBy: string | null;
};

type InstanceRow = {
  id: string;
  stream_session_id: string;
  template_key: string;
  instance_slot: number;
  payload: Record<string, unknown>;
  triggered_at: string;
  cleared_at: string | null;
  triggered_by: string | null;
};

function toInstance(r: InstanceRow): ActiveInstance {
  return {
    id: r.id,
    streamSessionId: r.stream_session_id,
    templateKey: r.template_key as TemplateKey,
    instanceSlot: r.instance_slot,
    payload: r.payload,
    triggeredAt: r.triggered_at,
    clearedAt: r.cleared_at,
    triggeredBy: r.triggered_by,
  };
}

export async function listActiveInstances(
  sb: SupabaseClient,
  sessionId: string,
  templateKey?: string,
): Promise<ActiveInstance[]> {
  // Build the chain with templateKey filter applied BEFORE ordering so
  // PostgREST's filter chain stays intact regardless of optional filter
  // presence.
  const baseSelect = sb
    .from("overlay_active_instances")
    .select(
      "id, stream_session_id, template_key, instance_slot, payload, triggered_at, cleared_at, triggered_by",
    )
    .eq("stream_session_id", sessionId);
  const filtered = templateKey
    ? baseSelect.eq("template_key", templateKey)
    : baseSelect;
  const { data, error } = await filtered
    .is("cleared_at", null)
    .is("deleted_at", null)
    .order("instance_slot", { ascending: true });
  if (error) throw new Error(`listActiveInstances failed: ${error.message}`);
  return (data ?? []).map((r) => toInstance(r as InstanceRow));
}

export async function triggerInstance(
  sb: SupabaseClient,
  input: {
    sessionId: string;
    templateKey: string;
    instanceSlot: number;
    payload: unknown;
    userId: string;
  },
): Promise<{ id: string }> {
  if (!isTemplateKey(input.templateKey)) {
    throw new Error(`unknown templateKey: ${input.templateKey}`);
  }
  if (input.instanceSlot < 1 || input.instanceSlot > 3) {
    throw new Error(`instanceSlot must be 1..3: got ${input.instanceSlot}`);
  }
  const key: TemplateKey = input.templateKey;
  const schema = TEMPLATE_REGISTRY[key].schema;
  const parsed = schema.parse(input.payload);

  // Clear any existing live row in the same slot first (partial unique
  // index would otherwise reject the insert).
  const now = new Date().toISOString();
  await sb
    .from("overlay_active_instances")
    .update({ cleared_at: now })
    .eq("stream_session_id", input.sessionId)
    .eq("template_key", key)
    .eq("instance_slot", input.instanceSlot)
    .is("cleared_at", null)
    .is("deleted_at", null);

  const { data, error } = await sb
    .from("overlay_active_instances")
    .insert({
      stream_session_id: input.sessionId,
      template_key: key,
      instance_slot: input.instanceSlot,
      payload: parsed as Record<string, unknown>,
      triggered_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `triggerInstance insert failed: ${error?.message ?? "no row"}`,
    );
  }
  const id = (data as { id: string }).id;

  try {
    await publish(sb, input.sessionId, REALTIME.eventInstanceTriggered, {
      instanceId: id,
      instanceSlot: input.instanceSlot,
      templateKey: key,
      payload: parsed,
    });
  } catch {
    // swallow — durable row already written.
  }

  return { id };
}

export async function clearInstance(
  sb: SupabaseClient,
  instanceId: string,
  userId: string,
): Promise<void> {
  void userId;
  const { data: row, error: readErr } = await sb
    .from("overlay_active_instances")
    .select("id, stream_session_id, template_key, instance_slot")
    .eq("id", instanceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) throw new Error(`clearInstance read failed: ${readErr.message}`);
  if (!row) throw new Error(`instance not found: ${instanceId}`);
  const r = row as {
    id: string;
    stream_session_id: string;
    template_key: string;
    instance_slot: number;
  };

  const { error: updErr } = await sb
    .from("overlay_active_instances")
    .update({ cleared_at: new Date().toISOString() })
    .eq("id", instanceId)
    .is("cleared_at", null);
  if (updErr) throw new Error(`clearInstance update failed: ${updErr.message}`);

  try {
    await publish(sb, r.stream_session_id, REALTIME.eventInstanceCleared, {
      instanceId: r.id,
      instanceSlot: r.instance_slot,
      templateKey: r.template_key,
    });
  } catch {
    // swallow
  }
}

export async function clearAllInstances(
  sb: SupabaseClient,
  sessionId: string,
  templateKey: string,
  userId: string,
): Promise<void> {
  void userId;
  const list = await listActiveInstances(sb, sessionId, templateKey);
  for (const inst of list) {
    await clearInstance(sb, inst.id, userId);
  }
}

export async function updateInstancePayload(
  sb: SupabaseClient,
  instanceId: string,
  payload: unknown,
  userId: string,
): Promise<void> {
  void userId;
  const { data: row, error: readErr } = await sb
    .from("overlay_active_instances")
    .select("id, stream_session_id, template_key, instance_slot")
    .eq("id", instanceId)
    .is("deleted_at", null)
    .is("cleared_at", null)
    .maybeSingle();
  if (readErr) {
    throw new Error(`updateInstancePayload read failed: ${readErr.message}`);
  }
  if (!row) throw new Error(`active instance not found: ${instanceId}`);

  const r = row as {
    id: string;
    stream_session_id: string;
    template_key: string;
    instance_slot: number;
  };
  if (!isTemplateKey(r.template_key)) {
    throw new Error(`unknown templateKey on row: ${r.template_key}`);
  }
  const schema = TEMPLATE_REGISTRY[r.template_key as TemplateKey].schema;
  const parsed = schema.parse(payload);

  const { error: updErr } = await sb
    .from("overlay_active_instances")
    .update({
      payload: parsed as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", instanceId);
  if (updErr) {
    throw new Error(`updateInstancePayload update failed: ${updErr.message}`);
  }

  try {
    await publish(sb, r.stream_session_id, REALTIME.eventInstanceTriggered, {
      instanceId: r.id,
      instanceSlot: r.instance_slot,
      templateKey: r.template_key,
      payload: parsed,
    });
  } catch {
    // swallow
  }
}
