import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 56 — E2E: a player loads /player/squad, sees a match-day picker
 * listing every match day in the active season, and can drill into any
 * match day by clicking a row. The detail view branches on submission
 * state + window state.
 *
 * The spec is tolerant of an empty schedule (skips if no match days exist)
 * and of unknown player passwords (skips if the seed default doesn't work).
 */

const PLAYER_EMAIL = "player01@cade.local";
const PLAYER_PASSWORD = "dev-player-2026";

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function svc() {
  loadEnv();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function loginPlayer(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(PLAYER_EMAIL);
  await page.getByLabel("Password").fill(PLAYER_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  return page
    .waitForURL(/\/player/, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.setTimeout(120_000);

test("player sees the match-day picker with all season match days", async ({
  page,
}) => {
  const sb = svc();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!season) {
    test.skip(true, "no active season seeded");
    return;
  }
  const { data: days } = await sb
    .from("match_days")
    .select("id, match_date")
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .order("match_date", { ascending: true });

  const landed = await loginPlayer(page);
  if (!landed) {
    test.skip(true, "player01 login failed");
    return;
  }

  await page.goto("/player/squad");
  const picker = page.getByTestId("squad-match-day-picker");
  const empty = page.getByTestId("squad-match-day-picker-empty");
  await expect(picker.or(empty)).toBeVisible({ timeout: 15_000 });

  if (!days || days.length === 0) {
    // Empty schedule — empty-state must surface.
    await expect(empty).toBeVisible();
    return;
  }

  // For each MD, a row with the testid `squad-match-day-row-<id>` must render.
  for (const d of days) {
    const row = page.getByTestId(`squad-match-day-row-${d.id}`);
    await expect(row).toBeVisible();
  }
});

test("clicking a match day pins the URL + shows a Back link", async ({
  page,
}) => {
  const sb = svc();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!season) {
    test.skip(true, "no active season seeded");
    return;
  }
  const { data: anyDay } = await sb
    .from("match_days")
    .select("id, match_date")
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .order("match_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!anyDay) {
    test.skip(true, "no match days seeded for active season");
    return;
  }

  const landed = await loginPlayer(page);
  if (!landed) {
    test.skip(true, "player01 login failed");
    return;
  }

  await page.goto(`/player/squad?matchDay=${anyDay.id}`);
  await expect(page.getByTestId("squad-md-back-link")).toBeVisible({
    timeout: 15_000,
  });
  // One of the four detail variants must surface — submission view, picker,
  // window-closed, or not-yet-open.
  const subView = page.getByTestId("squad-existing-summary");
  const pickerView = page.getByTestId("squad-match-day-picker");
  const closedView = page.getByTestId("squad-window-closed");
  const notYetOpen = page.getByTestId("squad-window-not-open-yet");
  await expect(
    subView.or(pickerView).or(closedView).or(notYetOpen),
  ).toBeVisible({ timeout: 10_000 });
});

test("an unknown matchDay query param falls back to the picker list", async ({
  page,
}) => {
  const landed = await loginPlayer(page);
  if (!landed) {
    test.skip(true, "player01 login failed");
    return;
  }
  // Bogus uuid — page should ignore it + render the list.
  await page.goto(
    "/player/squad?matchDay=00000000-0000-0000-0000-000000000000",
  );
  const picker = page.getByTestId("squad-match-day-picker");
  const empty = page.getByTestId("squad-match-day-picker-empty");
  await expect(picker.or(empty)).toBeVisible({ timeout: 15_000 });
});
