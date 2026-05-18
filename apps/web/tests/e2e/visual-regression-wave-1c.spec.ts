import { test, expect } from "@playwright/test";
import {
  seedWave1cFixtureDesign,
  type FixtureSeedResult,
} from "./helpers/seed-fixture-design";

/**
 * Wave 1C — visual-regression baseline.
 *
 * Seeds a 2-scene fixture via seedWave1cFixtureDesign():
 *
 *   Scene 1 — Path scene:
 *     - Closed cubic-Bézier triangle (fill #6bcd06, stroke #ffffff 4 px).
 *
 *   Scene 2 — Group scene:
 *     - Group container holding a pink rect (#fe036d) and
 *       "WAVE 1C" text (Agharti 96 px, white).
 *
 * Each scene is captured as a separate screenshot at the 6 s mark of the
 * demo loop; both assert <0.1% pixel diff against committed baselines.
 *
 * BASELINES NOT COMMITTED HERE — operator must run once on a green local run:
 *
 *   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true \
 *   npm --workspace apps/web run e2e \
 *     -- visual-regression-wave-1c.spec.ts --update-snapshots
 *
 * Playwright writes PNGs to:
 *   apps/web/tests/e2e/visual-regression-wave-1c.spec.ts-snapshots/
 *     wave-1c-path-scene-chromium-<platform>.png
 *     wave-1c-group-scene-chromium-<platform>.png
 *
 * Inspect each PNG before committing:
 *   - path scene:  green cubic-Bézier triangle, white stroke, dark background.
 *   - group scene: full-width pink rect (#fe036d) with "WAVE 1C" white Agharti
 *                  text centred over it.
 *
 * If render looks wrong, fix the compiler / fixture then re-capture.
 *
 * Then commit the snapshot files:
 *   git add apps/web/tests/e2e/visual-regression-wave-1c.spec.ts-snapshots/
 *   git commit -m "test(overlay-builder/vr): commit wave 1C baseline PNGs"
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-1c.md §Task16
 *       docs/superpowers/specs/2026-05-17-overlay-builder-design.md §13.3
 *
 * Same VR conventions as visual-regression-wave-1a.spec.ts /
 * visual-regression-wave-1b.spec.ts:
 *   - 1920×1080 viewport
 *   - waitForTimeout(6000) — mid-show, entry animations settled
 *   - maxDiffPixelRatio: 0.001
 *   - animations: "disabled" (prevents flakes from in-progress CSS transitions)
 *   - fullPage: false (captures only the viewport, not scroll overflow)
 *
 * NOTE: Baseline capture is deferred to Task 17 (full verification gate).
 * This commit ships the spec + fixture seed only; no snapshot files are
 * included. T17 will run --update-snapshots and commit the PNGs.
 */

test.describe.serial("Overlay Builder Wave 1C — visual regression", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  let fixture: FixtureSeedResult | null = null;

  test.beforeAll(async () => {
    fixture = await seedWave1cFixtureDesign();
  });

  test.afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  test("Wave 1C path scene matches visual regression baseline", async ({
    page,
  }) => {
    if (!fixture) throw new Error("fixture not seeded — beforeAll failed");

    // Lock viewport to the canonical OBS browser-source size.
    await page.setViewportSize({ width: 1920, height: 1080 });

    // ?scene=0 pins the slideshow to the path scene so the screenshot is
    // deterministic. Falls back to scene 0 (path) on the first demo loop
    // cycle even without the param.
    await page.goto(`/overlay/v2/user/${fixture.slug}?demo=1&scene=0`, {
      waitUntil: "domcontentloaded",
    });

    // Wait 6s so entry animations complete and the overlay is fully visible.
    // Mirrors the cadence used by visual-regression-wave-1a.spec.ts.
    await page.waitForTimeout(6_000);

    await expect(page).toHaveScreenshot("wave-1c-path-scene.png", {
      maxDiffPixelRatio: 0.001,
      fullPage: false,
      animations: "disabled",
    });
  });

  test("Wave 1C group scene matches visual regression baseline", async ({
    page,
  }) => {
    if (!fixture) throw new Error("fixture not seeded — beforeAll failed");

    // Lock viewport to the canonical OBS browser-source size.
    await page.setViewportSize({ width: 1920, height: 1080 });

    // ?scene=1 pins the slideshow to the group scene.
    await page.goto(`/overlay/v2/user/${fixture.slug}?demo=1&scene=1`, {
      waitUntil: "domcontentloaded",
    });

    // Wait 6s so entry animations complete.
    await page.waitForTimeout(6_000);

    await expect(page).toHaveScreenshot("wave-1c-group-scene.png", {
      maxDiffPixelRatio: 0.001,
      fullPage: false,
      animations: "disabled",
    });
  });
});
