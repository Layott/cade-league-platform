import { describe, it, expect } from "vitest";
import {
  V2_TO_LEGACY_TEMPLATE,
  v2ToLegacy,
  COVER_UP_PAYLOADS,
  getCoverUpPayload,
} from "./template-mapping";
import { V2_OVERLAY_KEYS } from "./overlay-keys";
import { TEMPLATE_KEYS, TEMPLATE_REGISTRY } from "@/server/overlays/registry";

const COVER_UP_KEYS = [
  "21-streaks",
  "22-power-rankings",
  "23-org-standings",
  "24-biggest-margins",
  "25-did-you-know",
  "26-card-meta",
  "27-schedule",
  "28-punditry",
  "29-goalfests",
] as const;

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

describe("COVER_UP_PAYLOADS — Zod gates", () => {
  it("defines a payload for every cover-up overlay key", () => {
    for (const k of COVER_UP_KEYS) {
      expect(COVER_UP_PAYLOADS[k]).toBeTruthy();
    }
  });

  it("getCoverUpPayload returns valid JSON for every cover-up key", () => {
    for (const k of COVER_UP_KEYS) {
      const raw = getCoverUpPayload(k);
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  it("each cover-up payload satisfies its mapped legacy Zod schema", () => {
    for (const k of COVER_UP_KEYS) {
      const legacy = v2ToLegacy(k);
      const schema = TEMPLATE_REGISTRY[legacy].schema;
      const parsed = JSON.parse(getCoverUpPayload(k));
      expect(() => schema.parse(parsed)).not.toThrow();
    }
  });
});
