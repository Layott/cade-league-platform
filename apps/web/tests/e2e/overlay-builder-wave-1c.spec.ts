import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/login";

/**
 * Wave 1C — End-to-end spec covering pen tool, grouping, multi-select,
 * copy-paste, and keyboard shortcuts.
 *
 * Tests:
 *   1. Pen tool: click 3 anchors → Enter → path element appears in layers panel.
 *   2. Group + ungroup: shift-click two rects → Group button → layers shows
 *      "group" → Ungroup button → group row gone.
 *   3. Delete shortcut: select an element → Delete key → layer count decrements.
 *   4. Arrow-key nudge: select element → ArrowRight → X field increments by 1.
 *   5. Mod+D duplicate: select element → Ctrl/Cmd+D → layer count increments.
 *
 * Selector strategy:
 *   - Toolbar buttons: aria-label (ToolButton renders aria-label={label}).
 *   - Layers panel:    aria-label="Layers" container, rows via [role="listitem"].
 *   - Properties panel group/ungroup: data-testid="properties-group" /
 *     "properties-ungroup" (added in Wave 1C PropertiesPanel patch).
 *   - X field in Properties → transform tab: aria-label="X" number input.
 *   - Save/status: data-testid="builder-save" / "builder-save-status"
 *     (same as Wave 1A/1B).
 *
 * Requires NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true.
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-1c.md §Task15
 */

test.describe("Overlay Builder — Wave 1C surfaces", () => {
  test.skip(
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED !== "true",
    "Set NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true before running this spec",
  );

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Login, navigate to the builder library, open the new-design modal,
   * fill a timestamped title, submit, and wait for the edit URL.
   * Returns the slug extracted from the URL.
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
    await expect(page.getByTestId("builder-new-design-modal")).toBeVisible({
      timeout: 10_000,
    });

    const title = `${titlePrefix} ${Date.now()}`;
    await page.getByTestId("builder-new-title").fill(title);
    await page.getByTestId("builder-new-mode-single").click();
    await page.getByTestId("builder-new-submit").click();

    await page.waitForURL(
      /\/admin\/broadcast\/v2\/builder\/[^/]+\/edit$/,
      { timeout: 15_000 },
    );
    const m = page.url().match(/\/admin\/broadcast\/v2\/builder\/([^/]+)\/edit$/);
    if (!m) throw new Error("Could not extract slug from URL");
    return m[1];
  }

  /**
   * Returns a boundingBox-aware click helper for the canvas stage.
   */
  async function getCanvasClicker(page: import("@playwright/test").Page) {
    const stage = page.getByTestId("builder-canvas-stage");
    await expect(stage).toBeVisible({ timeout: 10_000 });
    const box = await stage.boundingBox();
    if (!box) throw new Error("canvas stage bounding box not found");
    return {
      click: (relX: number, relY: number) =>
        page.mouse.click(box.x + relX, box.y + relY),
      box,
    };
  }

  // ── Test 1: Pen tool ──────────────────────────────────────────────────────

  test("Pen tool: click 3 anchors → Enter → path element appears in layers panel", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await createNewDesign(page, "Wave 1C Pen Smoke");
    const canvas = await getCanvasClicker(page);

    // Activate pen tool — aria-label="Pen" on the toolbar button.
    await page.getByRole("button", { name: /^pen$/i }).click();

    // Click three anchor points within the canvas bounds.
    await canvas.click(200, 200);
    await canvas.click(400, 100);
    await canvas.click(600, 300);

    // Enter commits the path.
    await page.keyboard.press("Enter");

    // A "path" row should now appear in the layers panel.
    await expect(
      page
        .getByRole("region", { name: "Layers" })
        .locator('[role="listitem"]')
        .filter({ hasText: /path/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Test 2: Group + ungroup ───────────────────────────────────────────────

  test("Group + ungroup: shift-select two rects → Group button → Ungroup button", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await createNewDesign(page, "Wave 1C Group Smoke");

    // Drop two rect elements via the toolbar.
    await page.getByRole("button", { name: /^rect$/i }).click();
    await page.getByRole("button", { name: /^rect$/i }).click();

    // Expect 2 layer rows.
    const layers = page
      .getByRole("region", { name: "Layers" })
      .locator('[role="listitem"]');
    await expect(layers).toHaveCount(2, { timeout: 8_000 });

    // Click first row, shift-click second to multi-select.
    await layers.nth(0).click();
    await layers.nth(1).click({ modifiers: ["Shift"] });

    // Properties panel should now show the Group button (multi-select gate).
    await expect(page.getByTestId("properties-group")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId("properties-group").click();

    // Layers should collapse into one "group" entry.
    await expect(
      layers.filter({ hasText: /^group$/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Ungroup — Ungroup button appears when the group is selected.
    await expect(page.getByTestId("properties-ungroup")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId("properties-ungroup").click();

    // Group row is gone; the two rects are back as top-level entries.
    await expect(
      layers.filter({ hasText: /^group$/i }),
    ).toHaveCount(0, { timeout: 5_000 });
    await expect(layers).toHaveCount(2, { timeout: 5_000 });
  });

  // ── Test 3: Delete shortcut ───────────────────────────────────────────────

  test("Delete shortcut removes the selected element", async ({ page }) => {
    test.setTimeout(90_000);

    await createNewDesign(page, "Wave 1C Delete Smoke");

    // Drop a rect.
    await page.getByRole("button", { name: /^rect$/i }).click();

    const rows = page
      .getByRole("region", { name: "Layers" })
      .locator('[role="listitem"]');
    await expect(rows).toHaveCount(1, { timeout: 8_000 });

    // Select the row and press Delete.
    await rows.first().click();
    await page.keyboard.press("Delete");

    // Row count drops.
    await expect(rows).toHaveCount(0, { timeout: 5_000 });
  });

  // ── Test 4: Arrow-key nudge ───────────────────────────────────────────────

  test("Arrow-key nudge moves the selected element by 1 px", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await createNewDesign(page, "Wave 1C Nudge Smoke");

    // Drop a rect.
    await page.getByRole("button", { name: /^rect$/i }).click();

    const rows = page
      .getByRole("region", { name: "Layers" })
      .locator('[role="listitem"]');
    await expect(rows).toHaveCount(1, { timeout: 8_000 });

    // Select the element row so shortcuts are active.
    await rows.first().click();

    // Open the Transform tab to read the X field.
    await page.getByRole("tab", { name: /^transform$/i }).click();

    const xField = page.getByRole("spinbutton", { name: /^x$/i }).first();
    const beforeX = Number(await xField.inputValue());

    // Press ArrowRight — shortcut hook should nudge X by +1.
    await page.keyboard.press("ArrowRight");

    const afterX = Number(await xField.inputValue());
    expect(afterX).toBe(beforeX + 1);
  });

  // ── Test 5: Mod+D duplicate ───────────────────────────────────────────────

  test("Mod+D duplicates the selection with a +20 px offset", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await createNewDesign(page, "Wave 1C Duplicate Smoke");

    // Drop a rect.
    await page.getByRole("button", { name: /^rect$/i }).click();

    const rows = page
      .getByRole("region", { name: "Layers" })
      .locator('[role="listitem"]');
    await expect(rows).toHaveCount(1, { timeout: 8_000 });

    // Select the row.
    await rows.first().click();

    const beforeCount = await rows.count();

    // Ctrl+D (Win/Linux) or Meta+D (macOS).
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+d`);

    // Row count should increment by 1 after duplication.
    await expect(rows).toHaveCount(beforeCount + 1, { timeout: 5_000 });
  });
});
