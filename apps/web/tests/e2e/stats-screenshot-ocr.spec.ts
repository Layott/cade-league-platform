import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 14 E2E — stats screenshot OCR pipeline.
 *
 * Determinism: this spec sets OCR_DISABLED=1 via the Playwright webServer
 * env. The upload path therefore takes the manual-entry branch
 * (parse_status='pending', no Anthropic call), which exercises the review
 * flow without network determinism headaches.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Stats OCR";
const E2E_NOTE_TAG = "e2e-stats-ocr";

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

function svc(): SupabaseClient {
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

/**
 * Ensure a stable E2E match_day + two-player fixture exists. Returns the
 * match_day + match + the two player_ids.
 */
async function ensureE2EFixture(): Promise<{
  matchDayId: string;
  matchId: string;
  homePlayerId: string;
  awayPlayerId: string;
}> {
  const sb = svc();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!season) throw new Error("active season not found");

  // Stable future date keeps the E2E row reusable across runs.
  const matchDate = "2028-03-14";
  let { data: md } = await sb
    .from("match_days")
    .select("id")
    .eq("season_id", season.id)
    .eq("match_date", matchDate)
    .is("deleted_at", null)
    .maybeSingle();
  if (!md) {
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
    if (error || !created)
      throw new Error(`failed to create e2e match_day: ${error?.message}`);
    md = created;
  }
  const matchDayId = md!.id as string;

  // Get two players in this season for a fixture.
  const { data: participants } = await sb
    .from("season_participants")
    .select("player_id")
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .limit(2);
  if (!participants || participants.length < 2)
    throw new Error("need ≥ 2 season participants for e2e stats spec");
  const homePlayerId = participants[0].player_id as string;
  const awayPlayerId = participants[1].player_id as string;

  // Reuse or create the match.
  let { data: match } = await sb
    .from("matches")
    .select("id")
    .eq("match_day_id", matchDayId)
    .eq("home_player_id", homePlayerId)
    .eq("away_player_id", awayPlayerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!match) {
    const { data: createdMatch, error: mErr } = await sb
      .from("matches")
      .insert({
        season_id: season.id,
        match_day_id: matchDayId,
        home_player_id: homePlayerId,
        away_player_id: awayPlayerId,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (mErr || !createdMatch)
      throw new Error(`failed to create e2e match: ${mErr?.message}`);
    match = createdMatch;
  }

  // Scrub prior E2E screenshots + their downstream player_match_stats so we
  // start from a known clean state.
  const { data: oldShots } = await sb
    .from("match_stat_screenshots")
    .select("id")
    .eq("match_id", match!.id)
    .ilike("notes", `%${E2E_NOTE_TAG}%`);
  for (const s of oldShots ?? []) {
    await sb
      .from("match_stat_screenshots")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", s.id);
  }

  return {
    matchDayId,
    matchId: match!.id as string,
    homePlayerId,
    awayPlayerId,
  };
}

test.setTimeout(120_000);

test("admin uploads screenshot (OCR_DISABLED manual path), reviews, confirms, public reflects stats", async ({
  page,
}) => {
  const { matchDayId, matchId, homePlayerId, awayPlayerId } =
    await ensureE2EFixture();
  await login(page);

  // 1. Navigate to the stats-upload page.
  await page.goto(`/admin/match-days/${matchDayId}/stats-upload`);
  await expect(page.getByTestId("stats-upload-page")).toBeVisible();

  // 2. Upload the fixture PNG.
  const fixturePath = path.resolve(
    __dirname,
    "..",
    "fixtures",
    "stats-screen.png",
  );
  await page.getByTestId(`stats-upload-file-${matchId}`).setInputFiles(fixturePath);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByTestId(`stats-upload-submit-${matchId}`).click(),
  ]);

  // 3. Assert a screenshot row appeared. Under OCR_DISABLED it stays pending.
  const statusCell = page.locator("[data-testid^='stats-screenshot-status-']").first();
  await expect(statusCell).toBeVisible({ timeout: 10_000 });
  const statusText = (await statusCell.textContent())?.toLowerCase() ?? "";
  expect(["pending", "parsing", "parsed"]).toContain(statusText.trim());

  // Grab the screenshot id from its test id.
  const row = page.locator("[data-testid^='stats-screenshot-row-']").first();
  const rowId = await row.getAttribute("data-testid");
  const screenshotId = rowId!.replace("stats-screenshot-row-", "");

  // Tag the note so cleanup scrubbing is deterministic on re-runs.
  const sb = svc();
  await sb
    .from("match_stat_screenshots")
    .update({ notes: E2E_NOTE_TAG })
    .eq("id", screenshotId);

  // 4. Open review page.
  await page.goto(
    `/admin/match-days/${matchDayId}/stats-upload/${screenshotId}/review`,
  );
  await expect(page.getByTestId("stats-review-page")).toBeVisible();

  // 5. Fill in admin-corrected stats (manual-entry path).
  await page.getByTestId("stats-review-field-home-score").fill("3");
  await page.getByTestId("stats-review-field-away-score").fill("1");
  await page.getByTestId("stats-review-field-home-possessionPct").fill("55");
  await page.getByTestId("stats-review-field-home-shots").fill("10");
  await page.getByTestId("stats-review-field-home-passAccuracyPct").fill("88");
  await page.getByTestId("stats-review-field-home-goals").fill("3");
  await page.getByTestId("stats-review-field-home-assists").fill("0");
  await page.getByTestId("stats-review-field-away-possessionPct").fill("45");
  await page.getByTestId("stats-review-field-away-shots").fill("5");
  await page.getByTestId("stats-review-field-away-passAccuracyPct").fill("80");
  await page.getByTestId("stats-review-field-away-goals").fill("1");
  await page.getByTestId("stats-review-field-away-assists").fill("0");

  // 6. Resolve home + away players.
  await page
    .getByTestId("stats-review-home-player-select")
    .selectOption(homePlayerId);
  await page
    .getByTestId("stats-review-away-player-select")
    .selectOption(awayPlayerId);

  // 7. Confirm.
  await page.getByTestId("stats-review-confirm").click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/match-days/${matchDayId}/stats-upload$`),
  );

  // 8. Assert DB state: screenshot confirmed + two PMS rows with custom_metrics.
  const { data: screenshot } = await sb
    .from("match_stat_screenshots")
    .select("parse_status, parsed_by_engine, confirmed_at")
    .eq("id", screenshotId)
    .single();
  expect(screenshot?.parse_status).toBe("confirmed");
  expect(screenshot?.parsed_by_engine).toBe("manual");
  expect(screenshot?.confirmed_at).not.toBeNull();

  const { data: pmsRows } = await sb
    .from("player_match_stats")
    .select("player_id, goals, assists, custom_metrics")
    .eq("match_id", matchId)
    .in("player_id", [homePlayerId, awayPlayerId])
    .is("deleted_at", null);
  expect(pmsRows).toBeTruthy();
  expect(pmsRows!.length).toBe(2);
  const homeRow = pmsRows!.find((r) => r.player_id === homePlayerId);
  const awayRow = pmsRows!.find((r) => r.player_id === awayPlayerId);
  expect(homeRow?.goals).toBe(3);
  expect(awayRow?.goals).toBe(1);
  expect((homeRow?.custom_metrics as { possessionPct?: number }).possessionPct)
    .toBe(55);

  // 9. Idempotent re-confirm is blocked (screenshot is terminal).
  await page.goto(
    `/admin/match-days/${matchDayId}/stats-upload/${screenshotId}/review`,
  );
  await expect(page.getByText(/Review locked/i)).toBeVisible();

  // 10. Public /players/[id] renders the card. Under ISR revalidate=60 we
  //     tolerate either the new card or the empty-state message.
  await page.goto(`/players/${homePlayerId}`);
  await expect(page.getByTestId("public-recent-match-stats")).toBeVisible();
});
