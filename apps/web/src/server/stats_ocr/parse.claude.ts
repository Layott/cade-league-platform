import Anthropic from "@anthropic-ai/sdk";
import {
  parsedMatchStatsSchema,
  type ParsedMatchStats,
} from "./schemas";

/**
 * Plan 14 — Anthropic Claude Opus 4.7 vision wrapper.
 *
 * We pass a pre-built client in so unit tests can mock the SDK completely.
 * `getAnthropicClient()` is the production factory — keeps env var access
 * in one place.
 */

export const CLAUDE_MODEL = "claude-opus-4-7";
export const CLAUDE_MAX_TOKENS = 2000;
export const CLAUDE_TEMPERATURE = 0;

/**
 * Full system prompt — copied verbatim from spec §5.1. Kept as a single
 * top-level const so unit tests can assert its hash / known substrings, and
 * so prompt caching hits on every call (identical text → identical cache
 * key at the SDK layer).
 */
// prettier-ignore
export const CLAUDE_SYSTEM_PROMPT = `You are a specialized extraction agent for eFootball and FIFA Ultimate Team (FUT) end-of-match stat screenshots. Your only job is to read the image and return a JSON object conforming to the schema below. You NEVER write prose, markdown, apology, or explanation. You output ONE JSON object and nothing else.

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

Output constraint: ONLY the JSON object. No prose. No code fence. No markdown. First character MUST be \`{\`. Last character MUST be \`}\`.

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

Remember: ONLY the JSON. Temperature 0. First char \`{\`, last char \`}\`.`;

export class ParseShapeError extends Error {
  constructor(
    message: string,
    public readonly rawPayload: string,
  ) {
    super(message);
    this.name = "ParseShapeError";
  }
}

export interface ClaudeParseResult {
  engine: "claude-opus-4-7";
  parsed: ParsedMatchStats;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Production factory — single place that reads ANTHROPIC_API_KEY. Tests never
 * call this; they pass a mock client to parseWithClaude() directly.
 */
export function getAnthropicClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "getAnthropicClient: ANTHROPIC_API_KEY not set",
    );
  }
  return new Anthropic({ apiKey: key });
}

type TextBlock = { type: "text"; text: string };
interface MessageResponse {
  content: Array<TextBlock | { type: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function extractText(resp: MessageResponse): string {
  const txt = resp.content.find(
    (b): b is TextBlock => b.type === "text",
  );
  if (!txt) {
    throw new ParseShapeError("no text block in response", "");
  }
  return txt.text;
}

function tryParseJson(raw: string): unknown {
  // The model sometimes wraps in ```json fences even when told not to. Strip
  // defensively before JSON.parse.
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  return JSON.parse(s);
}

export interface AnthropicLike {
  messages: {
    create: (body: unknown) => Promise<MessageResponse>;
  };
}

/**
 * Parse a PNG/JPEG/WebP screenshot via Claude Opus 4.7 vision. One JSON
 * retry on invalid JSON; Zod failure on the second response surfaces as
 * ParseShapeError for the dispatcher to log + mark `parse_status='failed'`.
 */
export async function parseWithClaude(
  client: AnthropicLike,
  imageBase64: string,
  mimeType: "image/png" | "image/jpeg" | "image/webp",
): Promise<ClaudeParseResult> {
  const systemBlocks = [
    {
      type: "text",
      text: CLAUDE_SYSTEM_PROMPT,
      // cache_control ephemeral → Anthropic caches the system prompt for
      // 5 min across calls; steady-state cost drops ~10× on input tokens.
      cache_control: { type: "ephemeral" as const },
    },
  ];

  const userContent = [
    {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: mimeType,
        data: imageBase64,
      },
    },
    {
      type: "text" as const,
      text: "Extract match stats from this screenshot. Return JSON only.",
    },
  ];

  // First attempt.
  const firstResp = (await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    temperature: CLAUDE_TEMPERATURE,
    system: systemBlocks,
    messages: [{ role: "user", content: userContent }],
  })) as MessageResponse;

  const firstText = extractText(firstResp);

  let parsedObj: unknown;
  let inputTokens = firstResp.usage?.input_tokens ?? 0;
  let outputTokens = firstResp.usage?.output_tokens ?? 0;

  try {
    parsedObj = tryParseJson(firstText);
  } catch {
    // Retry once with a correction nudge — still uses the cached system
    // prompt, so the second call is cheap.
    const retryResp = (await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      temperature: CLAUDE_TEMPERATURE,
      system: systemBlocks,
      messages: [
        { role: "user", content: userContent },
        { role: "assistant", content: [{ type: "text", text: firstText }] },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You returned invalid JSON. Emit ONLY the JSON object — first char `{`, last char `}`, no prose, no fences.",
            },
          ],
        },
      ],
    })) as MessageResponse;
    const retryText = extractText(retryResp);
    inputTokens += retryResp.usage?.input_tokens ?? 0;
    outputTokens += retryResp.usage?.output_tokens ?? 0;
    try {
      parsedObj = tryParseJson(retryText);
    } catch {
      throw new ParseShapeError(
        "invalid JSON after one retry",
        retryText,
      );
    }
  }

  // Zod validation — on failure the raw payload is attached so the
  // dispatcher can store a slice of it in `notes` for the reviewer.
  const result = parsedMatchStatsSchema.safeParse(parsedObj);
  if (!result.success) {
    throw new ParseShapeError(
      `Zod validation failed: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      JSON.stringify(parsedObj).slice(0, 500),
    );
  }

  return {
    engine: "claude-opus-4-7",
    parsed: result.data,
    inputTokens,
    outputTokens,
  };
}
