import type { SupabaseClient } from "@supabase/supabase-js";
import { logUsage, sumSpendTodayCents, claudeCostCents } from "./usage";
import {
  parseWithClaude,
  ParseShapeError,
  type AnthropicLike,
  getAnthropicClient,
} from "./parse.claude";
import {
  parseWithTesseract,
  type TesseractLike,
} from "./parse.tesseract";
import { type ParsedMatchStats } from "./schemas";

/**
 * Plan 14 — OCR dispatcher.
 *
 * Order of checks (short-circuit on first win):
 *  1. OCR_DISABLED=1 → { status: 'disabled' }, no log, no cost. Admin
 *     hand-enters via the review page (`parsed_by_engine='manual'`).
 *  2. ANTHROPIC_API_KEY set → budget cap check → Claude vision path.
 *  3. Tesseract fallback (dev only).
 *  4. Nothing viable → 'failed'.
 */

export type ParseOutcome =
  | {
      status: "parsed";
      engine: "claude-opus-4-7" | "tesseract";
      parsed: ParsedMatchStats;
    }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

export class BudgetExceededError extends Error {
  constructor(
    public readonly spentCents: number,
    public readonly capCents: number,
  ) {
    super(
      `OCR daily budget exceeded: ${spentCents} / ${capCents} USD cents`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface ParseOptions {
  screenshotId: string;
  matchId: string;
  imageBuffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  // Injected in tests — prod uses defaults.
  anthropicClient?: AnthropicLike;
  tesseractClient?: TesseractLike;
}

export function getDailyCapCents(): number {
  const raw = process.env.OCR_DAILY_CAP_USD_CENTS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 100; // default $1/day
}

export async function parse(
  sb: SupabaseClient,
  opts: ParseOptions,
): Promise<ParseOutcome> {
  // 1. Kill switch.
  if (process.env.OCR_DISABLED === "1") {
    return { status: "disabled" };
  }

  // 2. Claude vision path — budget-cap first.
  if (process.env.ANTHROPIC_API_KEY) {
    const cap = getDailyCapCents();
    const spent = await sumSpendTodayCents(sb);
    // Worst-case estimate: a cold-start call (~5¢). If adding that to today's
    // spend would exceed cap, refuse.
    const WORST_CASE_CENTS = 5;
    if (spent + WORST_CASE_CENTS > cap) {
      await logUsage(sb, {
        engine: "claude-opus-4-7",
        costUsdCents: 0,
        successBool: false,
        matchIdRef: opts.matchId,
        screenshotIdRef: opts.screenshotId,
        errorMessage: `budget cap hit: ${spent}/${cap} cents`,
      });
      throw new BudgetExceededError(spent, cap);
    }

    // The real Anthropic SDK has a strongly-typed `messages.create`
    // overload set; our `AnthropicLike` is an intentionally narrower surface
    // for mocking. Cast through `unknown` to bridge the two.
    const client: AnthropicLike =
      opts.anthropicClient ?? (getAnthropicClient() as unknown as AnthropicLike);
    try {
      const imageBase64 = opts.imageBuffer.toString("base64");
      const result = await parseWithClaude(
        client,
        imageBase64,
        opts.mimeType,
      );
      const cost = claudeCostCents(result.inputTokens, result.outputTokens);
      await logUsage(sb, {
        engine: "claude-opus-4-7",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsdCents: cost,
        successBool: true,
        matchIdRef: opts.matchId,
        screenshotIdRef: opts.screenshotId,
      });
      return {
        status: "parsed",
        engine: "claude-opus-4-7",
        parsed: result.parsed,
      };
    } catch (err) {
      const msg =
        err instanceof ParseShapeError
          ? `shape: ${err.message}`
          : (err as Error).message;
      await logUsage(sb, {
        engine: "claude-opus-4-7",
        costUsdCents: 0,
        successBool: false,
        matchIdRef: opts.matchId,
        screenshotIdRef: opts.screenshotId,
        errorMessage: msg,
      });
      return { status: "failed", reason: msg };
    }
  }

  // 3. Tesseract fallback (dev).
  if (opts.tesseractClient) {
    try {
      const result = await parseWithTesseract(
        opts.tesseractClient,
        opts.imageBuffer,
      );
      await logUsage(sb, {
        engine: "tesseract",
        costUsdCents: 0,
        successBool: true,
        matchIdRef: opts.matchId,
        screenshotIdRef: opts.screenshotId,
      });
      return {
        status: "parsed",
        engine: "tesseract",
        parsed: result.parsed,
      };
    } catch (err) {
      const msg = (err as Error).message;
      await logUsage(sb, {
        engine: "tesseract",
        costUsdCents: 0,
        successBool: false,
        matchIdRef: opts.matchId,
        screenshotIdRef: opts.screenshotId,
        errorMessage: msg,
      });
      return { status: "failed", reason: msg };
    }
  }

  // 4. Nothing configured.
  await logUsage(sb, {
    engine: "manual",
    costUsdCents: 0,
    successBool: false,
    matchIdRef: opts.matchId,
    screenshotIdRef: opts.screenshotId,
    errorMessage: "no engine configured",
  });
  return {
    status: "failed",
    reason: "no OCR engine configured",
  };
}
