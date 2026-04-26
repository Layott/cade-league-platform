import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 42 — E2E: match-aware overlays (select/start/score/end) on the
 * admin broadcast panel. Writes directly to Supabase to create a
 * throwaway match_day + match, then drives the UI to start match + bump
 * scores + end match. Cleanup at the end drops the rows we wrote.
 *
 * Tolerant of network gating / middleware redirects: if login fails the
 * test is skipped rather than failing (mirrors the broadcast-overlay
 * spec pattern).
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Match Aware";

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

function getServiceRoleClient(): SupabaseClient {
  loadEnvFromDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(page: Page): Promise<boolean> {
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe("Plan 42 — match-aware overlays", () => {
  test("select → start → +1 home → end match writes match_results", async ({
    page,
  }) => {
    // Plan 52 — broadcast v2 promoted; v1 MatchControlPanel testids
    // (`match-control-panel`, `match-select`, etc.) live on a route that
    // is now a 307 redirect. The match-flow server modules are still
    // unit-tested in isolation; rewrite this E2E against v2's
    // MatchControl card before re-enabling.
    test.skip(
      true,
      "v1 MatchControlPanel removed; rewrite against v2 surface when match-control is ported",
    );
    const sb = getServiceRoleClient();

    // Resolve the active season.
    const { data: season } = await sb
      .from("seasons")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    test.skip(!season, "no active season in DB; skipping");

    // Pick two real players from the roster.
    const { data: players } = await sb
      .from("players")
      .select("id, gamer_tag")
      .is("deleted_at", null)
      .limit(2);
    test.skip(!players || players.length < 2, "need 2 players in roster");

    const seasonId = (season as { id: string }).id;
    const [pHome, pAway] = players as Array<{ id: string; gamer_tag: string }>;

    // Create throwaway match_day + match for today.
    const today = new Date().toISOString().slice(0, 10);
    const { data: md, error: mdErr } = await sb
      .from("match_days")
      .insert({
        season_id: seasonId,
        match_date: today,
        arrival_cutoff_time: "17:00:00",
        match_start_time: "18:00:00",
        venue_name: E2E_VENUE,
        status: "in_progress",
      })
      .select("id")
      .single();
    test.skip(!!mdErr || !md, `match_day insert failed: ${mdErr?.message}`);
    const matchDayId = (md as { id: string }).id;

    const { data: match } = await sb
      .from("matches")
      .insert({
        season_id: seasonId,
        match_day_id: matchDayId,
        home_player_id: pHome.id,
        away_player_id: pAway.id,
        scheduled_time: "18:00:00",
        status: "scheduled",
      })
      .select("id")
      .single();

    const matchId = (match as { id: string }).id;

    try {
      const ok = await login(page);
      test.skip(!ok, "login failed; dev server unreachable");

      // Start a broadcast session on the match_day.
      await page.goto("/admin/broadcast");
      await page.getByRole("button", { name: /start session/i }).first().click();
      await expect(page).toHaveURL(/\/admin\/broadcast\/[0-9a-f-]+/);

      // Match control panel should be mounted.
      await expect(page.getByTestId("match-control-panel")).toBeVisible();

      // Select the throwaway match.
      await page
        .getByTestId("match-select")
        .selectOption({ value: matchId });
      await page.getByTestId("match-start-btn").click();

      // Score widget should now render with 0 : 0.
      await expect(page.getByTestId("score-widget")).toBeVisible();
      await expect(page.getByTestId("score-home")).toHaveText("0");
      await expect(page.getByTestId("score-away")).toHaveText("0");

      // +1 home twice.
      await page.getByTestId("score-home-plus").click();
      await page.getByTestId("score-home-plus").click();
      await expect(page.getByTestId("score-home")).toHaveText("2");

      // Open End match details + submit final 2-1.
      await page.getByTestId("end-match-details").click();
      await page.getByTestId("end-home").fill("2");
      await page.getByTestId("end-away").fill("1");
      await page.getByTestId("end-match-btn").click();

      // After endMatch: current_match cleared → score widget should disappear.
      await expect(page.getByTestId("score-widget")).not.toBeVisible({
        timeout: 10_000,
      });

      // Verify a match_results row exists.
      const { data: mr } = await sb
        .from("match_results")
        .select("home_score, away_score")
        .eq("match_id", matchId)
        .maybeSingle();
      expect(mr).toBeTruthy();
      expect((mr as { home_score: number }).home_score).toBe(2);
      expect((mr as { away_score: number }).away_score).toBe(1);
    } finally {
      // Cleanup — soft-delete what we created.
      await sb
        .from("match_results")
        .delete()
        .eq("match_id", matchId);
      await sb.from("matches").delete().eq("id", matchId);
      await sb.from("match_days").delete().eq("id", matchDayId);
    }
  });
});
