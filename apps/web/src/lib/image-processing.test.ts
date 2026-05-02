import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage, recipeFor, type ImageUseCase } from "./image-processing";

/**
 * Verifies every recipe in `RECIPES` produces an image that matches
 * its declared dimensions. Uses sharp itself to (a) generate a known-
 * size source buffer and (b) read the output's metadata.
 *
 * Drift guard: if a future PR changes a recipe (e.g. partner-strip
 * 600×300 → 640×320) and forgets to update overlay CSS, this test
 * still passes (it just verifies recipe-self-consistency). The real
 * regression check is the visual-regression baseline in e2e — see
 * `apps/web/tests/e2e/visual-regression-baseline.spec.ts`.
 */

async function makeSourceBuffer(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

const ALL_USE_CASES: readonly ImageUseCase[] = [
  "partner-strip",
  "org-logo",
  "coach-photo",
  "player-photo",
  "leaderboard-corner",
];

describe("image-processing", () => {
  describe("recipeFor", () => {
    it("returns 600×300 contain for partner-strip", () => {
      const r = recipeFor("partner-strip");
      expect(r.w).toBe(600);
      expect(r.h).toBe(300);
      expect(r.fit).toBe("contain");
    });

    it("returns 800×800 contain for org-logo", () => {
      const r = recipeFor("org-logo");
      expect(r.w).toBe(800);
      expect(r.h).toBe(800);
      expect(r.fit).toBe("contain");
    });

    it("returns 512×512 cover for coach-photo + player-photo", () => {
      const c = recipeFor("coach-photo");
      const p = recipeFor("player-photo");
      expect(c.w).toBe(512);
      expect(c.h).toBe(512);
      expect(c.fit).toBe("cover");
      expect(p.w).toBe(512);
      expect(p.h).toBe(512);
      expect(p.fit).toBe("cover");
    });

    it("returns 200×200 contain for leaderboard-corner", () => {
      const r = recipeFor("leaderboard-corner");
      expect(r.w).toBe(200);
      expect(r.h).toBe(200);
      expect(r.fit).toBe("contain");
    });

    it("uses transparent background for every recipe", () => {
      for (const k of ALL_USE_CASES) {
        const r = recipeFor(k);
        expect(r.bg).toEqual({ r: 0, g: 0, b: 0, alpha: 0 });
      }
    });
  });

  describe("processImage", () => {
    it.each(ALL_USE_CASES)(
      "%s: output dimensions match recipe regardless of input size",
      async (useCase) => {
        // Feed in an oversized 1200×1200 image; recipe should clamp.
        const src = await makeSourceBuffer(1200, 1200);
        const out = await processImage(src, useCase);
        const meta = await sharp(out).metadata();
        const recipe = recipeFor(useCase);
        expect(meta.width).toBe(recipe.w);
        expect(meta.height).toBe(recipe.h);
      },
    );

    it("partner-strip: handles a wider-than-tall input via contain (no crop)", async () => {
      // 2400×600 source — extreme landscape. With `contain`, sharp
      // letterboxes it; final canvas is still 600×300.
      const src = await makeSourceBuffer(2400, 600);
      const out = await processImage(src, "partner-strip");
      const meta = await sharp(out).metadata();
      expect(meta.width).toBe(600);
      expect(meta.height).toBe(300);
    });

    it("returns a valid PNG buffer", async () => {
      const src = await makeSourceBuffer(800, 400);
      const out = await processImage(src, "partner-strip");
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("png");
    });
  });
});
