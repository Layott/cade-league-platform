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
  // 22-power-rankings — one-sentence commentary on the SPECIFIC player
  // currently in that rank. The action layer expands the brief with the
  // player's name + record + standout stat hint via `playerContext` so
  // these strings can stay rank-flavored but never invent a name.
  "pr-blurb-1":
    "Write a single sentence (max 90 chars) celebrating the named #1 player's current form. Reference at least one concrete stat from the player context (record, GD, goals, streak). Confident, slightly poetic, sometimes funny. Use their name. No quotes, no markdown.",
  "pr-blurb-2":
    "Write a single sentence (max 90 chars) about the named #2 player. Reference at least one concrete stat from their context (record, GD, points, goals). Acknowledge momentum, a recent rise, or the gap to #1. Use their name. No quotes, no markdown.",
  "pr-blurb-3":
    "Write a single sentence (max 90 chars) about the named #3 player. Reference at least one concrete stat (record, GD, GA, goals scored). Note a strength or a recent slip. Use their name. No quotes, no markdown.",
  "pr-blurb-4":
    "Write a single sentence (max 90 chars) about the named #4 player. Reference at least one concrete stat. Lean into consistency or sneaky form. Use their name. No quotes, no markdown.",
  "pr-blurb-5":
    "Write a single sentence (max 90 chars) about the named #5 player. Reference at least one concrete stat (goals scored, GD, win/draw balance). Highlight attacking flair, entertainment, or comeback narrative. Use their name. No quotes, no markdown.",
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
- Do not invent specific player names unless the user message provides them. When the user message names a SPECIFIC player and stat block ("Player context"), your line MUST use that player's name and reference at least one of their listed stats.
- Do not include URLs, hashtags, or @mentions.
- The first character of your response MUST be the first character of the actual copy. The last character MUST be the last character of the copy.`;

/**
 * Player-specific context for power-rankings slots (pr-blurb-1..5).
 * The action layer fetches the rank's leaderboard row, computes a
 * standout-stat hint, and passes both into the AI so the regenerated
 * line names the actual player and references real numbers — not a
 * generic "the #1 ranked player" placeholder.
 */
export type PlayerContext = {
  /** Display name (e.g. "FARUK"). */
  name: string;
  rank: number;
  pts: number;
  gd: number;
  /** Matches played. */
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  /**
   * Standout-stat hint — a one-clause label of the most notable
   * pattern in this row's stats (e.g. "unbeaten through 5",
   * "goal machine 3.4/match", "tough run 0W-1D-3L"). Lets the AI
   * lean into the actual storyline instead of inventing one.
   */
  standout?: string;
};

export type RegenerateInput = {
  elementId: string;
  /** Current content — useful as a tone anchor + as a fallback on AI failure. */
  currentContent: string;
  /** Overlay key for telemetry; not used by the prompt. */
  overlayKey: string;
  /**
   * Optional live-stats context block. The action layer fetches the
   * combined cover-up-stats feed and prose-formats it (top-scorer name +
   * pts, longest streak, biggest margin, etc.) so the AI can write copy
   * that names the real player at the right number rather than inventing
   * generic placeholder names. Keep ≤ 600 chars to stay inside the
   * Haiku context budget.
   */
  liveStats?: string;
  /**
   * Per-rank player context — set for pr-blurb-* slots. The user
   * message expands the brief with the player's real name + record so
   * the AI can write a stat-grounded line.
   */
  playerContext?: PlayerContext;
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

  const playerBlock = input.playerContext
    ? [
        `\nPlayer context — write about THIS player by name; use these real numbers, do NOT invent others:`,
        `  Name: ${input.playerContext.name}`,
        `  Rank: #${input.playerContext.rank}`,
        `  Record: ${input.playerContext.w}W-${input.playerContext.d}D-${input.playerContext.l}L (${input.playerContext.p} played)`,
        `  Points: ${input.playerContext.pts}`,
        `  Goal difference: ${input.playerContext.gd > 0 ? "+" : ""}${input.playerContext.gd}`,
        `  Goals for / against: ${input.playerContext.gf} / ${input.playerContext.ga}`,
        input.playerContext.standout
          ? `  Standout note (use this as the spine of the line): ${input.playerContext.standout}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const userMessage = [
    brief,
    playerBlock,
    input.liveStats
      ? `\nLive league context (use real numbers + names; do NOT invent):\n${input.liveStats}`
      : "",
    "",
    `Reference (current copy, do NOT copy verbatim — write something fresh):`,
    input.currentContent || "(none)",
    "",
    "Return ONE line only. Begin with the first character of the copy.",
  ].filter(Boolean).join("\n");

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
