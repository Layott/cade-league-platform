import { test, expect } from "@playwright/test";
import { seedWave3bAdvancedTimelineFixture } from "./helpers/seed-advanced-timeline-fixture";

/**
 * Wave 3B — visual regression baseline for an advanced-timeline overlay
 * captured at the midpoint of its entry animation (~50% progress).
 *
 * Fixture shape (see seed-advanced-timeline-fixture.ts):
 *   - 1 text element "WAVE 3B" (Agharti 128px white)
 *   - entry.advancedTimeline:
 *       opacity: 0 → 1   over 0..1000 ms (linear)
 *       scaleX:  0.8 → 1 over 0..1000 ms (linear)
 *
 * The spec pushes `show` via postMessage → waits for `body.cade-visible`
 * to land (entry-phase animation rule activates) → waits durationMs * 0.5
 * (≈500 ms) so every animated property has linearly interpolated to its
 * midpoint, then captures the screenshot.
 *
 * Conventions mirror visual-regression-wave-3a.spec.ts:
 *   - 1920×1080 viewport
 *   - postMessage `{type: "show"}` to trigger entry
 *   - maxDiffPixelRatio: 0.001 (≤0.1% per-pixel diff)
 *   - fullPage screenshot for layout-completeness
 *
 * BASELINE NOT COMMITTED HERE — operator regenerates after the dev
 * server is up via:
 *
 *   NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true \
 *     npm --workspace apps/web run e2e \
 *     -- visual-regression-wave-3b.spec.ts --update-snapshots
 *
 * Playwright writes the PNG to:
 *   apps/web/tests/e2e/visual-regression-wave-3b.spec.ts-snapshots/
 *     wave-3b-mid-anim-chromium-<platform>.png
 *
 * Inspect the PNG before committing it: confirm "WAVE 3B" text is
 * partially faded (~50% opacity) and visibly mid-scale (≈0.9 scaleX).
 * If render looks wrong, fix the compiler or scrub-interpolator then
 * re-capture.
 *
 * Execution deferred — Wave 3B Task 20 verification gate runs this spec
 * + commits the baseline against the live overlay route output.
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-3b.md §Task 19
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3030";

test.describe("Visual regression — Wave 3B advanced-timeline midpoint", () => {
  test("entry animation at ~50% progress matches baseline (<0.1% pixel diff)", async ({
    page,
  }) => {
    const fixture = await seedWave3bAdvancedTimelineFixture();
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${BASE_URL}/overlay/v2/user/${fixture.slug}?demo=1`, {
        waitUntil: "domcontentloaded",
      });

      // Drive the show explicitly so we don't depend on the demo loop's
      // 7s timer for first paint — yields a deterministic timeline anchor.
      await page.evaluate(() => window.postMessage({ type: "show" }, "*"));

      // Wait for the bootstrap to add cade-visible — that's the moment
      // the entry-phase animation rule starts running.
      await page.waitForFunction(
        () => document.body.classList.contains("cade-visible"),
        undefined,
        { timeout: 5_000 },
      );

      // Lock the mid-animation moment. fixture.durationMs is the entry
      // phase length (1000ms); a 500ms wait lands the linearly-interpolated
      // opacity + scaleX values at ~0.5 / ~0.9 respectively.
      await page.waitForTimeout(Math.round(fixture.durationMs * 0.5));

      expect(await page.screenshot({ fullPage: true })).toMatchSnapshot(
        "wave-3b-mid-anim.png",
        { maxDiffPixelRatio: 0.001 },
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
