import type { SupabaseClient } from "@supabase/supabase-js";
import { publish } from "./realtime";
import {
  TEMPLATE_REGISTRY,
  REALTIME,
  isTemplateKey,
  type TemplateKey,
} from "@/server/overlays/registry";

/**
 * Plan 12 — overlay trigger + clear.
 *
 * `triggerOverlay()` validates payload via the template's Zod schema,
 * resolves the template UUID, inserts an overlay_events row, then
 * publishes on the session's realtime channel. Fire-and-forget publish:
 * the DB row is the durable record.
 *
 * `clearOverlay()` sets `cleared_at = now()` on a still-active row and
 * publishes `overlay.cleared`.
 */

export type TriggerOverlayInput = {
  sessionId: string;
  templateKey: string;
  payload: unknown;
  userId: string;
};

export type ActiveOverlay = {
  id: string;
  stream_session_id: string;
  template_id: string;
  template_key: string;
  payload: Record<string, unknown>;
  triggered_at: string;
  cleared_at: string | null;
};

async function resolveTemplateId(
  sb: SupabaseClient,
  templateKey: TemplateKey,
): Promise<string> {
  const { data, error } = await sb
    .from("overlay_templates")
    .select("id")
    .eq("template_key", templateKey)
    .eq("active_bool", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`resolveTemplateId failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(`template not found or inactive: ${templateKey}`);
  }
  return (data as { id: string }).id;
}

export async function triggerOverlay(
  sb: SupabaseClient,
  input: TriggerOverlayInput,
): Promise<{ id: string }> {
  if (!isTemplateKey(input.templateKey)) {
    throw new Error(`unknown templateKey: ${input.templateKey}`);
  }
  const key: TemplateKey = input.templateKey;

  // Zod-validate the payload up front — throws on mismatch.
  const schema = TEMPLATE_REGISTRY[key].schema;
  const parsed = schema.parse(input.payload);

  const templateId = await resolveTemplateId(sb, key);

  const { data, error } = await sb
    .from("overlay_events")
    .insert({
      stream_session_id: input.sessionId,
      template_id: templateId,
      triggered_by_user_id: input.userId,
      payload: parsed as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `triggerOverlay insert failed: ${error?.message ?? "no row"}`,
    );
  }
  const id = (data as { id: string }).id;

  // Publish on realtime channel. Best-effort; failures don't invalidate
  // the write.
  try {
    await publish(sb, input.sessionId, REALTIME.eventTriggered, {
      eventId: id,
      templateKey: key,
      payload: parsed,
    });
  } catch {
    // swallow — durable row already written.
  }

  return { id };
}

export async function clearOverlay(
  sb: SupabaseClient,
  eventId: string,
  userId: string,
): Promise<void> {
  // Retained in signature for future explicit audit context; the DB
  // audit trigger reads `app.current_user_id` which the API layer
  // must SET LOCAL before calling this helper.
  void userId;
  const now = new Date().toISOString();

  // We need the session id to know which channel to publish on.
  const { data: row, error: readErr } = await sb
    .from("overlay_events")
    .select("id, stream_session_id, template_id, overlay_templates:template_id ( template_key )")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) {
    throw new Error(`clearOverlay read failed: ${readErr.message}`);
  }
  if (!row) {
    throw new Error(`overlay event not found: ${eventId}`);
  }

  const r = row as unknown as {
    id: string;
    stream_session_id: string;
    template_id: string;
    overlay_templates: { template_key: string } | null;
  };

  const { error: updErr } = await sb
    .from("overlay_events")
    .update({ cleared_at: now })
    .eq("id", eventId)
    .is("cleared_at", null);
  if (updErr) {
    throw new Error(`clearOverlay update failed: ${updErr.message}`);
  }

  try {
    await publish(sb, r.stream_session_id, REALTIME.eventCleared, {
      eventId: r.id,
      templateKey: r.overlay_templates?.template_key ?? null,
    });
  } catch {
    // swallow — durable row already written.
  }
}

export async function listActiveOverlays(
  sb: SupabaseClient,
  sessionId: string,
): Promise<ActiveOverlay[]> {
  const { data } = await sb
    .from("overlay_events")
    .select(
      `
      id,
      stream_session_id,
      template_id,
      payload,
      triggered_at,
      cleared_at,
      overlay_templates:template_id ( template_key )
      `,
    )
    .eq("stream_session_id", sessionId)
    .is("cleared_at", null)
    .is("deleted_at", null)
    .order("triggered_at", { ascending: false });
  if (!data) return [];
  return (data as unknown as {
    id: string;
    stream_session_id: string;
    template_id: string;
    payload: Record<string, unknown>;
    triggered_at: string;
    cleared_at: string | null;
    overlay_templates: { template_key: string } | null;
  }[]).map((r) => ({
    id: r.id,
    stream_session_id: r.stream_session_id,
    template_id: r.template_id,
    template_key: r.overlay_templates?.template_key ?? "",
    payload: r.payload,
    triggered_at: r.triggered_at,
    cleared_at: r.cleared_at,
  }));
}

export async function getActiveForTemplate(
  sb: SupabaseClient,
  sessionId: string,
  templateKey: string,
): Promise<ActiveOverlay | null> {
  if (!isTemplateKey(templateKey)) return null;

  // Resolve template id first so the lookup is index-friendly.
  const { data: tpl } = await sb
    .from("overlay_templates")
    .select("id")
    .eq("template_key", templateKey)
    .is("deleted_at", null)
    .maybeSingle();
  if (!tpl) return null;

  const { data } = await sb
    .from("overlay_events")
    .select(
      "id, stream_session_id, template_id, payload, triggered_at, cleared_at",
    )
    .eq("stream_session_id", sessionId)
    .eq("template_id", (tpl as { id: string }).id)
    .is("cleared_at", null)
    .is("deleted_at", null)
    .order("triggered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const r = data as {
    id: string;
    stream_session_id: string;
    template_id: string;
    payload: Record<string, unknown>;
    triggered_at: string;
    cleared_at: string | null;
  };
  return {
    id: r.id,
    stream_session_id: r.stream_session_id,
    template_id: r.template_id,
    template_key: templateKey,
    payload: r.payload,
    triggered_at: r.triggered_at,
    cleared_at: r.cleared_at,
  };
}

export async function listSessionEvents(
  sb: SupabaseClient,
  sessionId: string,
  limit: number = 50,
): Promise<ActiveOverlay[]> {
  const { data } = await sb
    .from("overlay_events")
    .select(
      `
      id,
      stream_session_id,
      template_id,
      payload,
      triggered_at,
      cleared_at,
      overlay_templates:template_id ( template_key )
      `,
    )
    .eq("stream_session_id", sessionId)
    .is("deleted_at", null)
    .order("triggered_at", { ascending: false })
    .limit(limit);
  if (!data) return [];
  return (data as unknown as {
    id: string;
    stream_session_id: string;
    template_id: string;
    payload: Record<string, unknown>;
    triggered_at: string;
    cleared_at: string | null;
    overlay_templates: { template_key: string } | null;
  }[]).map((r) => ({
    id: r.id,
    stream_session_id: r.stream_session_id,
    template_id: r.template_id,
    template_key: r.overlay_templates?.template_key ?? "",
    payload: r.payload,
    triggered_at: r.triggered_at,
    cleared_at: r.cleared_at,
  }));
}
