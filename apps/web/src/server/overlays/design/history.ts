import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Overlay Design System — version history + revert.
 *
 * `overlay_design_history` is append-only (DB triggers block UPDATE +
 * DELETE — see migration 20260601000003). Every `setDesignToken` /
 * `clearDesignToken` writes one snapshot row capturing the FULL token
 * map BEFORE the mutation. `listHistory` powers the timeline UI;
 * `revertToSnapshot` rolls every token back to a chosen snapshot.
 *
 * Revert behavior:
 *   1. Load the target snapshot (must be from the same
 *      overlay_key/variant_id, not soft-deleted).
 *   2. Capture the CURRENT token map as a NEW history row — the revert
 *      is itself a save, so it's reversible. Reason text records which
 *      snapshot we reverted to for forensics.
 *   3. Upsert every token from the snapshot into
 *      `overlay_design_tokens`. Tokens NOT in the snapshot stay
 *      untouched (the snapshot is a positive set, not a "wipe to this"
 *      directive).
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §4.3
 */

export type HistorySnapshot = {
  id: string;
  overlayKey: string;
  variantId: string;
  snapshot: Record<string, string>;
  changedBy: string;
  reason: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  snapshot_json: Record<string, string>;
  changed_by: string;
  reason: string | null;
  created_at: string;
};

function toSnapshot(r: Row): HistorySnapshot {
  return {
    id: r.id,
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    snapshot: r.snapshot_json ?? {},
    changedBy: r.changed_by,
    reason: r.reason,
    createdAt: r.created_at,
  };
}

const SELECT_COLS =
  "id, overlay_key, variant_id, snapshot_json, changed_by, reason, created_at";

/**
 * List snapshots for the given overlay+variant in reverse-chronological
 * order. Limit defaults to 50 — enough for the timeline UI without
 * blowing context on a busy overlay. Excludes soft-deleted rows.
 */
export async function listHistory(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string,
  limit: number = 50,
): Promise<HistorySnapshot[]> {
  const { data, error } = await sb
    .from("overlay_design_history")
    .select(SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listHistory: ${error.message}`);
  return ((data ?? []) as Row[]).map(toSnapshot);
}

type DesignTokenRow = {
  overlay_key: string;
  variant_id: string;
  token_key: string;
  token_value: string;
  token_type: string;
};

/**
 * Restore tokens to a prior snapshot.
 *
 * Writes a NEW history row capturing the CURRENT state BEFORE
 * upserting, so the revert is itself revertible. Each upsert preserves
 * the existing `token_type` (we look it up from the live row) so we
 * don't have to encode types into the snapshot json.
 */
export async function revertToSnapshot(
  sb: SupabaseClient,
  actor: Actor,
  snapshotId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("revertToSnapshot: no actor.userId");

  // 1. Load the target snapshot.
  const { data: snapRow, error: snapErr } = await sb
    .from("overlay_design_history")
    .select(SELECT_COLS)
    .eq("id", snapshotId)
    .is("deleted_at", null)
    .maybeSingle();
  if (snapErr) throw new Error(`revertToSnapshot (load): ${snapErr.message}`);
  if (!snapRow) throw new Error(`revertToSnapshot: snapshot not found: ${snapshotId}`);
  const snap = toSnapshot(snapRow as Row);

  // 2. Capture the CURRENT token map for revertibility.
  const { data: liveRows, error: liveErr } = await sb
    .from("overlay_design_tokens")
    .select("token_key, token_value, token_type")
    .eq("overlay_key", snap.overlayKey)
    .eq("variant_id", snap.variantId)
    .is("deleted_at", null);
  if (liveErr) throw new Error(`revertToSnapshot (live read): ${liveErr.message}`);

  const liveByKey: Record<string, { value: string; type: string }> = {};
  for (const r of (liveRows ?? []) as Array<{
    token_key: string;
    token_value: string;
    token_type: string;
  }>) {
    liveByKey[r.token_key] = { value: r.token_value, type: r.token_type };
  }

  const currentSnapshot: Record<string, string> = {};
  for (const k of Object.keys(liveByKey)) {
    currentSnapshot[k] = liveByKey[k].value;
  }

  const { error: histErr } = await sb.from("overlay_design_history").insert({
    overlay_key: snap.overlayKey,
    variant_id: snap.variantId,
    snapshot_json: currentSnapshot,
    changed_by: actor.userId,
    reason: `revert to snapshot ${snapshotId}`,
  });
  if (histErr) {
    throw new Error(`revertToSnapshot (history insert): ${histErr.message}`);
  }

  // 3. Upsert every token from the snapshot. Token type comes from the
  //    live row when present; otherwise we infer 'string' (a follow-up
  //    DB read by the resolver will still produce the right CSS var
  //    string).
  const nowIso = new Date().toISOString();
  const upserts: DesignTokenRow[] = [];
  for (const k of Object.keys(snap.snapshot)) {
    upserts.push({
      overlay_key: snap.overlayKey,
      variant_id: snap.variantId,
      token_key: k,
      token_value: snap.snapshot[k],
      token_type: liveByKey[k]?.type ?? "string",
    });
  }

  if (upserts.length === 0) return;

  const rows = upserts.map((u) => ({
    ...u,
    set_by: actor.userId,
    set_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
  }));

  const { error: upsertErr } = await sb
    .from("overlay_design_tokens")
    .upsert(rows, { onConflict: "overlay_key,variant_id,token_key" });
  if (upsertErr) {
    throw new Error(`revertToSnapshot (upsert tokens): ${upsertErr.message}`);
  }
}
