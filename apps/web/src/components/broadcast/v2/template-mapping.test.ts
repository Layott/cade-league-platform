import { describe, it, expect } from "vitest";
import { V2_TO_LEGACY_TEMPLATE, v2ToLegacy } from "./template-mapping";
import { V2_OVERLAY_KEYS } from "./overlay-keys";
import { TEMPLATE_KEYS } from "@/server/overlays/registry";

describe("V2_TO_LEGACY_TEMPLATE", () => {
  it("covers every v2 overlay key", () => {
    for (const k of V2_OVERLAY_KEYS) {
      expect(V2_TO_LEGACY_TEMPLATE[k]).toBeTruthy();
    }
  });

  it("every mapped legacy key is registered in the overlay registry", () => {
    const legacyKeys = new Set(TEMPLATE_KEYS as readonly string[]);
    for (const k of V2_OVERLAY_KEYS) {
      const legacy = V2_TO_LEGACY_TEMPLATE[k];
      expect(legacyKeys.has(legacy)).toBe(true);
    }
  });

  it("08-lower-third maps to multi-instance lower_third", () => {
    expect(v2ToLegacy("08-lower-third")).toBe("lower_third");
  });

  it("09-secondary-score-bug maps to score_bug", () => {
    expect(v2ToLegacy("09-secondary-score-bug")).toBe("score_bug");
  });

  it("01-brb maps to layout_brb_basic (no ad slot)", () => {
    expect(v2ToLegacy("01-brb")).toBe("layout_brb_basic");
  });

  it("12-starting-soon maps to starting_soon_basic", () => {
    expect(v2ToLegacy("12-starting-soon")).toBe("starting_soon_basic");
  });
});
