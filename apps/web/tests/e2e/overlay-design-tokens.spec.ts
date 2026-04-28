import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

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

/**
 * Soft-delete every `overlay_design_tokens` row for the given (overlay,
 * variant) pair so the production overlay reverts to brand defaults.
 * Service-role bypasses RLS — only callable from this teardown helper.
 */
async function cleanupOverlayTokens(
  overlayKey: string,
  variantId: string,
): Promise<void> {
  const sb = getServiceRoleClient();
  if (!sb) return;
  await sb
    .from("overlay_design_tokens")
    .update({ deleted_at: new Date().toISOString() })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null);
}

/**
 * Overlay Design System — admin save reflects on /overlay route.
 *
 * Phase 4 (spec §6.2). Drives the live admin editor end-to-end:
 *   1. Login as admin.
 *   2. Visit /admin/broadcast/v2/design.
 *   3. Pick `07-leaderboard` + `default` variant.
 *   4. Save accent-color = `#fe036d` (snapshot 1 captures pre-state).
 *   5. Save accent-color = `#1a2b3c` (snapshot 2 captures `#fe036d` —
 *      the snapshot taken BEFORE this mutation).
 *   6. Open `/overlay/v2/07-leaderboard?demo=1` in a second tab — the
 *      SSR `<style id="overlay-design-tokens">` block must contain the
 *      new accent-color CSS variable (`#1a2b3c`).
 *   7. Click the most-recent Revert button in the version timeline. Per
 *      spec §4.3, revert restores tokens FROM the chosen snapshot —
 *      which captured `#fe036d` (the pre-mutation state of save 2).
 *   8. Reload the overlay tab — the SSR style block must now show the
 *      restored `#fe036d` accent.
 *
 * Why two saves: revert restores from the pre-mutation snapshot, so the
 * first save's snapshot is `{}` (empty — there were no DB tokens yet)
 * and reverting to it is a no-op. The second save's snapshot captures
 * `#fe036d` cleanly, giving us a deterministic, observable revert
 * target that survives the test isolation contract.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §6.2
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Continue/i }).click();
  // Some dev-server cold starts take longer than 5 s for the auth round-trip
  // + first-paint of the admin shell. Use waitForURL with a generous timeout
  // so the cold-start path doesn't flake the whole spec.
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test.setTimeout(180_000);

test.afterEach(async () => {
  // Tests leave token overrides + history rows behind by design — revert
  // is a no-op when the only snapshot is `{}`. Soft-delete the rows
  // directly so production overlay routes resume serving brand defaults.
  await cleanupOverlayTokens("07-leaderboard", "default");
});

test("overlay design tokens — admin save reflects on /overlay route", async ({
  page,
  context,
}) => {
  // 0. Clean any leftover overrides from a prior failed run — without
  //    this, the SSR route returns whatever was left and the assertions
  //    against `#1a2b3c` / `#fe036d` race against stale state.
  await cleanupOverlayTokens("07-leaderboard", "default");

  // 1. Login as admin.
  await login(page);

  // 2. Navigate to design page.
  await page.goto("/admin/broadcast/v2/design");
  await expect(page).toHaveURL(/\/admin\/broadcast\/v2\/design/);
  await expect(page.getByTestId("broadcast-v2-design")).toBeVisible();

  // 3. Select 07-leaderboard + default variant via the GET form, then
  //    submit so the server resolves the right tokens snapshot.
  await page.getByTestId("overlay-picker").selectOption("07-leaderboard");
  await page.getByTestId("variant-picker").selectOption("default");
  await page.getByRole("button", { name: /Select/i }).click();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/overlay=07-leaderboard/);

  // 4 + 5. Two saves so revert has a non-empty snapshot to restore from.
  //    Save 1: accent-color = #fe036d (snapshot captures pre-state {} —
  //    no DB tokens yet). Save 2: accent-color = #1a2b3c (snapshot
  //    captures #fe036d, our deterministic revert target).
  async function saveAccent(hex: string) {
    const accentText = page.getByTestId("token-accent-color-text");
    await accentText.click();
    await accentText.fill(hex);
    await page.getByRole("button", { name: /^Save$/i }).click();
    await expect(page.locator("text=Saved")).toBeVisible({ timeout: 20_000 });
    // The Saved pill stays visible for a moment; wait for the network to
    // settle so the next interaction starts from a clean state.
    await page.waitForLoadState("networkidle");
  }
  await saveAccent("#fe036d");
  await saveAccent("#1a2b3c");

  // 6. Open overlay route in second tab. Read inline style block.
  const overlayPage = await context.newPage();
  await overlayPage.goto(
    "/overlay/v2/07-leaderboard?demo=1&preview=1&active=0",
  );
  await overlayPage.waitForLoadState("domcontentloaded");
  const html = await overlayPage.content();
  expect(html).toContain("--overlay-accent-color: #1a2b3c");
  expect(html).toContain('id="overlay-design-tokens"');

  // 7. Revert to the most-recent snapshot in the history timeline. Per
  //    spec §4.3, that snapshot captures the pre-mutation state of save
  //    2 = `accent-color: #fe036d`. Cache-bust the goto so the SSR
  //    re-renders the freshest history list (Next.js dev mode otherwise
  //    serves the cached `/admin/broadcast/v2/design` shell).
  await page.goto(
    `/admin/broadcast/v2/design?overlay=07-leaderboard&variant=default&_=${Date.now()}`,
  );
  await page.waitForLoadState("networkidle");
  const historyList = page.getByTestId("history-list");
  await expect(historyList).toBeVisible();

  // The save action writes ONE history row per token in the catalog
  // (saveTokensAction iterates and calls setDesignToken per token).
  // Each row's snapshot captures the cumulative pre-state at the moment
  // that single token was set. The row whose REASON is
  // `set accent-color=#1a2b3c` is the one whose pre-snapshot still
  // contained `accent-color: #fe036d` — reverting to it restores that
  // intermediate state, giving us a deterministic assertion target.
  const targetRow = historyList
    .locator("li")
    .filter({ hasText: "set accent-color=#1a2b3c" })
    .first();
  await expect(targetRow).toBeVisible({ timeout: 10_000 });
  const firstRevert = targetRow.getByRole("button", { name: /Revert/i });
  // The form submission triggers a server action POST. Capture the
  // request/response cycle explicitly so we can prove it succeeded
  // before checking the DB. Server actions in Next.js dev mode POST to
  // the same page URL with the form-action serialised in headers.
  const [revertResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/admin/broadcast/v2/design"),
      { timeout: 30_000 },
    ),
    firstRevert.click(),
  ]);
  expect(revertResponse.status()).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  // Extra settle — Next.js dev sometimes needs a tick for revalidatePath
  // to re-emit the new RSC tree before the iframe SSR catches up.
  await page.waitForTimeout(1500);

  // 8. Confirm the revert took effect by reading the live DB row
  //    directly. SSR cache + dev-mode revalidation timing can mask the
  //    happy path; the DB is the source of truth for "did the action
  //    succeed". Once the DB is correct we cross-check the SSR overlay
  //    route returns the same accent.
  const sb = getServiceRoleClient();
  if (sb) {
    const { data: liveAccent } = await sb
      .from("overlay_design_tokens")
      .select("token_value")
      .eq("overlay_key", "07-leaderboard")
      .eq("variant_id", "default")
      .eq("token_key", "accent-color")
      .is("deleted_at", null)
      .maybeSingle();
    expect(liveAccent?.token_value).toBe("#fe036d");
  }

  const overlayUrl = `/overlay/v2/07-leaderboard?demo=1&preview=1&active=0&_=${Date.now()}`;
  const fresh = await page.request.get(overlayUrl);
  expect(fresh.ok()).toBeTruthy();
  const freshHtml = await fresh.text();
  expect(freshHtml).toContain("--overlay-accent-color: #fe036d");
});
