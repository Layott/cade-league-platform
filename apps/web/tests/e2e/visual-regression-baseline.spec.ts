import { test, expect } from "@playwright/test";

/**
 * Wave 2 Stage 4 — Visual regression baseline + diff for all 16 v2
 * overlays.
 *
 * Renders each overlay at `?demo=1` and captures a 1920×1080 screenshot
 * at the 6s mark of the demo loop. First run creates the baseline PNG
 * under `__screenshots__/`; subsequent runs compare against it with
 * `maxDiffPixelRatio: 0.001` (≤0.1% per-pixel difference) and fail if
 * the threshold is exceeded.
 *
 * This is the load-bearing CI gate for backward-compat invariant #1
 * — every PR that edits overlay HTML must clear it.
 *
 * Run with:
 *   npm run e2e:visual-regression
 *
 * Update baseline (after intentional design changes):
 *   npx playwright test visual-regression-baseline.spec.ts
 *     --update-snapshots --project=chromium
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §11
 */

const OVERLAY_KEYS = [
  "01-brb",
  "02-timer",
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "08-lower-third",
  "09-secondary-score-bug",
  "10-up-next-bug",
  "11-match-scores-day",
  "12-starting-soon",
  "13-stream-ended",
  "14-top-scorers",
  "15-orgs",
  "16-coaches",
  "17-penalties",
];

test.describe("Overlay v2 — visual regression baseline (Wave 2 Stage 4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  for (const key of OVERLAY_KEYS) {
    test(`${key} matches baseline`, async ({ page }) => {
      // Static-HTML route (no SSR token + no design overrides) so the
      // baseline stays stable across DB changes and reflects the
      // canonical HTML defaults only.
      await page.goto(`/overlays/v2/${key}/index.html?demo=1`, {
        waitUntil: "domcontentloaded",
      });

      // Sample at the 6s mark of the demo loop so transitions settle.
      // Demo cycle is 13s (per CLAUDE.md §14): show 7s + hide 6s.
      // 6s is mid-show, all entry animations completed.
      await page.waitForTimeout(6000);

      // Compare full page (1920×1080) against baseline.
      await expect(page).toHaveScreenshot(`${key}-default.png`, {
        maxDiffPixelRatio: 0.001,
        fullPage: false,
        animations: "disabled",
      });
    });
  }
});
