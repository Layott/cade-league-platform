import { test, expect } from "@playwright/test";
import {
  seedWave1bFixtureDesign,
  type FixtureSeedResult,
} from "./helpers/seed-fixture-design";

/**
 * Wave 1B — visual-regression baseline.
 *
 * Seeded fixture exercises gradient + filter + multi-shadow + ellipse +
 * polygon + text-with-gradient. Captures a 1920x1080 screenshot at the
 * 6s mark of the demo loop; asserts <0.1% pixel diff against the
 * committed baseline.
 *
 * BASELINE NOT COMMITTED HERE — operator must run:
 *
 *   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true \
 *   npm --workspace apps/web run e2e:visual-regression \
 *     -- visual-regression-wave-1b.spec.ts --update-snapshots
 *
 * after the dev server is up and Wave 1B features are fully deployed.
 * Playwright writes the PNG to:
 *   apps/web/tests/e2e/visual-regression-wave-1b.spec.ts-snapshots/
 *     wave-1b-overlay-chromium-<platform>.png
 *
 * Inspect the PNG before committing it: confirm:
 *   - Rect with green→pink horizontal gradient, dual shadows, brightness/saturate bump.
 *   - Radial-gradient ellipse white-to-black.
 *   - Pink hexagon (polygon, sides=6).
 *   - "WAVE 1B" text in green→pink gradient ink (Agharti 128 px).
 *
 * If anything looks wrong, fix the compiler / fixture properties before
 * committing the baseline.
 *
 * Then commit the snapshot file:
 *   git add apps/web/tests/e2e/visual-regression-wave-1b.spec.ts-snapshots/
 *   git commit -m "test(overlay-builder/vr): commit wave 1B baseline PNG"
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-1b.md §Task17
 *       docs/superpowers/specs/2026-05-17-overlay-builder-design.md §13.3
 *
 * Same VR conventions as visual-regression-wave-1a.spec.ts:
 *   - 1920×1080 viewport
 *   - waitForTimeout(6000) — mid-show, entry animations settled
 *   - maxDiffPixelRatio: 0.001
 *   - animations: "disabled" (prevents flakes from in-progress CSS transitions)
 *   - fullPage: false (captures only the viewport, not scroll overflow)
 */

test.describe.serial("Overlay Builder Wave 1B — visual regression", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  let fixture: FixtureSeedResult | null = null;

  test.beforeAll(async () => {
    fixture = await seedWave1bFixtureDesign();
  });

  test.afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  test("Wave 1B fixture matches visual regression baseline", async ({
    page,
  }) => {
    if (!fixture) throw new Error("fixture not seeded — beforeAll failed");

    // Lock viewport to the canonical OBS browser-source size.
    await page.setViewportSize({ width: 1920, height: 1080 });

    await page.goto(`/overlay/v2/user/${fixture.slug}?demo=1`, {
      waitUntil: "domcontentloaded",
    });

    // Wait 6s into the demo loop so entry animations complete and the
    // overlay is fully visible. Mirrors the cadence used by
    // visual-regression-wave-1a.spec.ts (13s cycle: 7s show + 6s hide).
    await page.waitForTimeout(6_000);

    await expect(page).toHaveScreenshot("wave-1b-overlay.png", {
      maxDiffPixelRatio: 0.001,
      fullPage: false,
      animations: "disabled",
    });
  });
});
