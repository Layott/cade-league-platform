import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 46 — E2E: login as admin → open hamburger → Referee → Attendance →
 * open a match day → mark 2 players.
 *
 * Uses the admin account (which has attendance.mark + referee access baked
 * in via the admin wildcard) so we don't need a dedicated ref login. The
 * test still exercises the full NavDrawer → /referee/attendance → grid
 * flow exactly as a ref would.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Referee Attendance";

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

function svc() {
  loadEnvFromDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

async function ensureFutureMatchDay(): Promise<{ id: string; date: string }> {
  const sb = svc();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!season) throw new Error("active season not found");

  const matchDate = "2027-11-30";
  const { data: existing } = await sb
    .from("match_days")
    .select("id")
    .eq("season_id", season.id)
    .eq("match_date", matchDate)
    .is("deleted_at", null)
    .maybeSingle();
  let id = existing?.id ?? null;
  if (!id) {
    const { data: created, error } = await sb
      .from("match_days")
      .insert({
        season_id: season.id,
        match_date: matchDate,
        arrival_cutoff_time: "19:15:00",
        match_start_time: "19:30:00",
        venue_name: E2E_VENUE,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`insert match_day failed: ${error?.message}`);
    id = created.id as string;
  }

  // Reset state so the test starts clean.
  const { data: marks } = await sb
    .from("attendance_marks")
    .select("id, auto_action_id")
    .eq("match_day_id", id);
  for (const m of (marks ?? []) as { id: string; auto_action_id: string | null }[]) {
    if (m.auto_action_id) {
      await sb
        .from("disciplinary_actions")
        .update({ revoked_at: new Date().toISOString(), revoke_reason: "e2e reset" })
        .eq("id", m.auto_action_id);
    }
    await sb.from("attendance_marks").delete().eq("id", m.id);
  }

  return { id: id!, date: matchDate };
}

test.setTimeout(120_000);

test("navigate hamburger → Referee → Attendance → mark 2 players", async ({
  page,
}) => {
  const { id: matchDayId } = await ensureFutureMatchDay();
  await login(page);

  // Open the hamburger drawer from the global chrome.
  await page.getByTestId("nav-drawer-trigger").first().click();
  await expect(page.getByTestId("nav-drawer")).toBeVisible();
  await expect(page.getByTestId("nav-drawer-group-referee")).toBeVisible();
  await page.getByTestId("nav-drawer-link-/referee/attendance").click();

  // Landing view.
  await expect(page.getByTestId("referee-attendance-index")).toBeVisible();
  // Navigate straight to our dedicated match day so the test doesn't
  // depend on the date cursor.
  await page.goto(`/referee/attendance/${matchDayId}`);
  await expect(page.getByTestId("ref-mark-page")).toBeVisible();

  // Pick the first two tiles and mark them PRESENT / LATE respectively.
  const tiles = page.locator("[data-testid^=ref-tile-]");
  await expect(tiles.first()).toBeVisible();
  const tileCount = await tiles.count();
  expect(tileCount).toBeGreaterThan(0);

  const first = tiles.nth(0);
  const firstTestId = (await first.getAttribute("data-testid"))!;
  const firstPlayerId = firstTestId.replace("ref-tile-", "");
  await page
    .getByTestId(`ref-btn-present-${firstPlayerId}`)
    .click();
  await expect(
    page.getByTestId(`ref-tile-last-${firstPlayerId}`),
  ).toContainText(/PRESENT/i);

  if (tileCount >= 2) {
    const second = tiles.nth(1);
    const secondTestId = (await second.getAttribute("data-testid"))!;
    const secondPlayerId = secondTestId.replace("ref-tile-", "");
    await page
      .getByTestId(`ref-btn-late-${secondPlayerId}`)
      .click();
    await expect(
      page.getByTestId(`ref-tile-last-${secondPlayerId}`),
    ).toContainText(/LATE/i);
  }

  // Summary strip reflects the writes.
  await expect(page.getByTestId("ref-summary-marked")).toContainText(/\d+ of/);
});

test("unauthenticated /referee/attendance → redirected to /login", async ({
  page,
}) => {
  // No login step — expect middleware to redirect.
  const response = await page.goto("/referee/attendance");
  // Either a redirect to /login or the login page being shown.
  expect(page.url()).toContain("/login");
  void response; // Playwright follows the redirect automatically
});
