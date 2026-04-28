import { describe, it, expect } from "vitest";
import {
  BRAND_ACCENT,
  BRAND_BG,
  BRAND_TEXT,
  FONT_VALUES,
  OVERLAY_KEYS,
  PATTERN_VALUES,
  REQUIRED_DEFAULT_KEYS,
  TOKEN_CATALOG,
  TOKEN_CATALOG_BY_KEY,
  getDefaultsForOverlay,
  isOverlayKey,
} from "./defaults";

describe("token catalog", () => {
  it("exposes all required token keys with a typed entry", () => {
    for (const key of REQUIRED_DEFAULT_KEYS) {
      expect(TOKEN_CATALOG_BY_KEY[key]).toBeDefined();
      expect(TOKEN_CATALOG_BY_KEY[key].label.length).toBeGreaterThan(0);
    }
  });

  it("each catalog entry has a valid token_type", () => {
    const VALID = new Set([
      "color",
      "font",
      "number",
      "boolean",
      "enum",
      "string",
    ]);
    for (const e of TOKEN_CATALOG) {
      expect(VALID.has(e.tokenType)).toBe(true);
    }
  });

  it("FONT_VALUES + PATTERN_VALUES are non-empty", () => {
    expect(FONT_VALUES.length).toBeGreaterThan(0);
    expect(PATTERN_VALUES).toContain("none");
  });
});

describe("getDefaultsForOverlay", () => {
  it("every overlay key in OVERLAY_KEYS has all REQUIRED_DEFAULT_KEYS", () => {
    for (const key of OVERLAY_KEYS) {
      const d = getDefaultsForOverlay(key);
      for (const required of REQUIRED_DEFAULT_KEYS) {
        expect(
          d[required],
          `overlay ${key} missing required token "${required}"`,
        ).toBeDefined();
      }
    }
  });

  it("uses brand palette for the bg/accent/text baseline", () => {
    const d = getDefaultsForOverlay("01-brb");
    expect(d["bg-color"]).toBe(BRAND_BG);
    expect(d["accent-color"]).toBe(BRAND_ACCENT);
    expect(d["text-color"]).toBe(BRAND_TEXT);
  });

  it("returns Agharti as the default display font", () => {
    const d = getDefaultsForOverlay("07-leaderboard");
    expect(d["font-display"]).toBe("Agharti");
    expect(FONT_VALUES).toContain(d["font-display"]);
  });

  it("applies per-overlay overrides on top of base defaults", () => {
    // 07-leaderboard overrides row-highlight-count to "3" and pattern to halftone.
    const d = getDefaultsForOverlay("07-leaderboard");
    expect(d["row-highlight-count"]).toBe("3");
    expect(d.pattern).toBe("halftone");
    // 09-secondary-score-bug hides the partner strip.
    const sb = getDefaultsForOverlay("09-secondary-score-bug");
    expect(sb["partner-strip-show"]).toBe("false");
  });

  it("unknown overlay key returns the bare BASE_DEFAULTS without throwing", () => {
    const d = getDefaultsForOverlay("99-not-a-real-key");
    expect(d["bg-color"]).toBe(BRAND_BG);
    expect(d["accent-color"]).toBe(BRAND_ACCENT);
  });

  it("returns a fresh object on each call (caller can mutate)", () => {
    const a = getDefaultsForOverlay("01-brb");
    a["bg-color"] = "#f00";
    const b = getDefaultsForOverlay("01-brb");
    expect(b["bg-color"]).toBe(BRAND_BG);
  });
});

describe("isOverlayKey", () => {
  it("recognizes seeded overlay keys", () => {
    expect(isOverlayKey("07-leaderboard")).toBe(true);
    expect(isOverlayKey("01-brb")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isOverlayKey("not-real")).toBe(false);
    expect(isOverlayKey("")).toBe(false);
  });
});
