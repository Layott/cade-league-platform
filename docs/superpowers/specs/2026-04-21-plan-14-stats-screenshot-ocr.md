# Plan 14 — Match stats screenshot OCR pipeline

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Depends on:** Plan 3 (matches + `player_match_stats` table), Plan 9 (DB-backed role matrix + `requirePermAsync`), Plan 10 (private Supabase-Storage + signed-URL pattern), Plan 13 (append-only ledger trigger pattern reused for `ocr_usage_log`)
**Supersedes:** nothing. Net-new capability on top of `player_match_stats`.

---

## 1. Goal + Success Criteria

### 1.1 Goal
Admins paste eFootball/FUT end-of-match stat screenshots into the admin match-day detail. A multimodal parser (Claude Opus 4.7 vision, Tesseract dev fallback) turns the image into structured per-player stats. Nothing writes to `player_match_stats` until a human in the admin UI confirms the parse against the original image side-by-side. Standings are untouched (`match_results` remains the source of truth); only enrichment happens here.

### 1.2 Success criteria (must all demo end-to-end locally)
1. **Upload + parse.** An admin on `/admin/match-days/[id]/stats-upload` attaches a PNG, it hits private bucket `match-stat-screenshots`, the server dispatches `parse()`, `parse_status` flips `pending → parsing → parsed`, `parsed_json` is populated, and a row lands in `ocr_usage_log` with correct token + cost cents.
2. **Review & confirm.** From the same screen the admin opens `/admin/match-days/[id]/stats-upload/[screenshotId]/review`, sees the signed-URL image beside an editable form, corrects one field, clicks `Confirm & write stats`. `player_match_stats` rows appear for both players, `match_stat_screenshots.parse_status='confirmed'`, `confirmed_by`+`confirmed_at` set, audit trigger fires.
3. **Reject path.** Re-uploading, opening review, clicking `Reject` with reason flips status to `rejected`, writes nothing to `player_match_stats`, keeps the original screenshot around for soft-delete.
4. **Kill switch.** With `OCR_DISABLED=1` in env, upload is accepted but `parse()` returns `{ status: 'disabled' }`, `parse_status='pending'`, and the review page shows a manual-entry banner; admin can type stats by hand and `parsed_by_engine='manual'` on confirm.
5. **Public surface.** `/players/[id]` renders a new "Recent match stats" card populated only from `player_match_stats` rows whose originating `match_stat_screenshots` has `parse_status='confirmed'`. Unreviewed OCR never leaks.

---

## 2. Data Model + Migrations

All new tables carry `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `deleted_at TIMESTAMPTZ NULL`, and end with `select public.attach_audit('public.<table>');` unless explicitly append-only.

Migration numbering: monotonic continuation of `20260428000003_role_permissions_seed.sql`. Plan 14's slot is `20260504000001..000004`.

### 2.1 `match_stat_screenshots`

Migration `20260504000001_match_stat_screenshots.sql`:

```sql
create table public.match_stat_screenshots (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid not null references public.matches (id) on delete cascade,
  storage_path        text not null,
  uploaded_by         uuid not null references public.users (id),
  uploaded_at         timestamptz not null default now(),
  parse_status        text not null default 'pending'
                      check (parse_status in
                        ('pending','parsing','parsed','failed','confirmed','rejected')),
  parsed_json         jsonb,
  parsed_at           timestamptz,
  parsed_by_engine    text check (parsed_by_engine in
                        ('claude-opus-4-7','tesseract','manual')),
  confirmed_by        uuid references public.users (id),
  confirmed_at        timestamptz,
  rejection_reason    text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index match_stat_screenshots_match_idx
  on public.match_stat_screenshots (match_id)
  where deleted_at is null;

create index match_stat_screenshots_status_idx
  on public.match_stat_screenshots (parse_status, match_id)
  where deleted_at is null;

select public.attach_audit('public.match_stat_screenshots');
```

No RLS (consistent with other business tables in Phase 1A/1B).

### 2.2 `ocr_usage_log` (append-only)

Migration `20260504000002_ocr_usage_log.sql`. Mirrors the `caution_ledger_entries` append-only trigger pattern from Plan 13: immutable after insert.

```sql
create table public.ocr_usage_log (
  id                  uuid primary key default gen_random_uuid(),
  called_at           timestamptz not null default now(),
  engine              text not null check (engine in
                        ('claude-opus-4-7','tesseract','manual','disabled')),
  input_tokens        int,
  output_tokens       int,
  cost_usd_cents      int not null default 0 check (cost_usd_cents >= 0),
  match_id_ref        uuid references public.matches (id),
  screenshot_id_ref   uuid references public.match_stat_screenshots (id),
  success_bool        boolean not null default false,
  error_message       text,
  created_at          timestamptz not null default now()
);

create index ocr_usage_log_called_at_idx
  on public.ocr_usage_log (called_at desc);

create index ocr_usage_log_engine_idx
  on public.ocr_usage_log (engine, called_at desc);

-- Append-only: block UPDATE + DELETE. Insert-and-forget.
create or replace function public.ocr_usage_log_block_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ocr_usage_log is append-only';
end;
$$;

create trigger ocr_usage_log_no_update
  before update on public.ocr_usage_log
  for each row execute function public.ocr_usage_log_block_mutations();

create trigger ocr_usage_log_no_delete
  before delete on public.ocr_usage_log
  for each row execute function public.ocr_usage_log_block_mutations();

-- NOTE: we intentionally do NOT call public.attach_audit here.
-- Append-only already is the audit — double-logging wastes rows.
```

### 2.3 Storage bucket

Migration `20260504000003_storage_match_stat_screenshots_bucket.sql`:

```sql
insert into storage.buckets (id, name, public)
values ('match-stat-screenshots', 'match-stat-screenshots', false)
on conflict (id) do nothing;
-- Access is server-side via service role. No policies in Phase 1B.
```

### 2.4 `player_match_stats` — NO schema change

Plan 3's table (`20260423000004_player_match_stats.sql`) is sufficient. OCR writes into existing columns (`goals`, `assists`, `clean_sheet`) plus the open `custom_metrics JSONB` slot for possession/shots/passes/etc. `review.applyReview` is the only writer added by this plan.

Migration `20260504000004_audit_smoke_stats_ocr.sql` (optional, pure additive): appends `match_stat_screenshots` smoke assertions to `supabase/tests/audit_smoke.sql` — tracked as a file edit, not a new SQL migration. Ignored if empty.

Verification after `npm run db:push`: `npx supabase db query --linked --file - < 'select table_name from information_schema.tables where table_name in (''match_stat_screenshots'',''ocr_usage_log'');'` must return both rows.

---

## 3. OCR Engine Rationale + Cost Model

### 3.1 Engine selection

| Env state | Engine used | Rationale |
|---|---|---|
| `process.env.OCR_DISABLED === '1'` | none (kill switch) | Emergency escape. Returns `{ status: 'disabled' }`. Admin hand-enters. |
| `process.env.ANTHROPIC_API_KEY` set | `claude-opus-4-7` vision | Production path. Handles photo-grade screenshots, multi-column UIs, icon-glyph stats. Prompt caching cuts cost on repeat uploads. |
| No Anthropic key, Tesseract available | `tesseract` via `node-tesseract-ocr` (binary at `C:\Program Files\Tesseract-OCR\tesseract.exe`) | Dev fallback. Works on clean crops, degrades on colored UI chrome. |
| Neither | `parse_status='failed'`, admin must hand-enter | Graceful degrade. |

### 3.2 Claude call shape

- Model: `claude-opus-4-7` (`claude-opus-4-7[1m]` ID; `@anthropic-ai/sdk` default).
- Input: `[{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: <base64> } }, { type: 'text', text: <user prompt> }]`.
- System prompt: long (§5.1) — mark `cache_control: { type: 'ephemeral' }` so it caches across matches.
- Temperature `0`. `max_tokens: 2000`. No streaming.
- Output constraint: model returns ONLY the JSON object. `parse.claude.ts` runs `JSON.parse` defensively; on failure it retries once with an explicit "you returned invalid JSON, emit ONLY the JSON object" nudge (still cached prompt).

### 3.3 Cost model

Target: ~3¢/screenshot at cache-hit steady state. Token budget (Opus 4.7 vision, 2026 pricing as of `2026-04-21`):

- Input image: ~1500 tokens (single ~1920×1080 PNG).
- System prompt cached: ~1200 tokens on first call, ~120 tokens on subsequent (10× cache discount).
- User text: ~40 tokens.
- Output: ~400-600 tokens (compact JSON).
- Approximate cost (USD cents, steady state): 2-3¢/call. Cold start: ~5¢.

`usage.logUsage` stores `input_tokens`, `output_tokens`, `cost_usd_cents` per call. `parse.ts` enforces `OCR_DAILY_CAP_USD_CENTS` (default `100` = $1/day) by running `select coalesce(sum(cost_usd_cents),0) from ocr_usage_log where called_at >= date_trunc('day', now() at time zone 'Africa/Lagos')` BEFORE dispatching; cap hit → throw `BudgetExceededError`, `parse_status='failed'`, admin notified.

### 3.4 Tesseract fallback shape

- `node-tesseract-ocr` with `config = { lang: 'eng', oem: 1, psm: 6, binary: 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe' }`.
- Optional region crops declared as a config const (`STAT_REGIONS`: possession %, shots block, passes block, etc.). Dev-only heuristic — Opus 4.7 handles full image without crops in prod.
- Returns best-effort JSON conforming to `ParsedMatchStats`; fields it can't read come back `null` (never guessed).

---

## 4. Server Modules

### 4.1 File tree

All new server code lives in `apps/web/src/server/stats_ocr/`, mirroring `apps/web/src/server/squads/`:

```
apps/web/src/server/stats_ocr/
  index.ts                 # re-export surface
  schemas.ts               # Zod: ParsedMatchStats, UploadInput, ReviewInput, RejectInput
  schemas.test.ts          # round-trip + strictness tests
  storage.ts               # signed upload + signed read (mirrors squads/storage.ts)
  storage.test.ts
  parse.claude.ts          # Anthropic SDK wrapper, prompt caching, JSON retry
  parse.claude.test.ts     # mocks @anthropic-ai/sdk client
  parse.tesseract.ts       # node-tesseract-ocr wrapper with region crops
  parse.tesseract.test.ts  # mocks tesseract exec
  parse.ts                 # dispatcher: env switch, budget cap, usage logging
  parse.test.ts            # dispatcher env + disabled + budget-cap tests
  review.ts                # applyReview (idempotent), rejectReview
  review.test.ts
  usage.ts                 # logUsage (append-only insert)
  usage.test.ts
```

Route handlers + server actions remain thin. All Supabase access lives under `src/server/stats_ocr/`.

### 4.2 `schemas.ts` (Zod sketch)

```ts
import { z } from "zod";

export const parsedStatsBlockSchema = z.object({
  possessionPct:    z.number().int().min(0).max(100).nullable(),
  shots:            z.number().int().min(0).nullable(),
  shotsOnTarget:    z.number().int().min(0).nullable(),
  passes:           z.number().int().min(0).nullable(),
  passAccuracyPct:  z.number().int().min(0).max(100).nullable(),
  tackles:          z.number().int().min(0).nullable(),
  interceptions:    z.number().int().min(0).nullable(),
  fouls:            z.number().int().min(0).nullable(),
  ballRecoveries:   z.number().int().min(0).nullable(),
  goals:            z.number().int().min(0).nullable(),
  assists:          z.number().int().min(0).nullable(),
});

export const parsedMatchStatsSchema = z.object({
  homePlayerDisplayName: z.string().min(1).max(80).nullable(),
  awayPlayerDisplayName: z.string().min(1).max(80).nullable(),
  homeScore:             z.number().int().min(0).nullable(),
  awayScore:             z.number().int().min(0).nullable(),
  homeStats:             parsedStatsBlockSchema,
  awayStats:             parsedStatsBlockSchema,
  sourceNotes:           z.string().default(""),
});
export type ParsedMatchStats = z.infer<typeof parsedMatchStatsSchema>;

export const uploadInputSchema = z.object({
  matchId:      z.string().uuid(),
  storagePath:  z.string().min(1),
  fileSizeBytes:z.number().int().min(1).max(10 * 1024 * 1024), // 10 MB hard cap
  mimeType:     z.enum(["image/png", "image/jpeg", "image/webp"]),
});

export const reviewInputSchema = z.object({
  screenshotId: z.string().uuid(),
  correctedJson: parsedMatchStatsSchema,
  homePlayerId:  z.string().uuid(),   // admin resolves parsed names to player UUIDs
  awayPlayerId:  z.string().uuid(),
});

export const rejectInputSchema = z.object({
  screenshotId: z.string().uuid(),
  reason:       z.string().min(3).max(500),
});
```

Cross-field rules: `correctedJson.homeScore` + `awayScore` must not contradict an already-confirmed `match_results` row — cross-check in `review.applyReview`, not the schema.

### 4.3 `storage.ts`

Shape mirrors `apps/web/src/server/squads/storage.ts`. Bucket `match-stat-screenshots`, path layout:

```
matches/{matchId}/{screenshotId}.{png|jpg|webp}
```

Exports:

- `createSignedUpload(sb, matchId: string, screenshotId: string, mimeType: string): Promise<{ url: string; token: string; path: string }>`.
- `createSignedRead(sb, path: string, ttlSeconds = 300): Promise<string>`.
- Never returns the bucket handle to the client.

### 4.4 `parse.claude.ts`

```ts
import Anthropic from "@anthropic-ai/sdk";
import { parsedMatchStatsSchema, type ParsedMatchStats } from "./schemas";

const MODEL = "claude-opus-4-7";

export interface ClaudeParseResult {
  engine: "claude-opus-4-7";
  parsed: ParsedMatchStats;
  inputTokens: number;
  outputTokens: number;
}

export async function parseWithClaude(
  client: Anthropic,
  imageBase64: string,
  mimeType: "image/png" | "image/jpeg" | "image/webp"
): Promise<ClaudeParseResult> {
  // System prompt from §5.1; flagged cache_control ephemeral.
  // One retry on JSON.parse failure, same prompt + a short correction nudge.
  // Zod parse — on Zod failure, throw ParseShapeError (dispatcher decides what
  // to do: mark failed + notify).
}
```

Constructor takes a pre-built `Anthropic` client so tests mock it trivially (new in `parse.claude.test.ts`: fake client returning `content: [{ type: 'text', text: '{ "homePlayerDisplayName": ...' }]`).

### 4.5 `parse.tesseract.ts`

```ts
import tesseract from "node-tesseract-ocr";
import { type ParsedMatchStats } from "./schemas";

export const STAT_REGIONS = {
  // x,y,w,h in normalized 0..1 coords against the screenshot.
  possessionHome: { x: 0.32, y: 0.38, w: 0.1, h: 0.05 },
  possessionAway: { x: 0.58, y: 0.38, w: 0.1, h: 0.05 },
  // ...etc.
} as const;

export async function parseWithTesseract(
  imageBuffer: Buffer
): Promise<{ engine: "tesseract"; parsed: ParsedMatchStats }> {
  // Optional per-region crops via sharp; heuristic text → number parsing.
  // Unparsed fields → null. No guessing.
}
```

### 4.6 `parse.ts` (dispatcher)

```ts
import { type SupabaseClient } from "@supabase/supabase-js";
import { logUsage } from "./usage";

export type ParseOutcome =
  | { status: "parsed"; engine: "claude-opus-4-7" | "tesseract"; parsed: ParsedMatchStats }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

export class BudgetExceededError extends Error {
  constructor(public readonly spentCents: number, public readonly capCents: number) {
    super(`OCR daily budget exceeded: ${spentCents}¢ / ${capCents}¢`);
  }
}

export async function parse(
  sb: SupabaseClient,
  opts: {
    screenshotId: string;
    matchId: string;
    imageBuffer: Buffer;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  }
): Promise<ParseOutcome> {
  // 1. OCR_DISABLED=1 → return { status: 'disabled' } immediately (no log).
  // 2. ANTHROPIC_API_KEY → check daily spend via ocr_usage_log, throw
  //    BudgetExceededError if cap hit, else call parseWithClaude, log usage.
  // 3. Else → parseWithTesseract, log usage with cost 0.
  // 4. Zod-validate returned ParsedMatchStats. Invalid → status 'failed'.
}
```

### 4.7 `review.ts`

```ts
export async function applyReview(
  sb: SupabaseClient,
  actorUserId: string,
  input: ReviewInput
): Promise<{ screenshotId: string; writtenRowCount: number }> {
  // 1. Load screenshot. Must be parse_status='parsed' OR 'pending' (manual).
  // 2. Idempotent upsert into player_match_stats for (matchId, homePlayerId):
  //    goals, assists, clean_sheet (computed: opponent goals === 0),
  //    custom_metrics = { possessionPct, shots, shotsOnTarget, passes,
  //                        passAccuracyPct, tackles, interceptions, fouls,
  //                        ballRecoveries }.
  //    Same for awayPlayerId. ON CONFLICT (match_id, player_id) DO UPDATE SET ...
  // 3. Flip screenshot: parse_status='confirmed', confirmed_by, confirmed_at,
  //    parsed_by_engine='manual' if admin never triggered an engine parse.
  // 4. Return count (always 2 unless one side NULL — then fewer).
  // 5. NEVER call recompute_standings. Standings depend on match_results.
}

export async function rejectReview(
  sb: SupabaseClient,
  actorUserId: string,
  input: RejectInput
): Promise<void> {
  // parse_status='rejected', rejection_reason=input.reason. No player_match_stats write.
}
```

Idempotency: calling `applyReview` twice with the same input produces one `player_match_stats` row per player (upsert). The screenshot flip itself is idempotent.

### 4.8 `usage.ts`

```ts
export async function logUsage(
  sb: SupabaseClient,
  row: {
    engine: "claude-opus-4-7" | "tesseract" | "manual" | "disabled";
    inputTokens?: number;
    outputTokens?: number;
    costUsdCents: number;
    matchIdRef?: string;
    screenshotIdRef?: string;
    successBool: boolean;
    errorMessage?: string;
  }
): Promise<void> {
  // insert into ocr_usage_log. Append-only; no update/delete path.
}

export function claudeCostCents(inputTokens: number, outputTokens: number): number {
  // 2026-04 Opus 4.7 pricing: input $15/1M, output $75/1M; cached input $1.5/1M.
  // Conservative est (non-cached): ceil((input * 0.0015 + output * 0.0075) * 100).
  // Tests assert exact number for known token counts.
}
```

### 4.9 `index.ts`

Re-exports public surface: `parse`, `BudgetExceededError`, `applyReview`, `rejectReview`, `logUsage`, schemas + types. Error classes follow the `squads/index.ts` pattern (`ConflictError`, `ValidationError`, `PermissionError`).

---

## 5. Claude System Prompt

### 5.1 Full prompt text (copy verbatim into `parse.claude.ts`)

```
You are a specialized extraction agent for eFootball and FIFA Ultimate Team (FUT) end-of-match stat screenshots. Your only job is to read the image and return a JSON object conforming to the schema below. You NEVER write prose, markdown, apology, or explanation. You output ONE JSON object and nothing else.

Schema (all numeric fields are integers; all may be null if unreadable):

{
  "homePlayerDisplayName": string | null,   // the left/home side gamer-tag or display name shown above the stats
  "awayPlayerDisplayName": string | null,   // the right/away side gamer-tag or display name
  "homeScore": int | null,                   // the final score for home (e.g. the '2' in '2 - 1')
  "awayScore": int | null,
  "homeStats": {
    "possessionPct":    int 0..100 | null,
    "shots":            int >=0    | null,
    "shotsOnTarget":    int >=0    | null,
    "passes":           int >=0    | null,
    "passAccuracyPct":  int 0..100 | null,
    "tackles":          int >=0    | null,
    "interceptions":    int >=0    | null,
    "fouls":            int >=0    | null,
    "ballRecoveries":   int >=0    | null,
    "goals":            int >=0    | null,
    "assists":          int >=0    | null
  },
  "awayStats": { ...same shape as homeStats... },
  "sourceNotes": string   // short free-text: which fields you could not read and why (e.g. "cut off by overlay"). Empty string if all fields read cleanly.
}

Extraction hints:

- "Possession %" is usually rendered as two numbers summing to ~100 below a horizontal bar. Extract each side separately.
- "Shots" and "Shots on target" are commonly stacked; read carefully — on-target <= total.
- "Pass accuracy" is a percentage (0..100). "Passes" is the absolute count.
- "Tackles", "Interceptions", "Fouls", "Ball recoveries" may appear in a secondary stats block or collapsed panel. If not shown, emit null.
- "Goals" and "Assists" usually come from the scorer ticker / goal log. Goals for a side = that side's final score unless overtime/penalty shootout details differ. Assists come from the per-goal subtitle ("ASSIST: <name>"). Count them per side.
- Player display names appear above each team's stat column. Use the exact on-screen text. Strip trailing badges/icons.
- If a field is unreadable — overlay, glare, crop, motion-blur, any reason — emit null. DO NOT guess. DO NOT estimate. DO NOT round. DO NOT fabricate.
- If the screenshot is NOT an end-of-match stat screen (e.g. it's a lobby, menu, career-mode overlay), set every stat field to null, set sourceNotes to "not a stat screen", and set score + names to whatever is legibly visible (or null).

Output constraint: ONLY the JSON object. No prose. No code fence. No markdown. First character MUST be `{`. Last character MUST be `}`.

Few-shot example:

[IMAGE: End-of-match screen. Left side "NUNUSWAGGER" beat right side "LAYO_KING" 3-1. Possession: 54% / 46%. Shots: 11/4. Shots on target: 7/2. Passes: 412/287. Pass accuracy: 89%/83%. Tackles: 9/14. Interceptions: 5/8. Fouls: 4/3. Ball recoveries: 22/18. Goals from ticker: NUNUSWAGGER scored at 23' (assist: —), 41' (assist: —), 76' (assist: —); LAYO_KING scored at 58' (assist: —).]

{
  "homePlayerDisplayName": "NUNUSWAGGER",
  "awayPlayerDisplayName": "LAYO_KING",
  "homeScore": 3,
  "awayScore": 1,
  "homeStats": {
    "possessionPct": 54, "shots": 11, "shotsOnTarget": 7, "passes": 412,
    "passAccuracyPct": 89, "tackles": 9, "interceptions": 5, "fouls": 4,
    "ballRecoveries": 22, "goals": 3, "assists": 0
  },
  "awayStats": {
    "possessionPct": 46, "shots": 4, "shotsOnTarget": 2, "passes": 287,
    "passAccuracyPct": 83, "tackles": 14, "interceptions": 8, "fouls": 3,
    "ballRecoveries": 18, "goals": 1, "assists": 0
  },
  "sourceNotes": ""
}

Remember: ONLY the JSON. Temperature 0. First char `{`, last char `}`.
```

### 5.2 User-turn content

```
[{ type: "image", source: { type: "base64", media_type: <mimeType>, data: <base64> } },
 { type: "text", text: "Extract match stats from this screenshot. Return JSON only." }]
```

### 5.3 Cache configuration

The system prompt block carries `cache_control: { type: "ephemeral" }`. First call pays full input cost (~1200 tokens); subsequent calls within 5-minute cache TTL pay cached rate (~120 tokens). `parse.claude.test.ts` asserts the outgoing payload contains the `cache_control` marker.

---

## 6. UI Routes + Layout

### 6.1 `/admin/match-days/[id]/stats-upload/page.tsx`

Server component, gated by `requirePermAsync(sb, actor, 'stats.screenshot.upload')`.

Layout mirrors the match-day detail. One row per `matches` under this match_day:

- Left col: fixture summary (home vs away, scheduled time).
- Middle col: upload dropzone (single PNG/JPG/WEBP, ≤10 MB) — posts to `uploadScreenshotAction`.
- Right col: list of existing `match_stat_screenshots` for this match, each row with `StatusPill(parse_status)`, uploaded timestamp (`formatWat`), link to review.

Test IDs: `stats-upload-dropzone-{matchId}`, `stats-screenshot-row-{screenshotId}`, `stats-screenshot-status-{screenshotId}`.

### 6.2 `/admin/match-days/[id]/stats-upload/[screenshotId]/review/page.tsx`

Gated by `requirePermAsync(sb, actor, 'stats.screenshot.review')`. Grid layout:

| Left (50%) | Right (50%) |
|---|---|
| `<img src={signedReadUrl} />` (5-min TTL, auto-refresh button) | Editable form of `ParsedMatchStats`. Two column fieldsets: "Home" and "Away". Each field is a labelled number/text input mirroring the Zod schema. |

Above the grid: player-resolution controls — two `<select>`s mapping `homePlayerDisplayName` / `awayPlayerDisplayName` to actual `players.id` for the season. Admin must set both before `Confirm` enables.

Action bar:

- `Re-run OCR` (perm `stats.ocr.rerun`, admin only) — re-invokes `parse()`, cost-capped.
- `Confirm & write stats` — posts `confirmReviewAction({ screenshotId, correctedJson, homePlayerId, awayPlayerId })`.
- `Reject` — opens modal requiring a 3-500 char reason, posts `rejectReviewAction`.

Test IDs: `stats-review-image`, `stats-review-home-player-select`, `stats-review-away-player-select`, `stats-review-field-{side}-{field}`, `stats-review-confirm`, `stats-review-reject`, `stats-review-rerun`.

### 6.3 `actions.ts`

`/admin/match-days/[id]/stats-upload/actions.ts` exports:

- `uploadScreenshotAction(formData)` — creates the `match_stat_screenshots` row (`parse_status='pending'`), returns signed upload URL for the browser to POST the file to.
- `triggerParseAction(screenshotId)` — invoked after the browser finishes uploading; flips `parse_status='parsing'`, calls `parse()`, stores JSON, flips to `parsed` or `failed`.
- `confirmReviewAction(input)` — `requirePermAsync('stats.screenshot.review')`, calls `applyReview`.
- `rejectReviewAction(input)` — same perm, calls `rejectReview`.
- `rerunOcrAction(screenshotId)` — `requirePermAsync('stats.ocr.rerun')`, re-calls `parse()`. Audit trail captures every re-run.

### 6.4 Public `/players/[id]/page.tsx` extension

Add a "Recent match stats" card below the existing season stats grid. Data source: `player_match_stats` rows filtered through a join to `matches` then to `match_stat_screenshots` with `parse_status='confirmed'` only — or, when the admin hand-entered with `parsed_by_engine='manual'`, same filter applies. Bare `player_match_stats` rows that have NO associated `match_stat_screenshots` row (pre-Plan 14 legacy, should be zero in practice) are excluded until admin up-lifts them.

Card contents per match: date (WAT), opponent display name, final score, and a stat strip (possession %, shots, pass accuracy %, goals, assists). No screenshot image exposed publicly (bucket stays private).

### 6.5 Admin subnav entry

NONE — the upload page lives under match-day detail. `AdminSubnav.tsx` unchanged.

---

## 7. Permissions

Edit `apps/web/src/perms.ts` seed map (and the `role_permissions` seed migration `20260428000003` needs a follow-up insert in `20260504000001_match_stat_screenshots.sql` OR a separate seed migration `20260504000005_stats_ocr_perms_seed.sql`):

```
stats.screenshot.upload   → admin, moderator
stats.screenshot.review   → admin, moderator
stats.screenshot.delete   → admin
stats.ocr.rerun           → admin
```

Server actions call `requirePermAsync(sb, actor, 'stats.screenshot.upload' | 'stats.screenshot.review' | 'stats.ocr.rerun')`. Page components double-gate with `requirePermAsync` (§ Plan 9 pattern — page + action both check).

No `player` role gets any `stats.*` perm in Phase 1B. Public reads use the existing anonymous-read flow plus the confirmed-only join.

---

## 8. Tests

### 8.1 Unit (Vitest, ≥12 new)

All use Supabase mock (mirror `server/squads/*.test.ts` + `server/attendance/mark.test.ts`).

1. `schemas.test.ts` — Zod round-trip on `ParsedMatchStats`; strict rejection of `possessionPct = 150`; `passAccuracyPct = -1` rejected; nullable fields survive.
2. `storage.test.ts` — `createSignedUpload` returns path `matches/<matchId>/<screenshotId>.png`; `createSignedRead` uses 300s TTL by default.
3. `parse.test.ts` (env switch) — with `OCR_DISABLED=1` returns `{ status: 'disabled' }` without touching any client.
4. `parse.test.ts` (Claude path) — with `ANTHROPIC_API_KEY` set, dispatcher calls Claude wrapper (mocked), logs usage with non-zero cost cents.
5. `parse.test.ts` (Tesseract path) — without key, dispatcher falls through to Tesseract (mocked), logs usage with 0 cost cents.
6. `parse.test.ts` (budget cap) — mocks `ocr_usage_log` sum to return `99` with cap `100`; next call throws `BudgetExceededError` when an additional ~5¢ call would exceed cap.
7. `parse.claude.test.ts` — outgoing payload includes `cache_control: { type: 'ephemeral' }` on system block. Temperature is `0`. Max_tokens is `2000`.
8. `parse.claude.test.ts` (JSON retry) — mock returns `content: [{ type:'text', text: 'Sure, here is the JSON: { "homeScore": 2, ... }' }]` → wrapper retries once with correction nudge, on second good response returns Zod-parsed.
9. `parse.claude.test.ts` (Zod failure) — mock returns numerically impossible payload (`possessionPct: 500`) → throws `ParseShapeError`, dispatcher marks `parse_status='failed'`.
10. `parse.tesseract.test.ts` — region crop coordinates hit expected x/y/w/h; heuristic turns the string `"54%"` into `54`; unreadable region returns `null`, not `0`.
11. `review.test.ts` (idempotent) — calling `applyReview` twice yields exactly one row per `(match_id, player_id)`, `parse_status='confirmed'` unchanged on second call.
12. `review.test.ts` (partial correction) — admin edits `homeStats.passes` only; upsert carries the edit; other fields preserved from parse.
13. `review.test.ts` (reject requires reason) — `rejectReview` with empty reason → Zod throws; with valid reason flips status and writes nothing to `player_match_stats`.
14. `review.test.ts` (score contradiction guard) — if `correctedJson.homeScore !== match_results.home_score`, throws `ConflictError('score_mismatch')`.
15. `usage.test.ts` — `logUsage` inserts correct cost; `claudeCostCents(1500, 500)` returns expected integer per pricing formula.
16. `perms.seed.test.ts` (new assertion) — `player` role does NOT contain `'stats.screenshot.upload'`, `admin` wildcard DOES cover it.

### 8.2 E2E (Playwright, 1 new)

`apps/web/tests/e2e/stats-screenshot-ocr.spec.ts`:

```
test('admin uploads screenshot, reviews, confirms, public reflects stats', async () => {
  // Mock Anthropic SDK via MSW or process.env stub; parse returns a canned ParsedMatchStats.
  // OR: set OCR_DISABLED=1 and drive the manual-entry path for determinism.
  // 1. Login as admin.
  // 2. Navigate /admin/match-days/<seededId>/stats-upload.
  // 3. Attach a seeded PNG fixture from apps/web/tests/fixtures/stats-screen.png.
  // 4. Wait for parse_status pill to flip to 'parsed' (or 'pending' under disabled mode).
  // 5. Open /review, verify image loads via signed URL, correct one field (e.g. possessionPct 54 → 55).
  // 6. Resolve home + away player selects to seeded players.
  // 7. Click Confirm.
  // 8. Assert /players/<seededHomeId> renders the new "Recent match stats" card with possession=55.
  // 9. Re-confirm (idempotent): same number of player_match_stats rows afterwards.
});
```

Self-cleaning: the spec deletes its seeded `match_stat_screenshots` rows by `notes='e2e-stats-ocr'` at end of run (or uses unique test-tag matching `audit_smoke.sql` convention).

### 8.3 SDK mocking approach

- `@anthropic-ai/sdk` is injected by `parse.claude.ts` via a factory (`getAnthropicClient()`), not `new Anthropic()` inline. Tests replace the factory in setup.
- `node-tesseract-ocr` module is mocked via `vi.mock('node-tesseract-ocr', () => ({ default: { recognize: vi.fn() } }))`.
- E2E mocks Anthropic by setting `OCR_DISABLED=1` in Playwright's `webServer.env`, which exercises the manual-entry path end-to-end without network calls.

### 8.4 Audit smoke

Append to `supabase/tests/audit_smoke.sql`: one insert + update + soft-delete on `match_stat_screenshots`. `ocr_usage_log` is append-only and has its own insert-only assertion.

---

## 9. Numbered Tasks

Grouped migrations → server → UI → tests → verification. 24 items.

### Migrations + env

1. Write `supabase/migrations/20260504000001_match_stat_screenshots.sql` per §2.1; `npm run db:push`; verify via `npx supabase db query` that the table + both partial indexes + trigger exist.
2. Write `supabase/migrations/20260504000002_ocr_usage_log.sql` per §2.2 (append-only triggers); push; verify UPDATE + DELETE attempts raise the expected exception.
3. Write `supabase/migrations/20260504000003_storage_match_stat_screenshots_bucket.sql` per §2.3; push; verify bucket exists and `public=false`.
4. Write `supabase/migrations/20260504000005_stats_ocr_perms_seed.sql` inserting the four new permissions into `role_permissions` (admin + moderator where relevant) with `ON CONFLICT DO NOTHING`; push; verify row counts.
5. Add `ANTHROPIC_API_KEY=`, `OCR_DISABLED=`, `OCR_DAILY_CAP_USD_CENTS=100` to `.env.example`. Document in `apps/web/.env.local` comment (user copies real key). Add Vercel prod env entry.
6. Install deps: `npm --workspace apps/web install @anthropic-ai/sdk node-tesseract-ocr sharp`. Commit lockfile.

### Server modules (TDD — test first where marked)

7. `apps/web/src/server/stats_ocr/schemas.ts` — Zod per §4.2.
8. TDD `apps/web/src/server/stats_ocr/schemas.test.ts` — 4 tests per §8.1 #1.
9. `apps/web/src/server/stats_ocr/storage.ts` + `storage.test.ts` — signed-URL shape.
10. TDD `apps/web/src/server/stats_ocr/parse.claude.ts` + `parse.claude.test.ts` (≥3 tests: prompt cache marker, temp 0, JSON retry, Zod failure path).
11. TDD `apps/web/src/server/stats_ocr/parse.tesseract.ts` + `parse.tesseract.test.ts` (≥2 tests: region crop coords, heuristic parse, unreadable → null).
12. TDD `apps/web/src/server/stats_ocr/parse.ts` + `parse.test.ts` (≥4 tests: disabled flag, env switch Claude, env switch Tesseract, budget cap throw).
13. TDD `apps/web/src/server/stats_ocr/review.ts` + `review.test.ts` (≥4 tests: idempotent, partial correction, reject reason required, score contradiction guard).
14. TDD `apps/web/src/server/stats_ocr/usage.ts` + `usage.test.ts` (≥2 tests: logUsage insert shape, claudeCostCents math).
15. Create `apps/web/src/server/stats_ocr/index.ts` re-export surface.

### Permissions

16. Update `apps/web/src/perms.ts` seed: add the four `stats.*` perms to `admin` + `moderator` where §7 says. Re-run `perms.seed.test.ts`; add assertion for `player` denial.
17. Wire `requirePermAsync` usage in every new route page + action.

### UI

18. Build `/admin/match-days/[id]/stats-upload/page.tsx` + `actions.ts` (upload + trigger parse). Reuse `DataTable`, `StatusPill`, `PrimaryButton`.
19. Build `/admin/match-days/[id]/stats-upload/[screenshotId]/review/page.tsx` with side-by-side image + editable form + Confirm/Reject/Re-run buttons.
20. Extend `/players/[id]/page.tsx` with "Recent match stats" card sourced from confirmed-only join; ensure ISR `revalidate=60` preserved.

### Tests

21. Write `apps/web/tests/e2e/stats-screenshot-ocr.spec.ts` per §8.2 (single E2E). Seed fixture PNG in `apps/web/tests/fixtures/stats-screen.png`.
22. Append smoke queries to `supabase/tests/audit_smoke.sql`; `npm run audit:smoke` green.

### Verification + wrap

23. Verification gate — run every command in §10.2. Every one must pass.
24. Commit in slices (migrations → server → UI → tests). Push. Add Plan 14 review section to `tasks/todo.md`.

---

## 10. Acceptance Criteria + Verification Gate

### 10.1 Acceptance Criteria

- [ ] All four new migrations apply cleanly against the linked Supabase project. `supabase db query` confirms `match_stat_screenshots`, `ocr_usage_log`, bucket `match-stat-screenshots` (private), and four new `role_permissions` rows.
- [ ] Unit tests ≥12 new; all pass. `parse.claude.test.ts` proves cache_control + temperature + JSON retry.
- [ ] E2E `stats-screenshot-ocr.spec.ts` passes against a running dev server.
- [ ] Audit trigger fires on `match_stat_screenshots` insert + update + soft-delete. `ocr_usage_log` rejects UPDATE + DELETE.
- [ ] Kill switch (`OCR_DISABLED=1`) makes `parse()` return `{ status: 'disabled' }` without any Anthropic network call.
- [ ] Budget cap (`OCR_DAILY_CAP_USD_CENTS=100`) enforces — 101st cent throws `BudgetExceededError`.
- [ ] Public `/players/[id]` shows only `parse_status='confirmed'` stats; pending/rejected never leak.
- [ ] `player` role denied upload + review; middleware + server action both gate.

### 10.2 Verification gate (every command must pass)

| Command | Expected |
|---|---|
| `npm run test` | ≥12 new unit tests pass; total ≥97 |
| `npm run lint` | clean |
| `npm run build` | compiles; new routes `/admin/match-days/[id]/stats-upload`, `/admin/match-days/[id]/stats-upload/[screenshotId]/review` present |
| `npm --workspace apps/web run e2e` | all specs pass incl. `stats-screenshot-ocr.spec.ts` |
| `npm run db:push` | 34 of 34 applied |
| `npm run audit:smoke` | green (new assertions for `match_stat_screenshots` included) |

Success-criteria demo: §1.2 scenarios 1–5 driven manually against the running dev server against real Supabase cloud using a throwaway screenshot.

---

## 11. Risks + Mitigations

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| OCR hallucination writes wrong stats | High | Med | Mandatory human review — the review page is the ONLY write path into `player_match_stats`. No auto-confirm. Score contradiction guard rejects at confirm time. |
| Cost creep on Anthropic spend | High | Med | Per-day `OCR_DAILY_CAP_USD_CENTS` (default $1). `parse.ts` queries `ocr_usage_log` sum BEFORE dispatch. Prompt caching on the system prompt drops steady-state cost 10×. Weekly `ocr_usage_log` audit. |
| Screenshot PII leakage (player faces, chat overlays) | Med | Med | Bucket `match-stat-screenshots` private; signed URLs TTL 300s; `stats.screenshot.delete` admin-only; public `/players` never exposes images. |
| Review bypass via direct POST | High | Low | Server actions re-validate `requirePermAsync`. `applyReview` is the only writer; it loads the screenshot and requires `parse_status IN ('parsed','pending')`, rejecting already-confirmed + rejected. |
| Anthropic outage | Med | Med | Graceful fall-through to Tesseract if `ANTHROPIC_API_KEY` unset. In prod the admin can set `OCR_DISABLED=1` temporarily and hand-enter, then re-run later. |
| Tesseract dev-vs-prod drift | Med | High | Tesseract is explicitly the dev fallback — docs say so. E2E uses disabled-mode for determinism. Prod Vercel env never includes Tesseract. |
| Zod rejects legitimate parser output | Med | Med | Log the failing payload into `parse_status='failed'` + `notes` with raw JSON substring; admin falls back to manual. `parse.claude.test.ts` covers typical Zod failure modes. |
| Daily cap hits mid-match-day | Med | Low | Admin gets `BudgetExceededError` surfaced in UI; can raise cap in env + redeploy or hand-enter. Cap tracking in WAT day (`Africa/Lagos`). |
| JSON retry loops on flaky model | Low | Low | Exactly one retry; second failure is a hard failure logged to `ocr_usage_log` with `success_bool=false`. No recursive retry. |

---

## 12. Out of Scope (Phase 3+)

- Video stat parsing (per-frame OCR on match recordings).
- Live in-match OCR (streaming vMix feed into parser).
- OBS/vMix overlay stat extraction during broadcast.
- Voice-transcription stat extraction (commentator call-outs).
- Auto-confirm of "high-confidence" parses without human review.
- Futbin + eFootball API direct integration (bypasses OCR entirely).
- Multi-screenshot merge (players submitting multiple angle caps).
- PII redaction on stored screenshots.
- Retroactive OCR of already-confirmed matches prior to Plan 14.

---

## 13. Critical Files for Implementation

- `supabase/migrations/20260504000001_match_stat_screenshots.sql`
- `supabase/migrations/20260504000002_ocr_usage_log.sql`
- `supabase/migrations/20260504000003_storage_match_stat_screenshots_bucket.sql`
- `supabase/migrations/20260504000005_stats_ocr_perms_seed.sql`
- `apps/web/src/server/stats_ocr/parse.ts`
- `apps/web/src/server/stats_ocr/parse.claude.ts`
- `apps/web/src/server/stats_ocr/review.ts`
- `apps/web/src/server/stats_ocr/usage.ts`
- `apps/web/src/app/admin/match-days/[id]/stats-upload/page.tsx`
- `apps/web/src/app/admin/match-days/[id]/stats-upload/[screenshotId]/review/page.tsx`
- `apps/web/src/app/admin/match-days/[id]/stats-upload/actions.ts`
- `apps/web/tests/e2e/stats-screenshot-ocr.spec.ts`
- `apps/web/src/perms.ts` (seed)

---

## 14. Open Items Before Coding

1. **Claude Opus 4.7 vision pricing verification.** §3.3 assumes $15/1M input, $75/1M output, cached input 10× discount. Confirm against live Anthropic pricing page on implementation day; update `claudeCostCents` constants.
2. **Region crop calibration for Tesseract.** §4.5 coords are placeholders. Calibrate against a real eFootball end-screen once we have a sample library.
3. **Player name → UUID resolution heuristic.** Admin manually resolves in Phase 1B. Phase 2 could fuzzy-match `homePlayerDisplayName` against `players.gamer_tag` + confidence threshold.
4. **ocr_usage_log retention.** Append-only forever vs quarterly archive. Defer until table hits ~100k rows.
5. **Multi-language screenshots.** Prompt assumes English UI. If eFootball auto-localizes to user region, extend prompt or force English UI setting.

---
