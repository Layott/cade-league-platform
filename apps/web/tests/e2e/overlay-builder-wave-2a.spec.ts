import { test, expect } from "@playwright/test";
import path from "node:path";
import { loginAsAdmin } from "./helpers/login";

/**
 * Wave 2A E2E — upload a PSD, place its first layer onto the canvas,
 * save, publish, then verify the published overlay route renders the
 * placed element.
 *
 * Three scenarios:
 *   1. Upload PSD via the /assets page — assert parsing indicator,
 *      final card with filename and layer count.
 *   2. Create design → toolbar Image → From PSD → pick uploaded PSD →
 *      place layer → save → publish → open /overlay/v2/user/<slug>
 *      and assert the compiled HTML contains an <img> element.
 *   3. Upload a non-PSD file (.png) shows the "Expected .psd" error.
 *
 * Selector strategy:
 *   - Asset page: data-testid="psd-dropzone" (drop zone wrapper),
 *     hidden file input via `input[type="file"][accept*=".psd"]`.
 *   - Builder library / modal: builder-new-design, builder-new-design-modal,
 *     builder-new-title, builder-new-mode-single, builder-new-submit.
 *   - Toolbar: aria-label="Image" (split-button), then role="menuitem" for
 *     "From PSD".
 *   - PSD drawer: role="dialog" aria-label="Place PSD". Layer buttons have
 *     aria-label=`Place: <layer-name>`.
 *   - Layers panel: aria-label="Layers" section.
 *   - Save / Publish: TopBar button text ("Save", "Saving…", "Publish",
 *     "Unpublish"). Status span shows design.status text.
 *
 * Requires NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true in the env when the dev
 * server is launched. The spec guards itself with test.skip when absent.
 *
 * DO NOT run against a live server for E2E until Task 10 verification pass.
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-2a.md §Task9
 */

const FIXTURE_PSD = path.resolve(__dirname, "fixtures", "wave-2a-tiny.psd");

test.describe("Overlay Builder — Wave 2A PSD pipeline", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Login + navigate to the builder library, click New Design, fill a
   * timestamped title, and submit. Waits for the edit URL.
   * Returns the slug extracted from the URL so callers can clean up.
   */
  async function createNewDesign(
    page: import("@playwright/test").Page,
    titlePrefix: string,
  ): Promise<string> {
    await loginAsAdmin(page);
    await page.goto("/admin/broadcast/v2/builder");
    await expect(page.getByTestId("builder-library")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("builder-new-design").click();
    await expect(
      page.getByTestId("builder-new-design-modal"),
    ).toBeVisible({ timeout: 10_000 });

    const title = `${titlePrefix} ${Date.now()}`;
    await page.getByTestId("builder-new-title").fill(title);
    await page.getByTestId("builder-new-mode-single").click();
    await page.getByTestId("builder-new-submit").click();

    await page.waitForURL(
      /\/admin\/broadcast\/v2\/builder\/[^/]+\/edit$/,
      { timeout: 15_000 },
    );
    const m = page
      .url()
      .match(/\/admin\/broadcast\/v2\/builder\/([^/]+)\/edit$/);
    if (!m) throw new Error("Could not extract slug from URL");
    return m[1];
  }

  // ── Test 1: Upload PSD via assets page ───────────────────────────────────

  test("upload PSD via /assets page; listing shows filename and layer count", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await loginAsAdmin(page);
    await page.goto("/admin/broadcast/v2/builder/assets");
    await expect(
      page.getByRole("heading", { name: /Asset Library/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The file input is hidden inside the PSDs section; Playwright's
    // setInputFiles works on hidden inputs without needing to click them.
    const fileInput = page.locator(
      'input[type="file"][accept*=".psd"]',
    );
    await fileInput.setInputFiles(FIXTURE_PSD);

    // Drop zone shows "Parsing PSD…" while the action is in-flight.
    await expect(
      page.getByTestId("psd-dropzone").getByText(/Parsing PSD/i),
    ).toBeVisible({ timeout: 10_000 });

    // After the action resolves, the listing shows the filename and layer count.
    // The tiny.psd fixture has 2 layers.
    await expect(page.getByText("wave-2a-tiny.psd")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/2 layers/i)).toBeVisible({ timeout: 10_000 });
  });

  // ── Test 2: Place PSD layer → save → publish → render ────────────────────

  test("place PSD layer → save → publish → overlay route renders an <img>", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    // 1. Create a fresh design.
    const slug = await createNewDesign(page, "Wave 2A PSD E2E");

    await expect(page.getByTestId("builder-canvas-stage")).toBeVisible({
      timeout: 10_000,
    });

    // 2. Open the Image split-button and click "From PSD".
    await page.getByRole("button", { name: /^Image$/i }).click();
    await expect(
      page.getByRole("menu"),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole("menuitem", { name: /From PSD/i }).click();

    // 3. The PsdPlaceDrawer opens.
    const drawer = page.getByRole("dialog", { name: /Place PSD/i });
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // 4. Wait for PSDs to load (the drawer calls listPsdsAction on open).
    //    If the asset from Test 1 is not yet in the DB (tests run in separate
    //    browsers / contexts), re-upload here via setInputFiles won't apply —
    //    so we check that at least one PSD row is visible, or skip gracefully.
    //    In practice: this test depends on Test 1 having uploaded wave-2a-tiny.psd
    //    to the same DB first. Tests run sequentially (Playwright serial default).
    await expect(
      drawer.getByText("wave-2a-tiny.psd"),
    ).toBeVisible({ timeout: 30_000 });

    // 5. Click the PSD row to expand its layers.
    await drawer.getByText("wave-2a-tiny.psd").click();

    // 6. Place layer 1 (the first non-hidden layer of the tiny.psd fixture).
    //    Layer buttons have aria-label="Place: <name>" where <name> is the
    //    layer name as authored in Photoshop. For the fixture the names vary
    //    by ag-psd render — use a partial match.
    await expect(
      drawer.getByRole("button", { name: /^Place:/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole("button", { name: /^Place:/i }).first().click();

    // 7. Drawer closes after a successful place.
    await expect(drawer).toBeHidden({ timeout: 10_000 });

    // 8. Layers panel (aria-label="Layers") now shows 1 element.
    //    The header text reads "Layers (1) ▾" when collapsed=false.
    const layersPanel = page.getByRole("region", { name: "Layers" });
    await expect(layersPanel).toBeVisible({ timeout: 8_000 });
    await expect(layersPanel.getByRole("listitem")).toHaveCount(1, {
      timeout: 8_000,
    });

    // 9. Save — the Save button is enabled only when the store is dirty.
    //    addElement marks dirty, so Save should be clickable now.
    const saveBtn = page.getByRole("button", { name: /^Save$/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    // Save transitions button to "Saving…" then back to "Save" (no toast).
    await expect(page.getByRole("button", { name: /^Save$/i })).toBeVisible({
      timeout: 15_000,
    });

    // 10. Publish.
    const publishBtn = page.getByRole("button", { name: /^Publish$/i });
    await expect(publishBtn).toBeEnabled({ timeout: 5_000 });
    await publishBtn.click();

    // After publish the button switches to "Unpublish" and the status span
    // shows "published".
    await expect(
      page.getByRole("button", { name: /^Unpublish$/i }),
    ).toBeVisible({ timeout: 15_000 });

    // 11. Open the compiled overlay route in a new tab.
    //     The route is /overlay/v2/user/<slug>?demo=1.
    //     Published design → no previewToken needed.
    const overlayUrl = `/overlay/v2/user/${slug}?demo=1`;
    const overlayPage = await context.newPage();
    await overlayPage.goto(overlayUrl);

    // The response is raw HTML (not a Next.js page); wait for the DOM to settle.
    await overlayPage.waitForLoadState("networkidle", { timeout: 15_000 });

    // The compiler emits <img data-element-img src="..." alt=""> for image
    // elements. The src is either a /overlay-user-assets/ path (when
    // asset_path is resolved on save) or a 1x1 SVG placeholder (when the
    // asset resolution pipeline hasn't run yet).
    //
    // We assert that at least one <img data-element-img> is present — this
    // confirms the image element was compiled into the HTML, regardless of
    // whether the storage path is resolved yet.
    await expect(
      overlayPage.locator("[data-element-img]"),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Test 3: Non-PSD upload shows bad_extension error ─────────────────────

  test("uploading a non-PSD file shows the Expected .psd error", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await loginAsAdmin(page);
    await page.goto("/admin/broadcast/v2/builder/assets");
    await expect(
      page.getByRole("heading", { name: /Asset Library/i }),
    ).toBeVisible({ timeout: 15_000 });

    const fileInput = page.locator('input[type="file"][accept*=".psd"]');

    // Use an inline buffer so we don't need a .png fixture on disk.
    await fileInput.setInputFiles({
      name: "not-a-psd.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes
    });

    // The action returns { ok: false, code: "bad_extension",
    // error: "Expected .psd, got not-a-psd.png" }; the component
    // surfaces it via the toast element (role="status").
    await expect(
      page.locator('[role="status"]').getByText(/Expected \.psd/i),
    ).toBeVisible({ timeout: 30_000 });
  });
});
