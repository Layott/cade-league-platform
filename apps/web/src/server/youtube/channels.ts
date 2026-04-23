import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 47 — DB-backed YouTube channel registry.
 *
 * Replaces the Plan 44 hard-coded `@CadeEsports` literal. CRUD is
 * admin-only via `branding.manage`; reads are unauthenticated (anon
 * SELECT allowed by migration `20260511000200`).
 */

export type YouTubeChannel = {
  id: string;
  handle: string;
  displayLabel: string | null;
  isDefault: boolean;
  createdAt: string;
};

type Row = {
  id: string;
  handle: string;
  display_label: string | null;
  is_default: boolean;
  created_at: string;
};

const HANDLE_RE = /^@[A-Za-z0-9_.-]+$/;

function toChannel(r: Row): YouTubeChannel {
  return {
    id: r.id,
    handle: r.handle,
    displayLabel: r.display_label,
    isDefault: r.is_default,
    createdAt: r.created_at,
  };
}

export async function listChannels(
  sb: SupabaseClient,
): Promise<YouTubeChannel[]> {
  const { data, error } = await sb
    .from("youtube_channels")
    .select("id, handle, display_label, is_default, created_at")
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("handle", { ascending: true });
  if (error) throw new Error(`listChannels failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toChannel);
}

export async function getDefaultChannel(
  sb: SupabaseClient,
): Promise<YouTubeChannel | null> {
  const { data, error } = await sb
    .from("youtube_channels")
    .select("id, handle, display_label, is_default, created_at")
    .is("deleted_at", null)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw new Error(`getDefaultChannel failed: ${error.message}`);
  return data ? toChannel(data as Row) : null;
}

export async function createChannel(
  sb: SupabaseClient,
  input: {
    handle: string;
    displayLabel?: string;
    isDefault?: boolean;
    userId: string;
  },
): Promise<{ id: string }> {
  const handle = input.handle.trim();
  if (!HANDLE_RE.test(handle)) {
    throw new Error(
      `handle must look like '@ChannelName' (got: ${input.handle})`,
    );
  }

  // If the new row becomes default, clear any existing default first so
  // the partial unique index doesn't block us. Small-volume table, so
  // no transaction boundary needed.
  if (input.isDefault) {
    const { error: clearErr } = await sb
      .from("youtube_channels")
      .update({ is_default: false })
      .eq("is_default", true)
      .is("deleted_at", null);
    if (clearErr) {
      throw new Error(
        `createChannel: failed to clear prior default — ${clearErr.message}`,
      );
    }
  }

  const { data, error } = await sb
    .from("youtube_channels")
    .insert({
      handle,
      display_label: input.displayLabel?.trim() || null,
      is_default: input.isDefault ?? false,
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createChannel insert: ${error?.message ?? "no row"}`);
  }
  return { id: (data as { id: string }).id };
}

export async function deleteChannel(
  sb: SupabaseClient,
  id: string,
  userId: string,
): Promise<void> {
  void userId;
  const { error } = await sb
    .from("youtube_channels")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`deleteChannel: ${error.message}`);
}

export async function promoteToDefault(
  sb: SupabaseClient,
  id: string,
  userId: string,
): Promise<void> {
  void userId;
  // Clear existing defaults first.
  const { error: clearErr } = await sb
    .from("youtube_channels")
    .update({ is_default: false })
    .eq("is_default", true)
    .is("deleted_at", null);
  if (clearErr) {
    throw new Error(`promoteToDefault clear: ${clearErr.message}`);
  }
  const { error } = await sb
    .from("youtube_channels")
    .update({ is_default: true })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`promoteToDefault: ${error.message}`);
}
