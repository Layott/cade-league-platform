import { describe, it, expect } from "vitest";
import {
  parseIntOrNull,
  parsePercentOrNull,
  parseWithTesseract,
  STAT_REGIONS,
} from "./parse.tesseract";

describe("parseIntOrNull / parsePercentOrNull helpers", () => {
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
    expect(STAT_REGIONS.possessionHome.y).toBe(STAT_REGIONS.possessionAway.y);
  });
});

describe("parseWithTesseract (post Plan 39 C5 — no-op stub)", () => {
  it("returns status='unavailable' with empty parsed block, never calls recognize", async () => {
    const out = await parseWithTesseract(
      { recognize: async () => "SHOULD NOT RUN" },
      Buffer.from([]),
    );
    expect(out.engine).toBe("tesseract");
    expect(out.status).toBe("unavailable");
    expect(out.parsed.homeScore).toBeNull();
    expect(out.parsed.awayScore).toBeNull();
    expect(out.parsed.homeStats.possessionPct).toBeNull();
  });
});
