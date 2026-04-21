import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 14 — OCR usage ledger helpers.
 *
 * `ocr_usage_log` is append-only at the DB level (UPDATE + DELETE blocked by
 * trigger). Every `parse()` dispatch writes exactly one row so we can:
 *  - daily-cap spend before a new call fires (`sumSpendTodayCents`)
 *  - retro-audit engine mix + failure rate
 *  - expose a dashboard later without breaking immutability
 *
 * `claudeCostCents` implements the 2026-04 Opus 4.7 vision pricing from spec
 * §3.3: input $15/1M tokens, output $75/1M tokens, cached input nominally
 * 10× cheaper. Callers that pass cached-input tokens should reflect the
 * reduced cost in the costUsdCents they log — this helper is the "standard"
 * uncached formula used by `parse.claude.ts` for the first call of a run.
 */

export type Engine = "claude-opus-4-7" | "tesseract" | "manual" | "disabled";

export interface LogUsageRow {
  engine: Engine;
  inputTokens?: number;
  outputTokens?: number;
  costUsdCents: number;
  matchIdRef?: string;
  screenshotIdRef?: string;
  successBool: boolean;
  errorMessage?: string;
}

export async function logUsage(
  sb: SupabaseClient,
  row: LogUsageRow,
): Promise<void> {
  const { error } = await sb.from("ocr_usage_log").insert({
    engine: row.engine,
    input_tokens: row.inputTokens ?? null,
    output_tokens: row.outputTokens ?? null,
    cost_usd_cents: row.costUsdCents,
    match_id_ref: row.matchIdRef ?? null,
    screenshot_id_ref: row.screenshotIdRef ?? null,
    success_bool: row.successBool,
    error_message: row.errorMessage ?? null,
  });
  if (error) {
    // Do NOT throw — the caller's DB write path should proceed. The log is
    // best-effort; if it fails we surface via stderr so devops notices.
    console.error("[ocr_usage_log] insert failed:", error.message);
  }
}

/**
 * Sum of cost_usd_cents for rows logged today (in Africa/Lagos). Used by the
 * dispatcher pre-flight budget cap. Returns 0 when the query errors so a
 * ledger blip can't accidentally block all OCR.
 */
export async function sumSpendTodayCents(
  sb: SupabaseClient,
): Promise<number> {
  // Africa/Lagos is UTC+1 with no DST. Start-of-day in WAT = UTC day boundary
  // minus 1 hour. We compute it in JS rather than via SQL so the helper is
  // trivial to mock in unit tests.
  const now = new Date();
  const watOffsetMs = 60 * 60 * 1000; // +1h
  const watMillis = now.getTime() + watOffsetMs;
  const watDate = new Date(watMillis);
  const y = watDate.getUTCFullYear();
  const m = String(watDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(watDate.getUTCDate()).padStart(2, "0");
  const startOfDayWatAsUtc = new Date(
    `${y}-${m}-${d}T00:00:00+01:00`,
  ).toISOString();

  const { data, error } = await sb
    .from("ocr_usage_log")
    .select("cost_usd_cents")
    .gte("called_at", startOfDayWatAsUtc);
  if (error) {
    console.error("[ocr_usage_log] sum failed:", error.message);
    return 0;
  }
  return (data ?? []).reduce(
    (acc: number, r: { cost_usd_cents: number | null }) =>
      acc + (r.cost_usd_cents ?? 0),
    0,
  );
}

/**
 * 2026-04-21 Opus 4.7 vision pricing:
 *   input  $15 / 1,000,000 tokens  → 0.0015 ¢ / token
 *   output $75 / 1,000,000 tokens  → 0.0075 ¢ / token
 *
 * We ceil to the nearest cent (floor + 1 when remainder > 0) so we never
 * under-charge the budget cap. Tests assert exact results for known
 * token counts.
 *
 * claudeCostCents(1500, 500)
 *   = ceil(1500 * 0.0015 + 500 * 0.0075)
 *   = ceil(2.25 + 3.75)
 *   = ceil(6.00) = 6
 */
export function claudeCostCents(
  inputTokens: number,
  outputTokens: number,
): number {
  const cents = inputTokens * 0.0015 + outputTokens * 0.0075;
  // Avoid floating-point drift: round at 4 decimal places, then ceil to int.
  const rounded = Math.round(cents * 10000) / 10000;
  return Math.ceil(rounded);
}
