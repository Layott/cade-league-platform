import { describe, it, expect } from "vitest";
import {
  SOCIAL_TEMPLATES,
  getTemplate,
  listActiveTemplates,
  type TemplateKey,
} from "./templates";

describe("social/templates", () => {
  describe("getTemplate", () => {
    it("returns expected shape for 'leaderboard'", () => {
      const t = getTemplate("leaderboard");
      expect(t.templateKey).toBe("leaderboard");
      expect(t.label).toBe("Weekly Leaderboard");
      expect(t.format).toBe("both");
      expect(t.dataEndpoint).toBe(
        "/api/broadcast/sessions/{sessionId}/leaderboard",
      );
      expect(t.supportedSizes).toContain("1080x1920");
      expect(t.supportedSizes).toContain("1080x1080");
      expect(t.supportedSizes).toContain("1200x675");
      expect(t.scenePath).toMatch(/v2\/07-leaderboard\/index\.html$/);
      expect(typeof t.sortOrder).toBe("number");
    });

    it("returns expected shape for 'top-scorers'", () => {
      const t = getTemplate("top-scorers");
      expect(t.templateKey).toBe("top-scorers");
      expect(t.format).toBe("both");
      expect(t.supportedSizes).toEqual(["1080x1920", "1080x1080"]);
    });

    it("returns expected shape for 'upcoming-fixtures'", () => {
      const t = getTemplate("upcoming-fixtures");
      expect(t.format).toBe("image");
      expect(t.scenePath).toBeNull();
    });

    it("returns expected shape for 'gd-leaders'", () => {
      const t = getTemplate("gd-leaders");
      expect(t.format).toBe("image");
      expect(t.supportedSizes).toEqual(["1080x1080"]);
    });

    it("returns expected shape for 'league-avg'", () => {
      const t = getTemplate("league-avg");
      expect(t.format).toBe("image");
      expect(t.supportedSizes).toEqual(["1080x1080"]);
    });

    it("throws on an unknown key", () => {
      expect(() => getTemplate("nonexistent" as TemplateKey)).toThrow(
        /Unknown social template key/,
      );
    });
  });

  describe("listActiveTemplates", () => {
    it("returns all 5 entries sorted by sortOrder ascending", () => {
      const list = listActiveTemplates();
      expect(list).toHaveLength(5);
      // sortOrder ascending
      for (let i = 1; i < list.length; i++) {
        expect(list[i].sortOrder).toBeGreaterThan(list[i - 1].sortOrder);
      }
      // All 5 known keys are present.
      const keys = list.map((t) => t.templateKey);
      expect(keys).toEqual([
        "leaderboard",
        "top-scorers",
        "upcoming-fixtures",
        "gd-leaders",
        "league-avg",
      ]);
    });

    it("returns a fresh array (caller-mutation safe)", () => {
      const a = listActiveTemplates();
      const b = listActiveTemplates();
      expect(a).not.toBe(b);
      // mutating the returned array doesn't affect the registry
      (a as unknown as { length: number }).length = 0;
      expect(listActiveTemplates()).toHaveLength(5);
    });
  });

  describe("SOCIAL_TEMPLATES catalog", () => {
    it("has unique templateKeys", () => {
      const keys = SOCIAL_TEMPLATES.map((t) => t.templateKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("has unique sortOrders", () => {
      const orders = SOCIAL_TEMPLATES.map((t) => t.sortOrder);
      expect(new Set(orders).size).toBe(orders.length);
    });

    it("every entry has at least one supported size", () => {
      for (const t of SOCIAL_TEMPLATES) {
        expect(t.supportedSizes.length).toBeGreaterThan(0);
      }
    });

    it("video-capable entries have a non-null scenePath", () => {
      for (const t of SOCIAL_TEMPLATES) {
        if (t.format === "video" || t.format === "both") {
          expect(t.scenePath).not.toBeNull();
        }
      }
    });
  });
});
