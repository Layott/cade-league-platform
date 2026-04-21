import { describe, it, expect, vi } from "vitest";
import { claudeCostCents, logUsage, sumSpendTodayCents } from "./usage";

describe("claudeCostCents", () => {
  it("computes 6 cents for (1500,500) at Opus 4.7 pricing", () => {
    expect(claudeCostCents(1500, 500)).toBe(6);
  });

  it("computes 0 cents for all-zeros", () => {
    expect(claudeCostCents(0, 0)).toBe(0);
  });

  it("ceils fractional cent to next integer", () => {
    // 1 input token = 0.0015 cents → ceil → 1
    expect(claudeCostCents(1, 0)).toBe(1);
  });

  it("scales with output-heavy calls", () => {
    // 100 input (0.15) + 2000 output (15) = 15.15 → 16
    expect(claudeCostCents(100, 2000)).toBe(16);
  });
});

describe("logUsage", () => {
  it("inserts a row with engine + cost + success flag", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const sb = { from: vi.fn(() => ({ insert })) };

    await logUsage(sb as never, {
      engine: "claude-opus-4-7",
      inputTokens: 1500,
      outputTokens: 500,
      costUsdCents: 6,
      successBool: true,
      matchIdRef: "m-1",
      screenshotIdRef: "s-1",
    });

    expect(sb.from).toHaveBeenCalledWith("ocr_usage_log");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "claude-opus-4-7",
        input_tokens: 1500,
        output_tokens: 500,
        cost_usd_cents: 6,
        success_bool: true,
        match_id_ref: "m-1",
        screenshot_id_ref: "s-1",
      })
    );
  });

  it("swallows insert errors (best-effort)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const insert = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const sb = { from: vi.fn(() => ({ insert })) };

    await expect(
      logUsage(sb as never, {
        engine: "tesseract",
        costUsdCents: 0,
        successBool: true,
      })
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("sumSpendTodayCents", () => {
  it("returns 0 when query errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gte = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ gte })),
      })),
    };
    expect(await sumSpendTodayCents(sb as never)).toBe(0);
    errSpy.mockRestore();
  });

  it("sums cost_usd_cents across returned rows", async () => {
    const gte = vi.fn().mockResolvedValue({
      data: [
        { cost_usd_cents: 6 },
        { cost_usd_cents: 4 },
        { cost_usd_cents: null },
      ],
      error: null,
    });
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ gte })),
      })),
    };
    expect(await sumSpendTodayCents(sb as never)).toBe(10);
  });
});
