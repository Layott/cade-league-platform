// Plan 14 — stats_ocr public re-export surface.
//
// API consumers (route handlers, server actions) import from here, not from
// individual files, so we can refactor internals without route-level churn.

export {
  parsedMatchStatsSchema,
  parsedStatsBlockSchema,
  uploadInputSchema,
  reviewInputSchema,
  rejectInputSchema,
  emptyParsedMatchStats,
  emptyStatsBlock,
} from "./schemas";
export type {
  ParsedMatchStats,
  ParsedStatsBlock,
  UploadInput,
  ReviewInput,
  RejectInput,
} from "./schemas";

export {
  createSignedUpload,
  createSignedRead,
  downloadBuffer,
  buildStoragePath,
  extForMime,
  BUCKET,
} from "./storage";
export type { MimeType, SignedUpload } from "./storage";

export {
  parse,
  BudgetExceededError,
  getDailyCapCents,
} from "./parse";
export type { ParseOutcome, ParseOptions } from "./parse";

export {
  parseWithClaude,
  getAnthropicClient,
  ParseShapeError,
  CLAUDE_MODEL,
  CLAUDE_MAX_TOKENS,
  CLAUDE_TEMPERATURE,
  CLAUDE_SYSTEM_PROMPT,
} from "./parse.claude";
export type { ClaudeParseResult, AnthropicLike } from "./parse.claude";

export {
  parseWithTesseract,
  STAT_REGIONS,
  parseIntOrNull,
  parsePercentOrNull,
} from "./parse.tesseract";
export type { TesseractParseResult, TesseractLike } from "./parse.tesseract";

export {
  applyReview,
  rejectReview,
  ConflictError,
  ValidationError,
} from "./review";
export type { ApplyReviewResult } from "./review";

export { logUsage, sumSpendTodayCents, claudeCostCents } from "./usage";
export type { Engine, LogUsageRow } from "./usage";
