import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Match Day Flow";

// Load env vars from apps/web/.env.local if not already in the environment
// (Playwright's webServer spawns `npm run dev` which loads them; the test
// process itself does not.)
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

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

async function cleanupE2EMatchDays() {
  loadEnvFromDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Soft-delete any match_days we created with the E2E venue name.
  await sb
    .from("match_days")
    .update({ deleted_at: new Date().toISOString() })
    .eq("venue_name", E2E_VENUE)
    .is("deleted_at", null);
}

test.afterAll(async () => {
  await cleanupE2EMatchDays();
});

test.setTimeout(120_000);

test("admin creates match day, adds fixture, enters draft, confirms, standings reflect", async ({
  page,
}) => {
  await login(page);

  // Unique future-dated match day so we can identify + avoid collision.
  const uniqueYmd = `209${Math.floor(Math.random() * 9)}-${String(
    1 + Math.floor(Math.random() * 12)
  ).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;

  // 1. Create match day
  await page.goto("/admin/match-days");
  await page.getByTestId("new-match-day-link").click();
  await page.getByLabel("Match date").fill(uniqueYmd);
  await page.getByLabel("Venue").fill(E2E_VENUE);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/admin\/match-days\/[a-f0-9-]+/);
  const matchDayUrl = page.url();

  // 2. Add fixture (expects at least 2 season participants in seed)
  const options = await page
    .locator("[data-testid='add-home-select'] option")
    .allTextContents();
  const validOptions = options.filter((o) => o.trim() !== "—" && o.trim().length > 0);
  expect(validOptions.length).toBeGreaterThanOrEqual(2);

  await page.locator("[data-testid='add-home-select']").selectOption({ index: 1 });
  await page.locator("[data-testid='add-away-select']").selectOption({ index: 2 });
  await page.getByTestId("add-fixture-btn").click();
  await expect(page.locator("[data-testid^='fixture-']")).toHaveCount(1);

  // 3. Enter a draft result: 2-1 (home wins)
  const fixture = page.locator("[data-testid^='fixture-']").first();
  await fixture.locator("input[name='homeScore']").fill("2");
  await fixture.locator("input[name='awayScore']").fill("1");
  await fixture.getByRole("button", { name: "Enter" }).click();
  // Wait for the form to reflect the draft state (confirm button appears).
  await expect(page.locator("[data-testid^='confirm-']").first()).toBeVisible();

  // 4. Standings page renders (draft is excluded from totals).
  await page.goto("/standings");
  await expect(page.getByRole("heading", { name: /Standings/i })).toBeVisible();

  // 5. Confirm the result
  await page.goto(matchDayUrl);
  await page.locator("[data-testid^='confirm-']").first().click();
  // After confirm: the server action revalidates and the page re-renders.
  // The confirmed badge appears and the confirm button disappears.
  await expect(page.locator("text=confirmed").first()).toBeVisible({ timeout: 10_000 });

  // 6. Standings now reflect the confirmed result: the home player earned 3 pts.
  await page.goto("/standings");
  const body = await page.locator("[data-testid='standings-body']").innerText();
  expect(body).toMatch(/\b3\b/);
});
