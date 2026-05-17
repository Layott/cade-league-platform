import { test, expect } from "@playwright/test";
import {
  seedWave1aFixtureDesign,
  type FixtureSeedResult,
} from "./helpers/seed-fixture-design";

/**
 * Wave 1A — visual regression baseline for a 3-element user-authored overlay.
 *
 * Seeds a fixture design (rect + text "WAVE 1A" + CADE logo) via the
 * service-role Supabase client in beforeAll, then captures a 1920×1080
 * screenshot at the 6s mark of the demo loop. Compares against the committed
 * baseline PNG with maxDiffPixelRatio: 0.001 (≤0.1% pixel diff).
 *
 * BASELINE NOT COMMITTED HERE — operator must run:
 *
 *   npm --workspace apps/web run e2e:visual-regression \
 *     -- visual-regression-wave-1a.spec.ts --update-snapshots
 *
 * after the dev server is up and Wave 1A features are fully deployed.
 * Playwright writes the PNG to:
 *   apps/web/tests/e2e/visual-regression-wave-1a.spec.ts-snapshots/
 *     wave-1a-overlay-chromium-<platform>.png
 *
 * Inspect the PNG before committing it: confirm rect (green #6bcd06, 800×200),
 * text "WAVE 1A" (Agharti, white-on-green), and CADE logo (bottom-right).
 * If render looks wrong, fix the compiler then re-capture.
 *
 * Then commit the snapshot file:
 *   git add apps/web/tests/e2e/visual-regression-wave-1a.spec.ts-snapshots/
 *   git commit -m "test(overlay-builder/vr): commit wave 1A baseline PNG"
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-1a.md §Task31
 *       docs/superpowers/specs/2026-05-17-overlay-builder-design.md §13.3
 *
 * Same VR conventions as visual-regression-baseline.spec.ts:
 *   - 1920×1080 viewport
 *   - waitForTimeout(6000) — mid-show, entry animations settled
 *   - maxDiffPixelRatio: 0.001
 *   - animations: "disabled" (prevents flakes from in-progress CSS transitions)
 *   - fullPage: false (captures only the viewport, not scroll overflow)
 */

test.describe.serial("Overlay Builder Wave 1A — visual regression", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  let fixture: FixtureSeedResult | null = null;

  test.beforeAll(async () => {
    fixture = await seedWave1aFixtureDesign();
  });

  test.afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  test("user-authored overlay matches visual regression baseline", async ({
    page,
  }) => {
    if (!fixture) throw new Error("fixture not seeded — beforeAll failed");

    // Lock viewport to the canonical OBS browser-source size.
    await page.setViewportSize({ width: 1920, height: 1080 });

    await page.goto(`/overlay/v2/user/${fixture.slug}?demo=1`, {
      waitUntil: "domcontentloaded",
    });

    // Wait 6s into the demo loop so entry animations complete and the
    // overlay is fully visible. Mirror of the cadence used by
    // visual-regression-baseline.spec.ts (13s cycle: 7s show + 6s hide).
    await page.waitForTimeout(6_000);

    await expect(page).toHaveScreenshot("wave-1a-overlay.png", {
      maxDiffPixelRatio: 0.001,
      fullPage: false,
      animations: "disabled",
    });
  });
});
