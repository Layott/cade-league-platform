import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/login";

/**
 * Wave 1B — End-to-end author flow.
 *
 * Exercises every Wave 1B feature in one spec:
 *   - drop ellipse / line / polygon shapes
 *   - apply linear gradient + multi-shadow + filter to a rect
 *   - bind a text element via the manual ManualBindEditor
 *   - confirm published overlay HTML contains:
 *     - linear-gradient(...) CSS
 *     - box-shadow: with two entries
 *     - filter: rule
 *     - border-radius: 50% (ellipse)
 *     - clip-path: polygon(...) (polygon)
 *     - data-binding-feed="standings"
 *
 * Snap behavior is asserted in a sibling unit test
 * (use-alignment-guides.test.ts); driving snap via Playwright is flaky
 * because Konva drag-move events fire faster than Playwright's mouse
 * dispatch.
 *
 * Toolbar buttons are located via aria-label (the ToolButton component in
 * Toolbar.tsx renders each button with aria-label={label} and title={label};
 * no data-testid is present on the Wave 1B toolbar).
 *
 * Requires NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §11 row 2
 */

test.describe("Overlay Builder Wave 1B — author flow", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  let createdSlug: string | null = null;

  test.afterAll(async ({ browser }) => {
    if (!createdSlug) return;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await loginAsAdmin(page);
      await page.goto(`/admin/broadcast/v2/builder/${createdSlug}/edit`);
      await page
        .getByTestId("builder-design-menu")
        .click({ trial: false })
        .catch(() => {});
      const delBtn = page.getByTestId("builder-delete-design");
      if (await delBtn.isVisible().catch(() => false)) {
        await delBtn.click();
        await page
          .getByTestId("builder-confirm-delete")
          .click()
          .catch(() => {});
      }
    } finally {
      await ctx.close();
    }
  });

  test(
    "drops ellipse + line + polygon, applies gradient + multi-shadow + filter, manual binds text, publishes, renders",
    async ({ page, context }) => {
      test.setTimeout(180_000);

      // ── Step 1: Login + new design ────────────────────────────────────────
      await loginAsAdmin(page);
      await page.goto("/admin/broadcast/v2/builder");
      await expect(page.getByTestId("builder-library")).toBeVisible({
        timeout: 15_000,
      });

      await page.getByTestId("builder-new-design").click();
      await expect(
        page.getByTestId("builder-new-design-modal"),
      ).toBeVisible({ timeout: 10_000 });

      const title = `E2E Wave 1B ${Date.now()}`;
      await page.getByTestId("builder-new-title").fill(title);
      await page.getByTestId("builder-new-mode-single").click();
      await page.getByTestId("builder-new-submit").click();

      await page.waitForURL(
        /\/admin\/broadcast\/v2\/builder\/[^/]+\/edit$/,
        { timeout: 15_000 },
      );
      const urlMatch = page
        .url()
        .match(/\/admin\/broadcast\/v2\/builder\/([^/]+)\/edit$/);
      expect(urlMatch).not.toBeNull();
      createdSlug = urlMatch![1];

      await expect(page.getByTestId("builder-canvas-stage")).toBeVisible({
        timeout: 10_000,
      });

      const stage = page.getByTestId("builder-canvas-stage");
      const box = await stage.boundingBox();
      expect(box).not.toBeNull();

      function canvasClick(x: number, y: number) {
        return page.mouse.click(box!.x + x, box!.y + y);
      }

      // ── Step 2: Drop ellipse / line / polygon via toolbar ─────────────────
      // Toolbar renders buttons with aria-label matching the tool name.
      await page.getByRole("button", { name: /^ellipse$/i }).click();
      await canvasClick(200, 200);

      await page.getByRole("button", { name: /^line$/i }).click();
      await canvasClick(200, 400);

      await page.getByRole("button", { name: /^polygon$/i }).click();
      await canvasClick(400, 400);

      await expect(
        page.getByTestId(/^builder-element-row-/),
      ).toHaveCount(3, { timeout: 8_000 });

      // ── Step 3: Insert a rect + apply gradient + multi-shadow + filter ─────
      await page.getByRole("button", { name: /^rect$/i }).click();
      await canvasClick(700, 200);
      await expect(
        page.getByTestId(/^builder-element-row-/),
      ).toHaveCount(4, { timeout: 8_000 });

      // Select the newly-dropped rect.
      await page.getByTestId(/^builder-element-row-/).last().click();

      // Gradient — pick Linear via radio in GradientEditor.
      // The radio has aria-label="linear" (lowercase) per GradientEditor.tsx.
      await page.getByLabel(/^linear$/i).click();

      // Filter — blur slider has aria-label="Blur".
      const blurSlider = page.getByRole("slider", { name: /^blur$/i });
      await blurSlider.fill("4");

      // Shadow — "Add shadow (0/8)" button; pattern matches partial text.
      // Click twice to create two shadow entries.
      await page.getByRole("button", { name: /add shadow/i }).click();
      await page.getByRole("button", { name: /add shadow/i }).click();

      // ── Step 4: Drop a text element + manual bind via the editor ──────────
      await page.getByRole("button", { name: /^text$/i }).click();
      await canvasClick(500, 600);
      await expect(
        page.getByTestId(/^builder-element-row-/),
      ).toHaveCount(5, { timeout: 8_000 });

      // Select the new text element.
      await page.getByTestId(/^builder-element-row-/).last().click();

      // Binding tab — rendered as role="tab" with text "binding".
      await page.getByRole("tab", { name: /^binding$/i }).click();

      // ManualBindEditor renders a <select aria-label="Feed"> and
      // <input aria-label="Field path">.
      await page.getByLabel(/^feed$/i).selectOption("standings");
      await page.getByLabel(/^field path$/i).fill("[0].name");

      // ── Step 5: Save ───────────────────────────────────────────────────────
      await page.getByTestId("builder-save").click();
      await expect(page.getByTestId("builder-save-status")).toHaveText(
        /saved/i,
        { timeout: 15_000 },
      );
      await expect(
        page.getByTestId("builder-dirty-indicator"),
      ).toHaveAttribute("data-dirty", "false", { timeout: 10_000 });

      // ── Step 6: Publish ────────────────────────────────────────────────────
      await page.getByTestId("builder-publish").click();
      await expect(page.getByTestId("builder-status-badge")).toHaveText(
        /published/i,
        { timeout: 15_000 },
      );

      // ── Step 7: Open published overlay + assert CSS markers ───────────────
      const overlayPage = await context.newPage();
      await overlayPage.goto(`/overlay/v2/user/${createdSlug}?demo=1`, {
        waitUntil: "domcontentloaded",
      });
      const html = await overlayPage.content();

      // §14 contract markers — must appear in every v2 overlay.
      expect(html).toContain("color-scheme");
      expect(html).toContain("cade-visible");
      expect(html).toMatch(/background:\s*transparent/);

      // Wave 1B markers:
      // Linear gradient on the rect.
      expect(html).toMatch(/background:\s*linear-gradient\(/);
      // Multi-shadow: two entries separated by a comma.
      expect(html).toMatch(/box-shadow:\s*[^;]+,\s*[^;]+/);
      // Filter blur.
      expect(html).toMatch(/filter:\s*blur\(/);
      // Ellipse: border-radius 50%.
      expect(html).toMatch(/border-radius:\s*50%/);
      // Polygon: clip-path polygon().
      expect(html).toMatch(/clip-path:\s*polygon\(/);
      // Manual bind: data-binding-feed attribute.
      expect(html).toContain('data-binding-feed="standings"');

      await overlayPage.close();
    },
  );
});
