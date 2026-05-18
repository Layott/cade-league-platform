import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/login";

/**
 * Wave 3B — E2E spec for the advanced-timeline authoring flow.
 *
 * Mirrors the acceptance scenario in
 * docs/superpowers/plans/2026-05-17-overlay-builder-wave-3b.md §Task 18:
 *
 *   1. Login admin.
 *   2. Open builder library → click New Design → fill title → mode single.
 *   3. Drop a text element on the canvas.
 *   4. Click Animation tab → toggle entry to Advanced.
 *   5. Click Open Timeline → bottom panel appears.
 *   6. Add a keyframe at the midpoint of the opacity track by clicking
 *      the row's clickarea.
 *   7. Select the new keyframe + set easing to ease-out via the
 *      EasingPresetDropdown.
 *   8. Save + Publish.
 *   9. Fetch /overlay/v2/user/<slug>?demo=1 and assert the rendered
 *      HTML contains:
 *        - `@keyframes builder-<elementId>-entry` (compiler emits one
 *          uniquely-named block per (element, phase) per compiler.ts)
 *        - the `ease-out` canonical cubic-bezier(0, 0, 0.58, 1) curve
 *          (or the literal `ease-out` token — whichever the compiler
 *          ships at the time of the verification gate)
 *  10. Drive the scrub cursor in the panel to ~25% of the duration and
 *      assert the canvas element's data-canvas-element-opacity attr is
 *      ~0.25 (linear interp from 0@0ms to 0.5@500ms).
 *
 * Requires NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true at dev-server start.
 * Spec guards itself with test.skip when the flag is absent so it does
 * not break CI runs that pre-date Wave 3B.
 *
 * Execution is deferred — Wave 3B Task 20 verification gate runs the
 * spec against a live dev server. The spec is written here so the
 * builder + compiler + bootstrap surface a stable, testable contract.
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-3b.md §Task 18
 */

test.describe("Overlay Builder Wave 3B — advanced timeline E2E", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  test(
    "create design with advanced opacity keyframes + ease-out + scrub preview",
    async ({ page }) => {
      test.setTimeout(120_000);

      // ── Step 1: Login + open the builder library page ───────────────────
      await loginAsAdmin(page);
      await page.goto("/admin/broadcast/v2/builder");

      // ── Step 2: New Design modal → fill title + mode → submit ───────────
      await page.getByRole("button", { name: /new design/i }).click();
      const title = `Wave 3B E2E ${Date.now()}`;
      await page.getByLabel(/title/i).fill(title);
      await page.getByLabel(/single/i).click();
      await page.getByRole("button", { name: /create/i }).click();

      // ── Step 3: Wait for redirect to edit page + capture slug ───────────
      await page.waitForURL(
        /\/admin\/broadcast\/v2\/builder\/[^/]+\/edit$/,
        { timeout: 15_000 },
      );
      const urlMatch = page
        .url()
        .match(/\/admin\/broadcast\/v2\/builder\/([^/]+)\/edit$/);
      expect(urlMatch).not.toBeNull();
      const generatedSlug = urlMatch![1];

      // ── Step 4: Drop a text element on the canvas ───────────────────────
      await page.getByRole("button", { name: /add text|text/i }).first().click();
      const stage = page.locator("[data-testid=builder-canvas-stage]");
      const stageBox = await stage.boundingBox();
      expect(stageBox).not.toBeNull();
      await page.mouse.click(
        stageBox!.x + stageBox!.width / 2,
        stageBox!.y + stageBox!.height / 2,
      );

      // ── Step 5: Animation tab → toggle entry to Advanced ────────────────
      await page.getByRole("tab", { name: /animation/i }).click();
      const entryGroup = page.getByTestId("anim-phase-entry");
      // Enable the entry phase if not already enabled.
      const enableCheckbox = entryGroup.getByRole("checkbox", {
        name: /enable entry/i,
      });
      if (!(await enableCheckbox.isChecked())) {
        await enableCheckbox.check();
      }
      await entryGroup.getByRole("button", { name: /^advanced$/i }).click();

      // ── Step 6: Open the bottom timeline panel ──────────────────────────
      await page.getByRole("button", { name: /open timeline/i }).click();
      await expect(page.getByTestId("timeline-panel")).toBeVisible();

      // ── Step 7: Add a keyframe at the midpoint of the opacity track ─────
      const clickArea = page.getByTestId("track-row-opacity-clickarea");
      const box = await clickArea.boundingBox();
      expect(box).not.toBeNull();
      const midX = box!.x + box!.width / 2;
      await page.mouse.click(midX, box!.y + box!.height / 2);

      // ── Step 8: Select the new keyframe + set value 0.5 + ease-out ──────
      const inspector = page.getByTestId("keyframe-inspector");
      await expect(inspector).toBeVisible();
      const valueInput = inspector.getByTestId("keyframe-inspector-value-input");
      await valueInput.fill("0.5");
      await valueInput.press("Tab");

      const easingDropdown = page.getByTestId("easing-preset-dropdown");
      await easingDropdown.selectOption("ease-out");

      // ── Step 9: Save + Publish ──────────────────────────────────────────
      await page.getByRole("button", { name: /^save$/i }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^publish$/i }).click();
      await page.waitForTimeout(500);

      // ── Step 10: Fetch the rendered overlay and assert compiled output ──
      const resp = await page.request.get(
        `/overlay/v2/user/${generatedSlug}?demo=1`,
      );
      expect(resp.status()).toBe(200);
      const html = await resp.text();

      // §14 contract sanity — every v2 overlay carries these markers.
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("cade-visible");

      // Wave 3B compiler emits one uniquely-named @keyframes per
      // (element, phase) for advanced-timeline animations. The element
      // id is unknown to the spec, so we match the pattern.
      expect(html).toMatch(/@keyframes\s+builder-[a-f0-9-]+-entry/);

      // Ease-out canonical curve. The compiler currently emits the
      // literal `ease-out` CSS token; the assertion accepts either the
      // literal or its canonical cubic-bezier expansion so the spec
      // stays green across either timing-function emission strategy.
      expect(html).toMatch(/ease-out|cubic-bezier\(0,\s*0,\s*0\.58,\s*1\)/);

      // ── Step 11: Scrub preview — drive cursor to ~25% + assert opacity ──
      const ruler = page.getByTestId("timeline-ruler");
      const rulerBox = await ruler.boundingBox();
      expect(rulerBox).not.toBeNull();
      // 25% of the default 1000ms entry duration after toggling Advanced.
      const targetX = rulerBox!.x + rulerBox!.width * 0.25;
      await page.mouse.click(targetX, rulerBox!.y + rulerBox!.height / 2);

      // CanvasStage exposes data-canvas-element-opacity on its rendered
      // element nodes when scrub-preview is active. Linear interp from
      // 0@0ms to 0.5@500ms — at 250ms the live opacity should be ~0.25.
      const canvasNode = page.locator("[data-canvas-element-opacity]").first();
      const opacityAttr = await canvasNode.getAttribute(
        "data-canvas-element-opacity",
      );
      expect(opacityAttr).not.toBeNull();
      const opacityNum = Number(opacityAttr);
      expect(opacityNum).toBeGreaterThan(0.2);
      expect(opacityNum).toBeLessThan(0.32);
    },
  );
});
