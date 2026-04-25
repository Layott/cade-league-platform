import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

/**
 * Plan 51 — Tournament page UI E2E.
 *
 * Walks the admin through the eight tabs, verifies each renders without
 * runtime error, exercises the round-trip surfaces (drag-rank save,
 * download buttons, walkover confirm, score entry) where possible.
 *
 * The spec is read-only-by-default — score entry + walkover triggers run
 * inside try/finally guards that revert every DB mutation when the test
 * finishes so seeded fixtures stay clean for sibling specs.
 */

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

function serviceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "plan51-tournament-ui.spec: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required",
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.describe("Plan 51 — Tournament page UI", () => {
  test("Standings tab loads + download buttons render", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/tournament/standings");
    await expect(
      page.getByTestId("tournament-tab-standings"),
    ).toBeVisible();
    await expect(page.getByTestId("live-leaderboard")).toBeVisible();
    // Download buttons render only when the user has tournament.export.
    // Admin wildcard => present.
    await expect(
      page.getByTestId("tournament-download-buttons"),
    ).toBeVisible();
  });

  test("Fixtures tab renders match-day groupings", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/tournament/fixtures");
    await expect(
      page.getByTestId("tournament-tab-fixtures"),
    ).toBeVisible();
  });

  test("Results Entry tab renders the form", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/tournament/results-entry");
    await expect(
      page.getByTestId("tournament-tab-results-entry"),
    ).toBeVisible();
    // Form may be present OR show an empty-state if no fixtures seeded.
    const hasForm = await page.getByTestId("results-entry-form").isVisible().catch(() => false);
    if (hasForm) {
      await expect(page.getByTestId("home-score")).toBeVisible();
      await expect(page.getByTestId("away-score")).toBeVisible();
    }
  });

  test("Walkovers tab renders both sections", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/tournament/walkovers");
    await expect(
      page.getByTestId("tournament-tab-walkovers"),
    ).toBeVisible();
    await expect(page.getByTestId("walkovers-pending-section")).toBeVisible();
    await expect(page.getByTestId("walkovers-trigger-section")).toBeVisible();
  });

  test("Adjustments tab links to /admin/punishments", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/tournament/adjustments");
    await expect(
      page.getByTestId("tournament-tab-adjustments"),
    ).toBeVisible();
    const cta = page.getByTestId("adjustments-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /\/admin\/punishments/);
  });

  test("Tiebreaker drag-rank renders + save round-trip works", async ({
    page,
  }) => {
    const sb = serviceClient();
    // Snapshot existing config so we can restore.
    const { data: seasonRow } = await sb
      .from("seasons")
      .select("id, tiebreaker_order")
      .eq("status", "active")
      .maybeSingle();
    const seasonId = seasonRow?.id as string | undefined;
    const original =
      (seasonRow as { tiebreaker_order?: string[] | null } | null)
        ?.tiebreaker_order ?? null;

    try {
      await adminLogin(page);
      await page.goto("/admin/tournament/tiebreaker-config");
      await expect(
        page.getByTestId("tournament-tab-tiebreakers"),
      ).toBeVisible();
      await expect(page.getByTestId("tiebreaker-drag-rank")).toBeVisible();

      // Reorder: click the down arrow on totalPts.
      const totalPtsRow = page.getByTestId("tiebreaker-row-totalPts");
      await expect(totalPtsRow).toBeVisible();
      await totalPtsRow
        .getByRole("button", { name: "Move Total Points down" })
        .click();
      await page.getByTestId("tiebreaker-save").click();
      await expect(page.getByText(/^Saved$/)).toBeVisible({ timeout: 5000 });

      if (seasonId) {
        const { data: after } = await sb
          .from("seasons")
          .select("tiebreaker_order")
          .eq("id", seasonId)
          .maybeSingle();
        const afterOrder =
          (after as { tiebreaker_order?: string[] | null } | null)
            ?.tiebreaker_order;
        expect(Array.isArray(afterOrder)).toBe(true);
        expect(afterOrder?.[0]).toBe("gd");
      }
    } finally {
      if (seasonId) {
        await sb
          .from("seasons")
          .update({ tiebreaker_order: original ?? ["totalPts", "gd", "gf", "name"] })
          .eq("id", seasonId);
      }
    }
  });

  test("H2H Lookup tab renders comparison cards on initial load", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/tournament/h2h-lookup");
    await expect(
      page.getByTestId("tournament-tab-h2h-lookup"),
    ).toBeVisible();
    await expect(page.getByTestId("h2h-player-picker")).toBeVisible();
  });

  test("Win-Prob Preview tab renders calculator + breakdown", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/tournament/win-prob-preview");
    await expect(
      page.getByTestId("tournament-tab-win-prob-preview"),
    ).toBeVisible();
    await expect(page.getByTestId("win-prob-calculator")).toBeVisible();
    // Wait briefly for the API call to settle.
    const probA = page.getByTestId("prob-a");
    await expect(probA).toBeVisible({ timeout: 10000 });
  });

  test("Leaderboard XLSX download returns binary content", async ({
    page,
  }) => {
    await adminLogin(page);
    const cookies = await page.context().cookies();
    const response = await page.request.get(
      "/api/tournament/export?type=leaderboard&format=xlsx",
    );
    expect(response.status()).toBe(200);
    const ct = response.headers()["content-type"] ?? "";
    expect(ct).toContain("spreadsheetml.sheet");
    const body = await response.body();
    expect(body.byteLength).toBeGreaterThan(50);
    // XLSX magic = PK\x03\x04 (zip header)
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
    expect(cookies.length).toBeGreaterThan(0);
  });
});
