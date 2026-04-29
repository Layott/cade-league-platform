import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { getDefaultsForOverlay } from "./defaults";

/**
 * Overlay Design System — token CRUD + resolver.
 *
 * Mutations gate on `overlay.design.manage` (admin / design / production
 * per migration `20260601000004_overlay_design_perm_seed.sql`). Reads
 * are unauthenticated at this layer — the SSR overlay route uses the
 * service-role client + the resolver to inject CSS variables.
 *
 * Every successful `setDesignToken` writes a snapshot row to
 * `overlay_design_history` BEFORE the upsert (ordering matters for
 * revert correctness — the history row captures the pre-mutation
 * state, so `revertToSnapshot(snapshotId)` restores the values that
 * existed BEFORE the change that produced `snapshotId`).
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §4.1
 */

export type TokenType =
  | "color"
  | "font"
  | "number"
  | "boolean"
  | "enum"
  | "string"
  | "image";

/**
 * Wrap an image URL into a CSS `url("...")` value, stripping the same
 * metacharacters the `decodePreviewTokens` schema rejects (`;{}<>"'`)
 * so a malformed token value can never break out of the variable
 * context. Returns the empty string when the input is empty so callers
 * can detect "no override, fall back to HTML default".
 *
 * Used by the iframe-side inline script (mirrored in JS) and by any
 * server-side code that needs to embed a stored image URL into a CSS
 * `:root` block. SSR doesn't actually wrap image tokens itself — the
 * raw URL passes through `escapeCssValue` and lands as the bare value
 * of `--overlay-bg-image`. The CONSUMER stylesheet inside each overlay
 * HTML is responsible for the `url(...)` framing via
 * `background-image: var(--overlay-bg-image, url(<fallback>))`.
 */
export function escapeUrl(value: string): string {
  if (!value) return "";
  const safe = value.replace(/[;{}<>"']/g, "");
  return `url("${safe}")`;
}

export type DesignToken = {
  overlayKey: string;
  variantId: string;
  tokenKey: string;
  tokenValue: string;
  tokenType: TokenType;
  setBy: string;
  setAt: string;
};

type Row = {
  overlay_key: string;
  variant_id: string;
  token_key: string;
  token_value: string;
  token_type: TokenType;
  set_by: string;
  set_at: string;
};

function toToken(r: Row): DesignToken {
  return {
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    tokenKey: r.token_key,
    tokenValue: r.token_value,
    tokenType: r.token_type,
    setBy: r.set_by,
    setAt: r.set_at,
  };
}

const SELECT_COLS =
  "overlay_key, variant_id, token_key, token_value, token_type, set_by, set_at";

/**
 * Read all DB-persisted tokens for a given overlay+variant. Returns a
 * map keyed by token_key for O(1) lookup. Defaults are NOT merged here
 * — callers that want effective values use `resolveTokens`.
 *
 * `variantId` defaults to `'default'` to match the seeded variants.
 */
export async function getDesignTokens(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<Record<string, DesignToken>> {
  const { data, error } = await sb
    .from("overlay_design_tokens")
    .select(SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null);
  if (error) throw new Error(`getDesignTokens: ${error.message}`);
  const out: Record<string, DesignToken> = {};
  for (const r of (data ?? []) as Row[]) {
    out[r.token_key] = toToken(r);
  }
  return out;
}

/**
 * Resolve EFFECTIVE tokens for an overlay+variant. Merges DB rows over
 * the hard-coded defaults from `defaults.ts`. Returns a flat
 * Record<tokenKey, tokenValue> ready to be injected as CSS variables.
 *
 * Unknown overlay keys fall back to BASE_DEFAULTS (no throw) so the
 * SSR route degrades gracefully. The resolver does NOT call
 * `requirePermAsync` — the SSR route owns the auth gate.
 */
export async function resolveTokens(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<Record<string, string>> {
  const defaults = getDefaultsForOverlay(overlayKey);
  const dbRows = await getDesignTokens(sb, overlayKey, variantId);
  const merged: Record<string, string> = { ...defaults };
  for (const k of Object.keys(dbRows)) {
    merged[k] = dbRows[k].tokenValue;
  }
  return merged;
}

/**
 * Persist a token override. Snapshots the prior FULL token map to
 * `overlay_design_history` BEFORE the upsert so revert is exact.
 *
 * Throws PermissionError if the actor lacks `overlay.design.manage`.
 */
export async function setDesignToken(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  tokenKey: string,
  tokenValue: string,
  tokenType: TokenType,
): Promise<DesignToken> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("setDesignToken: no actor.userId");

  // Snapshot the pre-mutation state. Failure here aborts the write so
  // the history ledger never lies about what happened.
  const priorTokens = await getDesignTokens(sb, overlayKey, variantId);
  const snapshot: Record<string, string> = {};
  for (const k of Object.keys(priorTokens)) {
    snapshot[k] = priorTokens[k].tokenValue;
  }
  const { error: histErr } = await sb.from("overlay_design_history").insert({
    overlay_key: overlayKey,
    variant_id: variantId,
    snapshot_json: snapshot,
    changed_by: actor.userId,
    reason: `set ${tokenKey}=${tokenValue}`,
  });
  if (histErr) {
    throw new Error(`setDesignToken history insert: ${histErr.message}`);
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("overlay_design_tokens")
    .upsert(
      {
        overlay_key: overlayKey,
        variant_id: variantId,
        token_key: tokenKey,
        token_value: tokenValue,
        token_type: tokenType,
        set_by: actor.userId,
        set_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "overlay_key,variant_id,token_key" },
    )
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(`setDesignToken upsert: ${error.message}`);
  return toToken(data as Row);
}

/**
 * Soft-delete the token row so the resolver falls back to the
 * hard-coded default. Snapshots the pre-clear state to history so the
 * clear is itself revertible.
 */
export async function clearDesignToken(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  tokenKey: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("clearDesignToken: no actor.userId");

  const priorTokens = await getDesignTokens(sb, overlayKey, variantId);
  const snapshot: Record<string, string> = {};
  for (const k of Object.keys(priorTokens)) {
    snapshot[k] = priorTokens[k].tokenValue;
  }
  const { error: histErr } = await sb.from("overlay_design_history").insert({
    overlay_key: overlayKey,
    variant_id: variantId,
    snapshot_json: snapshot,
    changed_by: actor.userId,
    reason: `clear ${tokenKey}`,
  });
  if (histErr) {
    throw new Error(`clearDesignToken history insert: ${histErr.message}`);
  }

  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_design_tokens")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("token_key", tokenKey)
    .is("deleted_at", null);
  if (error) throw new Error(`clearDesignToken: ${error.message}`);
}
