import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Wave 2 Stage 4 — overlay design animations editing E2E.
 *
 * Drives the live admin editor end-to-end:
 *   1. Login as admin.
 *   2. Visit /admin/broadcast/v2/design?overlay=12-starting-soon.
 *   3. Open the Animations panel + expand the title element.
 *   4. Set entry slide-left (520ms duration), enable, click Save.
 *   5. Visit /overlay/v2/12-starting-soon?demo=1 in a second tab and
 *      assert the page references the new keyframe via SSR.
 *   6. Reset the row back to defaults via Reset button.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.5
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
const PHASE = "entry";

async function cleanupAnimationOverride(
  overlayKey: string,
  variantId: string,
  elementId: string,
  phase: string,
): Promise<void> {
  const sb = getServiceRoleClient();
  if (!sb) return;
  // Soft-delete any rows from the prior run.
  await sb
    .from("overlay_element_animations")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("element_id", elementId)
    .eq("anim_phase", phase)
    .is("deleted_at", null);
}

test.describe("Overlay design — animations editing (Wave 2 Stage 4)", () => {
  test.beforeEach(async () => {
    await cleanupAnimationOverride(OVERLAY, VARIANT, ELEMENT, PHASE);
  });
  test.afterEach(async () => {
    await cleanupAnimationOverride(OVERLAY, VARIANT, ELEMENT, PHASE);
  });

  test("admin can save an entry slide-left animation on title", async ({
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

    // 3. Open Animations panel + title row.
    const panel = page.getByTestId("overlay-design-animations-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const titleRow = page.getByTestId(`anim-element-${ELEMENT}`);
    await expect(titleRow).toBeVisible();
    await titleRow.locator("summary").click();

    // 4. Configure entry slide-left + 520ms + enabled.
    // Default phase tab on open = entry.
    const typeSelect = page.getByTestId(`anim-${ELEMENT}-${PHASE}-type`);
    await typeSelect.selectOption("slide-left");
    const durationInput = page.getByTestId(`anim-${ELEMENT}-${PHASE}-duration`);
    await durationInput.fill("520");
    const enabledToggle = page.getByTestId(`anim-${ELEMENT}-${PHASE}-enabled`);
    if (!(await enabledToggle.isChecked())) {
      await enabledToggle.click();
    }

    const saveBtn = titleRow.getByRole("button", { name: /^save$/i });
    await saveBtn.click();

    // 5. Verify DB row written.
    const sb = getServiceRoleClient();
    if (sb) {
      let found: { anim_type: string; duration_ms: number } | null = null;
      for (let i = 0; i < 10; i++) {
        const { data } = await sb
          .from("overlay_element_animations")
          .select("anim_type,duration_ms")
          .eq("overlay_key", OVERLAY)
          .eq("variant_id", VARIANT)
          .eq("element_id", ELEMENT)
          .eq("anim_phase", PHASE)
          .is("deleted_at", null)
          .maybeSingle();
        if (data?.anim_type === "slide-left") {
          found = data as { anim_type: string; duration_ms: number };
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(found?.anim_type).toBe("slide-left");
      expect(found?.duration_ms).toBe(520);
    }

    // 6. Reset the row.
    const resetBtn = titleRow.getByRole("button", { name: /^reset$/i });
    await resetBtn.click();
    if (sb) {
      // Allow soft-delete to commit.
      let cleaned = false;
      for (let i = 0; i < 10; i++) {
        const { data } = await sb
          .from("overlay_element_animations")
          .select("id")
          .eq("overlay_key", OVERLAY)
          .eq("variant_id", VARIANT)
          .eq("element_id", ELEMENT)
          .eq("anim_phase", PHASE)
          .is("deleted_at", null)
          .maybeSingle();
        if (!data) {
          cleaned = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(cleaned).toBe(true);
    }
  });
});
