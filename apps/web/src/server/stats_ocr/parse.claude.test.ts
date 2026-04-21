import { describe, it, expect, vi } from "vitest";
import {
  parseWithClaude,
  ParseShapeError,
  CLAUDE_MAX_TOKENS,
  CLAUDE_TEMPERATURE,
  CLAUDE_SYSTEM_PROMPT,
} from "./parse.claude";

function makeGoodJson(): string {
  return JSON.stringify({
    homePlayerDisplayName: "NUNUSWAGGER",
    awayPlayerDisplayName: "LAYO_KING",
    homeScore: 3,
    awayScore: 1,
    homeStats: {
      possessionPct: 54,
      shots: 11,
      shotsOnTarget: 7,
      passes: 412,
      passAccuracyPct: 89,
      tackles: 9,
      interceptions: 5,
      fouls: 4,
      ballRecoveries: 22,
      goals: 3,
      assists: 0,
    },
    awayStats: {
      possessionPct: 46,
      shots: 4,
      shotsOnTarget: 2,
      passes: 287,
      passAccuracyPct: 83,
      tackles: 14,
      interceptions: 8,
      fouls: 3,
      ballRecoveries: 18,
      goals: 1,
      assists: 0,
    },
    sourceNotes: "",
  });
}

describe("parseWithClaude — outgoing payload", () => {
  it("sends cache_control ephemeral on system block, temp 0, max_tokens 2000", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: makeGoodJson() }],
      usage: { input_tokens: 1200, output_tokens: 500 },
    });
    const client = { messages: { create } };

    await parseWithClaude(
      client as never,
      "base64data",
      "image/png"
    );

    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0][0];
    expect(body.max_tokens).toBe(CLAUDE_MAX_TOKENS);
    expect(body.temperature).toBe(CLAUDE_TEMPERATURE);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0].text).toBe(CLAUDE_SYSTEM_PROMPT);

    // user-content should contain image + instruction text blocks
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content[0].type).toBe("image");
    expect(body.messages[0].content[0].source.media_type).toBe("image/png");
  });

  it("returns parsed result with token counts from usage", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: makeGoodJson() }],
      usage: { input_tokens: 1200, output_tokens: 500 },
    });
    const out = await parseWithClaude(
      { messages: { create } } as never,
      "base64data",
      "image/png"
    );
    expect(out.engine).toBe("claude-opus-4-7");
    expect(out.inputTokens).toBe(1200);
    expect(out.outputTokens).toBe(500);
    expect(out.parsed.homeScore).toBe(3);
    expect(out.parsed.homePlayerDisplayName).toBe("NUNUSWAGGER");
  });
});

describe("parseWithClaude — JSON retry", () => {
  it("retries once on invalid JSON and succeeds on the retry", async () => {
    const create = vi
      .fn()
      // First call: prose wrapping
      .mockResolvedValueOnce({
        content: [
          { type: "text", text: "Sure, here is the JSON: " + makeGoodJson() },
        ],
        usage: { input_tokens: 1200, output_tokens: 500 },
      })
      // Retry: clean JSON
      .mockResolvedValueOnce({
        content: [{ type: "text", text: makeGoodJson() }],
        usage: { input_tokens: 120, output_tokens: 500 },
      });
    const out = await parseWithClaude(
      { messages: { create } } as never,
      "b64",
      "image/png"
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.parsed.homeScore).toBe(3);
    // token counts are summed
    expect(out.inputTokens).toBe(1320);
    expect(out.outputTokens).toBe(1000);
  });

  it("strips ```json fences even without retry", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "```json\n" + makeGoodJson() + "\n```",
        },
      ],
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const out = await parseWithClaude(
      { messages: { create } } as never,
      "b64",
      "image/png"
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.parsed.homeScore).toBe(3);
  });
});

describe("parseWithClaude — Zod failure", () => {
  it("throws ParseShapeError when JSON is syntactically valid but invalid shape", async () => {
    const badObj = {
      homePlayerDisplayName: "X",
      awayPlayerDisplayName: "Y",
      homeScore: 1,
      awayScore: 0,
      homeStats: {
        possessionPct: 500, // out of range
        shots: 1,
        shotsOnTarget: 1,
        passes: 1,
        passAccuracyPct: 50,
        tackles: 0,
        interceptions: 0,
        fouls: 0,
        ballRecoveries: 0,
        goals: 1,
        assists: 0,
      },
      awayStats: {
        possessionPct: 50,
        shots: 1,
        shotsOnTarget: 1,
        passes: 1,
        passAccuracyPct: 50,
        tackles: 0,
        interceptions: 0,
        fouls: 0,
        ballRecoveries: 0,
        goals: 0,
        assists: 0,
      },
      sourceNotes: "",
    };
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(badObj) }],
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    await expect(
      parseWithClaude(
        { messages: { create } } as never,
        "b64",
        "image/png"
      )
    ).rejects.toThrow(ParseShapeError);
  });

  it("throws ParseShapeError when JSON is invalid after retry", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "totally not json" }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    await expect(
      parseWithClaude(
        { messages: { create } } as never,
        "b64",
        "image/png"
      )
    ).rejects.toThrow(/invalid JSON after one retry/);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
