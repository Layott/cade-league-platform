import { describe, it, expect, vi } from "vitest";
import {
  parseIntOrNull,
  parsePercentOrNull,
  parseWithTesseract,
  STAT_REGIONS,
} from "./parse.tesseract";

describe("parseIntOrNull heuristic", () => {
  it("parses clean ints", () => {
    expect(parseIntOrNull("11")).toBe(11);
    expect(parseIntOrNull("  412  ")).toBe(412);
  });

  it("parses '54%' as 54 via parsePercentOrNull", () => {
    expect(parsePercentOrNull("54%")).toBe(54);
  });

  it("returns null for unreadable input — never 0", () => {
    expect(parseIntOrNull("")).toBeNull();
    expect(parseIntOrNull("—")).toBeNull();
    expect(parseIntOrNull(null)).toBeNull();
    expect(parsePercentOrNull("N/A")).toBeNull();
  });

  it("rejects out-of-range percentages (>100) as null", () => {
    expect(parsePercentOrNull("150%")).toBeNull();
    expect(parsePercentOrNull("999")).toBeNull();
  });
});

describe("STAT_REGIONS", () => {
  it("normalised coords stay within 0..1 on every region", () => {
    for (const key of Object.keys(STAT_REGIONS) as (keyof typeof STAT_REGIONS)[]) {
      const r = STAT_REGIONS[key];
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1);
      expect(r.y + r.h).toBeLessThanOrEqual(1);
    }
  });

  it("exposes possession coords for both home and away", () => {
    expect(STAT_REGIONS.possessionHome).toBeDefined();
    expect(STAT_REGIONS.possessionAway).toBeDefined();
    // Home + away possession strips live at the same y.
    expect(STAT_REGIONS.possessionHome.y).toBe(STAT_REGIONS.possessionAway.y);
  });
});

describe("parseWithTesseract happy path", () => {
  it("extracts score + possession + shots from an eFootball-like OCR dump", async () => {
    const tess = {
      recognize: vi.fn().mockResolvedValue(
        [
          "NUNUSWAGGER    3 - 1    LAYO_KING",
          "Possession 54% 46%",
          "Shots 11 4",
        ].join("\n")
      ),
    };
    const out = await parseWithTesseract(tess as never, Buffer.from([]));
    expect(out.engine).toBe("tesseract");
    expect(out.parsed.homeScore).toBe(3);
    expect(out.parsed.awayScore).toBe(1);
    expect(out.parsed.homeStats.possessionPct).toBe(54);
    expect(out.parsed.awayStats.possessionPct).toBe(46);
    expect(out.parsed.homeStats.shots).toBe(11);
    expect(out.parsed.awayStats.shots).toBe(4);
    // Unreadable rest stays null — never 0.
    expect(out.parsed.homeStats.tackles).toBeNull();
    expect(out.parsed.homeStats.passAccuracyPct).toBeNull();
  });

  it("returns all-null parsed block when OCR text is garbage", async () => {
    const tess = {
      recognize: vi.fn().mockResolvedValue("lorem ipsum dolor sit amet"),
    };
    const out = await parseWithTesseract(tess as never, Buffer.from([]));
    expect(out.parsed.homeScore).toBeNull();
    expect(out.parsed.awayScore).toBeNull();
    expect(out.parsed.homeStats.possessionPct).toBeNull();
    expect(out.parsed.homeStats.shots).toBeNull();
  });
});
