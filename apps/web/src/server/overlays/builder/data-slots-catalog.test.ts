import { describe, expect, it } from "vitest";
import { validateBinding } from "./binding-validator";
import { DATA_SLOTS_CATALOG } from "./data-slots-catalog";
import type { FeedName } from "./types";

const ALL_FEEDS: FeedName[] = [
  "standings",
  "live_score",
  "top_scorers",
  "h2h",
  "match",
  "match_day",
  "custom_text",
];

describe("DATA_SLOTS_CATALOG", () => {
  it("contains at least 25 presets", () => {
    expect(DATA_SLOTS_CATALOG.length).toBeGreaterThanOrEqual(25);
  });

  it("every preset has a unique id", () => {
    const seen = new Set<string>();
    for (const slot of DATA_SLOTS_CATALOG) {
      expect(seen.has(slot.id)).toBe(false);
      seen.add(slot.id);
    }
  });

  it("every preset's binding passes validateBinding", () => {
    for (const slot of DATA_SLOTS_CATALOG) {
      const r = validateBinding(slot.binding, ALL_FEEDS);
      if (!r.ok) {
        throw new Error(
          `Slot "${slot.id}" failed validation: ${r.errors.join("; ")}`,
        );
      }
    }
  });

  it("every preset's category matches its binding feed", () => {
    for (const slot of DATA_SLOTS_CATALOG) {
      expect(slot.binding.feed).toBe(slot.category);
    }
  });

  it("every preset's defaultElementType is text or image", () => {
    for (const slot of DATA_SLOTS_CATALOG) {
      expect(["text", "image"]).toContain(slot.defaultElementType);
    }
  });

  it("covers all 7 feed categories", () => {
    const categories = new Set(DATA_SLOTS_CATALOG.map((s) => s.category));
    expect(categories.size).toBe(7);
  });

  it("includes the canonical standings rank-1 name slot", () => {
    const slot = DATA_SLOTS_CATALOG.find((s) => s.id === "rank-1-name");
    expect(slot).toBeDefined();
    expect(slot?.binding.feed).toBe("standings");
    expect(slot?.binding.fieldPath).toBe("[0].name");
  });

  it("includes a top-scorer photo slot using image element type", () => {
    const slot = DATA_SLOTS_CATALOG.find((s) => s.id === "scorer-1-photo");
    expect(slot).toBeDefined();
    expect(slot?.defaultElementType).toBe("image");
  });
});
