import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse, BudgetExceededError } from "./parse";
import { emptyParsedMatchStats } from "./schemas";

function mkSb(overrides: {
  todaySumRows?: Array<{ cost_usd_cents: number | null }>;
  insertError?: { message: string } | null;
} = {}) {
  const insertMock = vi
    .fn()
    .mockResolvedValue({ error: overrides.insertError ?? null });
  const gteMock = vi.fn().mockResolvedValue({
    data: overrides.todaySumRows ?? [],
    error: null,
  });
  return {
    from: vi.fn(() => ({
      insert: insertMock,
      select: vi.fn(() => ({ gte: gteMock })),
    })),
    __insertMock: insertMock,
  };
}

const FAKE_IMAGE = Buffer.from([0, 1, 2, 3]);

function goodClaudeResp() {
  const parsed = emptyParsedMatchStats();
  parsed.homePlayerDisplayName = "A";
  parsed.awayPlayerDisplayName = "B";
  parsed.homeScore = 1;
  parsed.awayScore = 0;
  return {
    content: [{ type: "text", text: JSON.stringify(parsed) }],
    usage: { input_tokens: 1200, output_tokens: 400 },
  };
}

describe("parse dispatcher — OCR_DISABLED", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.OCR_DISABLED = "1";
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns { status: 'disabled' } without touching the client", async () => {
    const claudeCreate = vi.fn();
    const sb = mkSb();
    const out = await parse(sb as never, {
      screenshotId: "s-1",
      matchId: "m-1",
      imageBuffer: FAKE_IMAGE,
      mimeType: "image/png",
      anthropicClient: { messages: { create: claudeCreate } },
    });
    expect(out).toEqual({ status: "disabled" });
    expect(claudeCreate).not.toHaveBeenCalled();
    expect(sb.__insertMock).not.toHaveBeenCalled();
  });
});

describe("parse dispatcher — Claude path", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OCR_DISABLED;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.OCR_DAILY_CAP_USD_CENTS = "100";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("calls Claude and logs usage with non-zero cost cents", async () => {
    const claudeCreate = vi.fn().mockResolvedValue(goodClaudeResp());
    const sb = mkSb();
    const out = await parse(sb as never, {
      screenshotId: "s-1",
      matchId: "m-1",
      imageBuffer: FAKE_IMAGE,
      mimeType: "image/png",
      anthropicClient: { messages: { create: claudeCreate } },
    });
    expect(out.status).toBe("parsed");
    if (out.status === "parsed") {
      expect(out.engine).toBe("claude-opus-4-7");
      expect(out.parsed.homeScore).toBe(1);
    }
    expect(claudeCreate).toHaveBeenCalledTimes(1);

    // usage log: one row, claude engine, cost > 0.
    expect(sb.__insertMock).toHaveBeenCalledTimes(1);
    const logged = sb.__insertMock.mock.calls[0][0];
    expect(logged.engine).toBe("claude-opus-4-7");
    expect(logged.cost_usd_cents).toBeGreaterThan(0);
    expect(logged.success_bool).toBe(true);
  });
});

describe("parse dispatcher — Tesseract fallback", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OCR_DISABLED;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls through to Tesseract when no Anthropic key, logs zero cost", async () => {
    const tessRecognize = vi
      .fn()
      .mockResolvedValue("A 1 - 0 B\nPossession 60% 40%\nShots 5 3");
    const sb = mkSb();
    const out = await parse(sb as never, {
      screenshotId: "s-1",
      matchId: "m-1",
      imageBuffer: FAKE_IMAGE,
      mimeType: "image/png",
      tesseractClient: { recognize: tessRecognize },
    });
    expect(out.status).toBe("parsed");
    if (out.status === "parsed") {
      expect(out.engine).toBe("tesseract");
    }
    expect(tessRecognize).toHaveBeenCalledTimes(1);
    const logged = sb.__insertMock.mock.calls[0][0];
    expect(logged.engine).toBe("tesseract");
    expect(logged.cost_usd_cents).toBe(0);
  });
});

describe("parse dispatcher — Budget cap", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OCR_DISABLED;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.OCR_DAILY_CAP_USD_CENTS = "100";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws BudgetExceededError when today's spend leaves <5c headroom", async () => {
    const claudeCreate = vi.fn();
    const sb = mkSb({ todaySumRows: [{ cost_usd_cents: 99 }] });
    await expect(
      parse(sb as never, {
        screenshotId: "s-1",
        matchId: "m-1",
        imageBuffer: FAKE_IMAGE,
        mimeType: "image/png",
        anthropicClient: { messages: { create: claudeCreate } },
      })
    ).rejects.toThrow(BudgetExceededError);
    expect(claudeCreate).not.toHaveBeenCalled();
    // A failure log still fires for audit.
    expect(sb.__insertMock).toHaveBeenCalledTimes(1);
    const logged = sb.__insertMock.mock.calls[0][0];
    expect(logged.success_bool).toBe(false);
    expect(logged.error_message).toMatch(/budget cap/);
  });

  it("allows dispatch when spend is low", async () => {
    const claudeCreate = vi.fn().mockResolvedValue(goodClaudeResp());
    const sb = mkSb({ todaySumRows: [{ cost_usd_cents: 5 }] });
    const out = await parse(sb as never, {
      screenshotId: "s-1",
      matchId: "m-1",
      imageBuffer: FAKE_IMAGE,
      mimeType: "image/png",
      anthropicClient: { messages: { create: claudeCreate } },
    });
    expect(out.status).toBe("parsed");
  });
});
