import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/login";

/**
 * Wave 1A — End-to-end author flow per spec §1 success criteria 1-3.
 *
 *   1. Admin opens /admin/broadcast/v2/builder, clicks New Design, drops
 *      a rect + text + data-slot onto the canvas, picks an entry animation,
 *      clicks Save, and verifies the dirty indicator clears.
 *   2. After Publish, the OBS browser source at /overlay/v2/user/<slug>?demo=1
 *      renders with §14 contract markers, text content, binding attributes,
 *      and the injected animation keyframe.
 *   3. (Acceptance criterion 3 — Realtime auto-update — is covered by the
 *      sibling spec `overlay-builder-data-binding.spec.ts`. This spec asserts
 *      the static demo render contains the binding markers so the Realtime
 *      path has something to attach to.)
 *
 * Requires NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true in the env when the dev
 * server is launched (apps/web/.env.local or CI env export). The spec guards
 * itself with test.skip when the flag is absent so it does not break CI runs
 * that pre-date the Wave 1A feature flag.
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-1a.md §Task30
 *       docs/superpowers/specs/2026-05-17-overlay-builder-design.md §1, §11, §13.2
 */

test.describe("Overlay Builder Wave 1A — full author flow", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  // Captured in the test body; used by afterAll cleanup.
  let createdSlug: string | null = null;

  test.afterAll(async ({ browser }) => {
    if (!createdSlug) return;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await loginAsAdmin(page);
      await page.goto(`/admin/broadcast/v2/builder/${createdSlug}/edit`);
      // Open the design menu and attempt delete — best-effort; if the design
      // was already removed or the route 404s, we swallow the error.
      await page
        .getByTestId("builder-design-menu")
        .click()
        .catch(() => {});
      const deleteBtn = page.getByTestId("builder-delete-design");
      if (await deleteBtn.isVisible().catch(() => false)) {
        await deleteBtn.click();
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
    "admin creates → drops elements → binds data → sets animation → saves → publishes → overlay renders",
    async ({ page, context }) => {
      test.setTimeout(120_000);

      // ── Step 1: Login + open the builder library page ────────────────────
      await loginAsAdmin(page);
      await page.goto("/admin/broadcast/v2/builder");
      await expect(page.getByTestId("builder-library")).toBeVisible({
        timeout: 15_000,
      });

      // ── Step 2: Click "New Design" → fill the creation modal ─────────────
      await page.getByTestId("builder-new-design").click();
      await expect(
        page.getByTestId("builder-new-design-modal"),
      ).toBeVisible({ timeout: 10_000 });

      // Use a timestamped title so parallel runs don't collide on slugs.
      const title = `E2E Wave 1A Test ${Date.now()}`;
      await page.getByTestId("builder-new-title").fill(title);
      // Single-scene mode (not slideshow).
      await page.getByTestId("builder-new-mode-single").click();
      await page.getByTestId("builder-new-submit").click();

      // ── Step 3: Wait for redirect to the edit page ────────────────────────
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

      // ── Step 4: Toolbar → Rect tool → click canvas centre to drop ─────────
      await page.getByTestId("toolbar-tool-rect").click();
      const stage = page.getByTestId("builder-canvas-stage");
      const box = await stage.boundingBox();
      expect(box).not.toBeNull();
      // Click canvas centre.
      await page.mouse.click(
        box!.x + box!.width / 2,
        box!.y + box!.height / 2,
      );
      // Layers panel: one row now.
      await expect(
        page.getByTestId(/^builder-element-row-/),
      ).toHaveCount(1, { timeout: 8_000 });

      // ── Step 5: Toolbar → Text tool → drop above centre, set properties ───
      await page.getByTestId("toolbar-tool-text").click();
      await page.mouse.click(
        box!.x + box!.width / 2,
        box!.y + box!.height / 3,
      );
      // Layers panel: two rows.
      await expect(
        page.getByTestId(/^builder-element-row-/),
      ).toHaveCount(2, { timeout: 8_000 });

      // The newly dropped text element should be auto-selected; properties
      // panel appears.
      await expect(page.getByTestId("properties-panel")).toBeVisible({
        timeout: 8_000,
      });
      await page.getByTestId("properties-text-content").fill("Hello World");
      await page.getByTestId("properties-text-fontsize").fill("64");
      await page.getByTestId("properties-text-fontsize").press("Tab");

      // ── Step 6: Toolbar → Data Slot → pick Standings rank-1-name ──────────
      await page.getByTestId("toolbar-tool-data-slot").click();
      await expect(
        page.getByTestId("data-slot-picker-modal"),
      ).toBeVisible({ timeout: 8_000 });
      // Choose the "standings" feed.
      await page.getByTestId("data-slot-feed-standings").click();
      // Pick the rank-1-name field.
      await page.getByTestId("data-slot-field-rank-1-name").click();
      await page.getByTestId("data-slot-picker-confirm").click();
      // Layers panel: three rows.
      await expect(
        page.getByTestId(/^builder-element-row-/),
      ).toHaveCount(3, { timeout: 8_000 });

      // ── Step 7: Animation tab → Entry slide-left 600 ms ───────────────────
      // Click the first element row to select it (makes sure properties
      // panel is open for the right element).
      await page.getByTestId(/^builder-element-row-/).first().click();
      await page.getByTestId("properties-tab-animation").click();
      await page
        .getByTestId("animation-entry-type")
        .selectOption("slide-left");
      await page.getByTestId("animation-entry-duration").fill("600");
      await page.getByTestId("animation-entry-duration").press("Tab");

      // ── Step 8: Save ───────────────────────────────────────────────────────
      await page.getByTestId("builder-save").click();
      await expect(page.getByTestId("builder-save-status")).toHaveText(
        /saved/i,
        { timeout: 15_000 },
      );
      // Dirty indicator must clear after a successful save.
      await expect(
        page.getByTestId("builder-dirty-indicator"),
      ).toHaveAttribute("data-dirty", "false", { timeout: 10_000 });

      // ── Step 9: Publish ────────────────────────────────────────────────────
      await page.getByTestId("builder-publish").click();
      await expect(page.getByTestId("builder-status-badge")).toHaveText(
        /published/i,
        { timeout: 15_000 },
      );

      // ── Step 10: Open the published overlay in a new context ───────────────
      // Use a fresh context so we are not reading a stale SSR cache page.
      const overlayPage = await context.newPage();
      await overlayPage.goto(`/overlay/v2/user/${createdSlug}?demo=1`, {
        waitUntil: "domcontentloaded",
      });
      const html = await overlayPage.content();

      // §14 contract — these three markers must appear in every v2 overlay.
      expect(html).toContain("color-scheme");
      expect(html).toContain("cade-visible");
      // Transparent canvas rule — the string may appear as the CSS literal or
      // the meta tag value; either satisfies §14.
      expect(html).toMatch(/background:\s*transparent/);

      // Rect element: data-element-id attribute present somewhere in the page.
      expect(html).toMatch(/data-element-id="[a-f0-9-]+"/);

      // Text content rendered.
      expect(html).toContain("Hello World");

      // Binding attribute for the Standings data slot.
      expect(html).toContain('data-binding-feed="standings"');

      // Entry animation keyframe injected by the compiler / bootstrap script.
      // Pattern allows `slide-left-in` or `slide-left-in-<element-id>`.
      expect(html).toMatch(/@keyframes\s+slide-left-in/);

      await overlayPage.close();
    },
  );
});
