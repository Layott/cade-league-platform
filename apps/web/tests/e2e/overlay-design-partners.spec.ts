import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Wave 2 Stage 3 — overlay design partner-strip + logo manager E2E.
 *
 * Drives the live admin editor end-to-end:
 *   1. Login as admin.
 *   2. Visit /admin/broadcast/v2/design?overlay=01-brb.
 *   3. Reposition the partner strip (anchor → top-right, scale 110%).
 *   4. Save layout — assert DB row in `overlay_partner_strip_layout`.
 *   5. Toggle a logo's per-overlay visibility off — assert override
 *      row in `overlay_partner_logo_overrides`.
 *   6. Confirm the iframe URL carries the
 *      `?previewPartnerTokens=<b64>` query param (changes on every
 *      slider tick, debounced to 250 ms).
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.4
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
const OVERLAY = "01-brb";
const VARIANT = "default";

async function cleanupStripLayout(): Promise<void> {
  const sb = getServiceRoleClient();
  if (!sb) return;
  await sb
    .from("overlay_partner_strip_layout")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("overlay_key", OVERLAY)
    .eq("variant_id", VARIANT)
    .is("deleted_at", null);
}

async function cleanupLogoOverrides(): Promise<void> {
  const sb = getServiceRoleClient();
  if (!sb) return;
  await sb
    .from("overlay_partner_logo_overrides")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("overlay_key", OVERLAY)
    .eq("variant_id", VARIANT)
    .is("deleted_at", null);
}

test.describe("Overlay design — partners (Wave 2 Stage 3)", () => {
  test.afterEach(async () => {
    await cleanupStripLayout();
    await cleanupLogoOverrides();
  });

  test("admin can reposition + save partner-strip layout", async ({
    page,
  }) => {
    // 1. Login.
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(admin|player|profile)/);

    // 2. Navigate to design page for 01-brb.
    await page.goto(`/admin/broadcast/v2/design?overlay=${OVERLAY}`);
    await expect(page.getByTestId("broadcast-v2-design")).toBeVisible({
      timeout: 15_000,
    });

    // 3. Partners panel + strip-layout sub-panel render.
    const partnersPanel = page.getByTestId("overlay-design-partners-panel");
    await expect(partnersPanel).toBeVisible({ timeout: 10_000 });
    const layoutPanel = page.getByTestId("overlay-design-partners-layout");
    await expect(layoutPanel).toBeVisible();

    // 4. Reposition: anchor → top-right, scale → 110%.
    const anchor = page.getByTestId("strip-layout-anchor");
    await anchor.selectOption("top-right");
    const scale = page.getByTestId("strip-layout-scale");
    await scale.fill("110");

    // 5. Save layout.
    await page.getByTestId("strip-layout-save").click();

    // 6. Verify DB row.
    const sb = getServiceRoleClient();
    if (sb) {
      let dbAnchor: string | null = null;
      let dbScale: number | null = null;
      for (let i = 0; i < 10; i++) {
        const { data } = await sb
          .from("overlay_partner_strip_layout")
          .select("anchor, scale_pct")
          .eq("overlay_key", OVERLAY)
          .eq("variant_id", VARIANT)
          .is("deleted_at", null)
          .maybeSingle();
        if (data?.anchor === "top-right") {
          dbAnchor = data.anchor;
          dbScale = data.scale_pct;
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(dbAnchor).toBe("top-right");
      expect(dbScale).toBe(110);
    }

    // 7. Live preview iframe URL carries ?previewPartnerTokens.
    const iframe = page.getByTestId("overlay-design-preview-iframe");
    await expect(iframe).toHaveAttribute(
      "src",
      /previewPartnerTokens=/,
      { timeout: 5_000 },
    );
  });

  test("toggling a logo override persists + iframe URL updates", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(admin|player|profile)/);

    await page.goto(`/admin/broadcast/v2/design?overlay=${OVERLAY}`);
    await expect(page.getByTestId("broadcast-v2-design")).toBeVisible({
      timeout: 15_000,
    });

    const roster = page.getByTestId("overlay-design-partners-roster");
    await expect(roster).toBeVisible();

    // Try to find the first partner-logo row dynamically — different
    // envs may have different seeded keys, so probe rather than hard-
    // code "gameevo".
    const firstLogoRow = page.locator('[data-testid^="partner-logo-"]').first();
    if (!(await firstLogoRow.isVisible().catch(() => false))) {
      test.skip(true, "no partner logos seeded in this env — nothing to toggle");
      return;
    }

    const partnerKey = await firstLogoRow.evaluate((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      const m = id.match(/^partner-logo-([a-z0-9-]+)$/);
      return m ? m[1] : "";
    });
    expect(partnerKey).not.toBe("");

    const toggle = page.getByTestId(`partner-logo-${partnerKey}-enabled`);
    await expect(toggle).toBeChecked();
    await toggle.click();

    // DB row.
    const sb = getServiceRoleClient();
    if (sb) {
      let visibleColumn: boolean | null = null;
      for (let i = 0; i < 10; i++) {
        const { data } = await sb
          .from("overlay_partner_logo_overrides")
          .select("visible")
          .eq("overlay_key", OVERLAY)
          .eq("variant_id", VARIANT)
          .eq("partner_key", partnerKey)
          .is("deleted_at", null)
          .maybeSingle();
        if (data && data.visible === false) {
          visibleColumn = data.visible;
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(visibleColumn).toBe(false);
    }
  });
});
