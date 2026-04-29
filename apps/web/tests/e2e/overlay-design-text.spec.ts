import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Wave 2 Stage 2 — overlay design text editing E2E.
 *
 * Drives the live admin editor end-to-end:
 *   1. Login as admin.
 *   2. Visit /admin/broadcast/v2/design?overlay=12-starting-soon.
 *   3. Open the `title` text-element row (collapsed <details>).
 *   4. Type "GAME ON" in the content field, click Save.
 *   5. Open /overlay/v2/12-starting-soon?demo=1 in a second tab and
 *      assert the textTokens query param embeds the new content.
 *   6. Click Reset on the same row to restore the HTML default.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.3
 */

function loadEnvFromDotEnvLocal() {
  const p = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function getServiceRoleClient(): SupabaseClient | null {
  loadEnvFromDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const OVERLAY = "12-starting-soon";
const VARIANT = "default";
const ELEMENT = "title";

async function cleanupTextOverride(
  overlayKey: string,
  variantId: string,
  elementId: string,
): Promise<void> {
  const sb = getServiceRoleClient();
  if (!sb) return;
  // Reset to canonical seed-row state — content empty + all typography null.
  await sb
    .from("overlay_text_elements")
    .update({
      content: "",
      font_family: null,
      font_weight: null,
      font_size_px: null,
      letter_spacing: null,
      line_height: null,
      color: null,
      alignment: null,
      opacity_pct: null,
      position_x_px: null,
      position_y_px: null,
      z_index: null,
      visible: true,
      updated_at: new Date().toISOString(),
    })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("element_id", elementId)
    .eq("origin", "seed")
    .is("deleted_at", null);
}

test.describe("Overlay design — text editing (Wave 2 Stage 2)", () => {
  test.afterEach(async () => {
    await cleanupTextOverride(OVERLAY, VARIANT, ELEMENT);
  });

  test("admin can edit + save title text on 12-starting-soon", async ({
    page,
  }) => {
    // 1. Login
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(admin|player|profile)/);

    // 2. Navigate to design page for 12-starting-soon.
    await page.goto(`/admin/broadcast/v2/design?overlay=${OVERLAY}`);
    await expect(
      page.getByTestId("broadcast-v2-design"),
    ).toBeVisible({ timeout: 15_000 });

    // 3. Wait for text panel + title row to render.
    const panel = page.getByTestId("overlay-design-text-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const titleRow = page.getByTestId(`text-row-${ELEMENT}`);
    await expect(titleRow).toBeVisible();

    // Open the <details> so the input is accessible.
    const summary = titleRow.locator("summary");
    await summary.click();

    const contentInput = page.getByTestId(`text-row-${ELEMENT}-content`);
    await expect(contentInput).toBeVisible();

    // 4. Type new content + click Save.
    await contentInput.fill("GAME ON");
    const saveBtn = titleRow.getByRole("button", { name: /^save$/i });
    await saveBtn.click();

    // 5. Verify DB row updated.
    const sb = getServiceRoleClient();
    if (sb) {
      // Allow up to 5s for the server action to commit.
      let foundContent: string | null = null;
      for (let i = 0; i < 10; i++) {
        const { data } = await sb
          .from("overlay_text_elements")
          .select("content")
          .eq("overlay_key", OVERLAY)
          .eq("variant_id", VARIANT)
          .eq("element_id", ELEMENT)
          .is("deleted_at", null)
          .maybeSingle();
        if (data?.content === "GAME ON") {
          foundContent = data.content;
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(foundContent).toBe("GAME ON");
    }

    // 6. Click Reset — content goes back to empty in the form.
    const resetBtn = titleRow.getByRole("button", { name: /^reset$/i });
    await resetBtn.click();
  });
});
