/**
 * Plan 24 — nightly catalogue refresh orchestrator.
 *
 * Tries the configured sources in strict order: kaggle → futdb → sofifa.
 * First source that returns rows wins; the rest are not called. On all-
 * sources-failed the function STILL writes a log row (source='none' +
 * error text describing what each source said) so operators can tell
 * "cron fired + every source is broken" from "cron didn't fire".
 *
 * Never throws — the cron route is guaranteed to return 200 with
 * diagnostic JSON so Vercel's cron retry logic doesn't loop on transient
 * upstream errors.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { tryKaggleRefresh } from "./sources/kaggle";
import { fetchFutdb } from "./sources/futdb";
import { fetchSofifa } from "./sources/sofifa";
import type { NormalizedFCRow, SourceResult } from "./sources/types";

export type RefreshResult = {
  source: "kaggle" | "futdb" | "sofifa" | "none";
  rows_upserted: number;
  rows_failed: number;
  duration_ms: number;
  error?: string;
};

export type RefreshOptions = {
  /** For tests: override the source order / wrappers. */
  sources?: Array<() => Promise<SourceResult>>;
  /** For tests: override the wall clock. */
  now?: () => number;
};

/**
 * Try each source in order until one returns a non-empty, non-skipped
 * result. Returns either:
 *   - `{ result: SourceResult }` on success (first source with rows), OR
 *   - `{ errors }` if every source was skipped or threw. Each error
 *     string is prefixed with the source name so the log row can
 *     distinguish "kaggle: token missing" from "futdb: HTTP 429".
 */
async function runSourcesInOrder(
  sources: Array<() => Promise<SourceResult>>,
): Promise<{ result?: SourceResult; errors: string[] }> {
  const errors: string[] = [];
  for (const fn of sources) {
    try {
      const r = await fn();
      if (r.skipped) {
        errors.push(`${r.source}: ${r.reason}`);
        continue;
      }
      if (!Array.isArray(r.rows) || r.rows.length === 0) {
        errors.push(`${r.source}: returned 0 rows`);
        continue;
      }
      return { result: r, errors };
    } catch (e) {
      errors.push(`unknown: ${(e as Error).message}`);
    }
  }
  return { errors };
}

/**
 * Upsert rows into `public.fc26_players` via the
 * (source_dataset, source_row_id) unique index. We chunk to keep any one
 * request under the Supabase / PostgREST body-size comfort zone.
 */
async function upsertRows(
  sb: SupabaseClient,
  rows: NormalizedFCRow[],
): Promise<{ upserted: number; failed: number; firstError?: string }> {
  if (rows.length === 0) return { upserted: 0, failed: 0 };
  const CHUNK = 200;
  let upserted = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      ...r,
      // `attributes` is a jsonb column — Supabase client will serialize
      // plain objects automatically, so pass as-is (not stringified).
      attributes: r.attributes,
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb
      .from("fc26_players")
      .upsert(chunk, { onConflict: "source_dataset,source_row_id" });
    if (error) {
      failed += chunk.length;
      if (!firstError) firstError = error.message;
    } else {
      upserted += chunk.length;
    }
  }
  return { upserted, failed, firstError };
}

/**
 * Insert a row into fc26_refresh_log. Swallows errors (best-effort): if
 * the log insert itself fails, we still want the route to return 200 with
 * the actual refresh result.
 */
async function writeLog(
  sb: SupabaseClient,
  row: {
    source: RefreshResult["source"];
    rows_upserted: number;
    rows_failed: number;
    duration_ms: number;
    error?: string | null;
  },
): Promise<{ logged: boolean; error?: string }> {
  const { error } = await sb.from("fc26_refresh_log").insert({
    source: row.source,
    rows_upserted: row.rows_upserted,
    rows_failed: row.rows_failed,
    duration_ms: row.duration_ms,
    error: row.error ?? null,
  });
  if (error) return { logged: false, error: error.message };
  return { logged: true };
}

/**
 * Orchestrate one refresh run. Never throws.
 */
export async function refresh(
  sb: SupabaseClient,
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const sources =
    opts.sources ??
    ([
      () => tryKaggleRefresh(),
      () => fetchFutdb(),
      () => fetchSofifa(),
    ] as Array<() => Promise<SourceResult>>);

  const { result, errors } = await runSourcesInOrder(sources);

  if (!result) {
    const duration_ms = Math.max(0, now() - startedAt);
    const errorText = errors.length ? errors.join("; ") : "no sources available";
    await writeLog(sb, {
      source: "none",
      rows_upserted: 0,
      rows_failed: 0,
      duration_ms,
      error: errorText,
    });
    return {
      source: "none",
      rows_upserted: 0,
      rows_failed: 0,
      duration_ms,
      error: errorText,
    };
  }

  // Type narrow: result is not a skipped branch at this point.
  const rows = (result as { rows: NormalizedFCRow[] }).rows;
  const upsertOut = await upsertRows(sb, rows);
  const duration_ms = Math.max(0, now() - startedAt);
  const error =
    upsertOut.firstError ??
    (errors.length ? `[soft] ${errors.join("; ")}` : undefined);

  await writeLog(sb, {
    source: result.source,
    rows_upserted: upsertOut.upserted,
    rows_failed: upsertOut.failed,
    duration_ms,
    error,
  });

  return {
    source: result.source,
    rows_upserted: upsertOut.upserted,
    rows_failed: upsertOut.failed,
    duration_ms,
    error,
  };
}
