import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRASH_ENTITIES,
  isTrashEntityType,
  type TrashEntityType,
} from "./entities";

export type ListDeletedResult = {
  rows: Array<Record<string, unknown>>;
  /**
   * True when the underlying table does not exist yet (Postgres 42P01).
   * UI shows a "Schema not yet migrated" empty state.
   */
  missingTable: boolean;
};

/**
 * List soft-deleted rows for the given whitelisted entity type.
 *
 * If the underlying table does not exist (Postgres error code 42P01), returns
 * { rows: [], missingTable: true } so the UI can show a friendly empty state
 * while other agents finish creating the table.
 */
export async function listDeleted(
  sb: SupabaseClient,
  entityType: string
): Promise<ListDeletedResult> {
  if (!isTrashEntityType(entityType)) {
    throw new Error(`unknown entity type: ${entityType}`);
  }
  const def = TRASH_ENTITIES[entityType as TrashEntityType];
  const { data, error } = await sb
    .from(def.table)
    .select(def.selectCols)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return { rows: [], missingTable: true };
    }
    throw error;
  }
  return {
    rows: (data ?? []) as unknown as Array<Record<string, unknown>>,
    missingTable: false,
  };
}

/**
 * Restore a soft-deleted row by clearing its deleted_at column.
 *
 * The audit trigger installed on every mutable table captures the restore
 * automatically via current_setting('app.current_user_id'). The caller is
 * responsible for setting that session GUC before invoking this (Server
 * Actions do so via the middleware/helpers); _actorUserId is accepted here so
 * the signature stays stable for future audit wiring and explicit logging.
 */
export async function restore(
  sb: SupabaseClient,
  entityType: string,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _actorUserId: string
): Promise<void> {
  if (!isTrashEntityType(entityType)) {
    throw new Error(`unknown entity type: ${entityType}`);
  }
  if (!id || id.trim() === "") {
    throw new Error("id required");
  }
  const def = TRASH_ENTITIES[entityType as TrashEntityType];
  const { error } = await sb
    .from(def.table)
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "42P01";
}
