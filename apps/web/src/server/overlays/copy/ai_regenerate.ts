import Anthropic from "@anthropic-ai/sdk";

/**
 * Phase 3 — AI copy regeneration for cover-up overlays (22/25/26/28/29).
 *
 * Generates a single fresh line of broadcast copy for one editable text
 * slot. The caller (regenerateOverlayCopyAction) writes the returned
 * string into `overlay_text_elements.content`, replacing whatever is
 * currently there. Admins can free-edit afterward through the existing
 * /admin/broadcast/v2/design Text panel — AI is a starting point, not a
 * final override.
 *
 * Uses Claude Haiku 4.5 (cheap + fast — ~$0.005 per call) since the
 * generation is short (≤ 220 chars, single line, no markdown). Falls
 * back to the curated seed-default if the API call fails so the panel
 * never strands the admin on an error.
 *
 * Model + prompts live as exported constants so a future test can mock
 * the SDK and assert against the static prompt hash.
 */

export const COPY_AI_MODEL = "claude-haiku-4-5-20251001";
export const COPY_AI_MAX_TOKENS = 200;
export const COPY_AI_TEMPERATURE = 0.9;

/**
 * Per-slot generation brief. Each value contains a one-line instruction
 * the system prompt suffixes onto the generic "be funny and concise"
 * preamble. The map is exhaustive against the set of editable element
 * IDs seeded by migration 20260802000001.
 */
const SLOT_BRIEFS: Record<string, string> = {
  // 22-power-rankings — one-sentence commentary on a ranked player
  "pr-blurb-1":
    "Write a single sentence (max 90 chars) celebrating the #1 ranked player's current form. Be confident, slightly poetic, sometimes funny. No quotes, no markdown.",
  "pr-blurb-2":
    "Write a single sentence (max 90 chars) about the #2 ranked player. Acknowledge momentum or a recent rise. No quotes, no markdown.",
  "pr-blurb-3":
    "Write a single sentence (max 90 chars) about the #3 ranked player. Note a strength or a recent slip. No quotes, no markdown.",
  "pr-blurb-4":
    "Write a single sentence (max 90 chars) about the #4 ranked player. Lean into consistency or sneaky form. No quotes, no markdown.",
  "pr-blurb-5":
    "Write a single sentence (max 90 chars) about the #5 ranked player. Highlight goals scored, entertainment, or attacking flair. No quotes, no markdown.",
  // 25-did-you-know — trivia paragraph
  "dyk-detail":
    "Write a single 'did you know' paragraph (40-80 words) full of one specific season statistic and a small narrative flourish. Sound like a broadcast anchor. No bullet points, no markdown.",
  // 26-card-meta — sub-head tagline above the most-picked cards grid
  "cm-subhead":
    "Write a single sub-head line (max 60 chars, ALL CAPS) for a 'most-picked FUT cards this week' chart. Tone: hype broadcast tagline.",
  // 28-punditry — quote + attribution
  "pq-quote":
    "Write a single broadcast-pundit quote (max 180 chars, ALL CAPS) about the current league. Sound confident and a little theatrical. No quotation marks.",
  "pq-author":
    "Write a single short attribution (max 40 chars, ALL CAPS) for a pundit-desk quote — sounds like a TV column credit (e.g. 'CADE PUNDIT DESK', 'ANALYST CORNER').",
  "pq-role":
    "Write a single short tagline (max 40 chars, ALL CAPS) describing what week or context this analysis covers (e.g. 'WEEK 3 ANALYSIS', 'MID-SEASON CHECK-IN').",
  // 29-goalfests — sub-head for the goalfest chart
  "gf-subhead":
    "Write a single sub-head line (max 70 chars, ALL CAPS) for a chart of the highest-scoring fixtures of the week. Tone: hype broadcast tagline.",
};

export function isAiRegenerableElement(elementId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SLOT_BRIEFS, elementId);
}

export const COPY_AI_SYSTEM_PROMPT = `You are a broadcast copywriter for the CADE Esports Pro League — a Nigerian competitive FC26 league.

You write SHORT, PUNCHY, BROADCAST-READY copy that appears on screen during livestreams. Your tone is confident, sometimes funny, never corporate. You write like a Premier League broadcast columnist crossed with a sports-pundit Twitter account.

OUTPUT RULES (non-negotiable):
- Output ONLY the line of copy itself. No greeting, no explanation, no markdown, no quotation marks wrapping the output, no preamble.
- Honor the per-slot brief's character limit. If the brief says "max 90 chars", count and stay under it.
- Honor the per-slot brief's casing directive (ALL CAPS when specified).
- Do not invent specific player names unless the user message provides them.
- Do not include URLs, hashtags, or @mentions.
- The first character of your response MUST be the first character of the actual copy. The last character MUST be the last character of the copy.`;

export type RegenerateInput = {
  elementId: string;
  /** Current content — useful as a tone anchor + as a fallback on AI failure. */
  currentContent: string;
  /** Overlay key for telemetry; not used by the prompt. */
  overlayKey: string;
};

export interface AnthropicLike {
  messages: {
    create: (body: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

export function getAnthropicClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("getAnthropicClient: ANTHROPIC_API_KEY not set");
  }
  return new Anthropic({ apiKey: key });
}

function stripWrappingQuotes(s: string): string {
  let out = s.trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith("“") && out.endsWith("”"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

export async function regenerateCopy(
  client: AnthropicLike,
  input: RegenerateInput,
): Promise<string> {
  const brief = SLOT_BRIEFS[input.elementId];
  if (!brief) {
    throw new Error(
      `regenerateCopy: no brief for elementId '${input.elementId}'`,
    );
  }

  const userMessage = [
    brief,
    "",
    `Reference (current copy, do NOT copy verbatim — write something fresh):`,
    input.currentContent || "(none)",
    "",
    "Return ONE line only. Begin with the first character of the copy.",
  ].join("\n");

  const resp = await client.messages.create({
    model: COPY_AI_MODEL,
    max_tokens: COPY_AI_MAX_TOKENS,
    temperature: COPY_AI_TEMPERATURE,
    system: [
      {
        type: "text",
        text: COPY_AI_SYSTEM_PROMPT,
        // ephemeral cache — system prompt + briefs are stable; cache hit
        // drops cost ~10x on input tokens after the first call.
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const block = resp.content.find((b) => b.type === "text");
  const raw = block && typeof block.text === "string" ? block.text : "";
  const cleaned = stripWrappingQuotes(raw).replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    throw new Error("regenerateCopy: empty AI response");
  }
  if (cleaned.length > 1024) {
    return cleaned.slice(0, 1024);
  }
  return cleaned;
}
