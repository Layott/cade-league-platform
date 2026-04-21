import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
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

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

/**
 * Create a throwaway player (participant of the active season) with a
 * clean precedent count for late_arrival. Returns { playerId, tag }.
 *
 * Self-cleaning by name-prefix filtering so re-runs don't leak.
 */
async function ensureLadderPlayer(): Promise<{ playerId: string; tag: string }> {
  const sb = svc();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!season) throw new Error("no active season");

  const tag = `e2e-ladder-${Date.now()}`;
  const { data: user } = await sb
    .from("users")
    .insert({
      supabase_auth_id: crypto.randomUUID(),
      email: `${tag}@e2e.local`,
      display_name: `E2E Ladder ${tag.slice(-6)}`,
    })
    .select("id")
    .single();
  if (!user) throw new Error("user insert failed");
  const { data: player } = await sb
    .from("players")
    .insert({ user_id: user.id, gamer_tag: tag })
    .select("id")
    .single();
  if (!player) throw new Error("player insert failed");
  await sb
    .from("season_participants")
    .insert({ season_id: season.id, player_id: player.id });

  // Start with a clean precedent — remove any rows by this category (paranoia).
  await sb
    .from("disciplinary_precedents")
    .delete()
    .eq("player_id", player.id);

  return { playerId: player.id as string, tag };
}

async function ensureMatchDayOn(dateIso: string): Promise<string> {
  const sb = svc();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .single();
  const { data: existing } = await sb
    .from("match_days")
    .select("id")
    .eq("season_id", season!.id)
    .eq("match_date", dateIso)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data } = await sb
    .from("match_days")
    .insert({
      season_id: season!.id,
      match_date: dateIso,
      arrival_cutoff_time: "19:15:00",
      match_start_time: "19:30:00",
      venue_name: "E2E Ladder Venue",
    })
    .select("id")
    .single();
  return data!.id as string;
}

test.setTimeout(180_000);

test("late-ladder progression: 3 lates → offense 1, 2, 3 with right ladder outcomes", async ({
  page,
}) => {
  const sb = svc();
  const { playerId } = await ensureLadderPlayer();

  // Three match days far in the future — stable, re-usable.
  const mdA = await ensureMatchDayOn("2030-01-05");
  const mdB = await ensureMatchDayOn("2030-01-12");
  const mdC = await ensureMatchDayOn("2030-01-19");

  // Ensure no prior marks on these match days for our player (paranoia reset).
  for (const mdId of [mdA, mdB, mdC]) {
    await sb
      .from("attendance_marks")
      .delete()
      .eq("match_day_id", mdId)
      .eq("player_id", playerId);
  }
  // Reset precedent counter too.
  await sb.from("disciplinary_precedents").delete().eq("player_id", playerId);

  await login(page);

  // Mark LATE on MD_A.
  await page.goto(`/admin/match-days/${mdA}/attendance`);
  await expect(page.getByTestId("attendance-page")).toBeVisible();
  await page.getByTestId(`att-btn-late-${playerId}`).click();
  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("late");

  // Precedents page should show count=1.
  await page.goto(`/admin/precedents/${playerId}`);
  await expect(page.getByTestId("precedents-table")).toContainText("late_arrival");
  let { data: rows } = await sb
    .from("disciplinary_precedents")
    .select("offense_count")
    .eq("player_id", playerId)
    .eq("category", "late_arrival")
    .single();
  expect(rows?.offense_count).toBe(1);

  // Mark LATE on MD_B (offense #2 → -3 GD + warning case).
  await page.goto(`/admin/match-days/${mdB}/attendance`);
  await page.getByTestId(`att-btn-late-${playerId}`).click();
  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("late");

  rows = (
    await sb
      .from("disciplinary_precedents")
      .select("offense_count")
      .eq("player_id", playerId)
      .eq("category", "late_arrival")
      .single()
  ).data;
  expect(rows?.offense_count).toBe(2);

  // Assert a gd_deduction action exists for this player (magnitude 3).
  const { data: cases2 } = await sb
    .from("disciplinary_cases")
    .select("id, status")
    .eq("player_id", playerId)
    .eq("incident_type", "late_arrival")
    .order("opened_at", { ascending: false });
  expect(cases2!.length).toBeGreaterThanOrEqual(2);
  const { data: actions2 } = await sb
    .from("disciplinary_actions")
    .select("sanction_type, magnitude, case_id")
    .in(
      "case_id",
      cases2!.map((c) => c.id as string),
    );
  const gd = (actions2 ?? []).find(
    (a) => a.sanction_type === "gd_deduction" && a.magnitude === 3,
  );
  expect(gd).toBeDefined();

  // Mark LATE on MD_C (offense #3 → another -3 GD).
  await page.goto(`/admin/match-days/${mdC}/attendance`);
  await page.getByTestId(`att-btn-late-${playerId}`).click();
  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("late");

  rows = (
    await sb
      .from("disciplinary_precedents")
      .select("offense_count")
      .eq("player_id", playerId)
      .eq("category", "late_arrival")
      .single()
  ).data;
  expect(rows?.offense_count).toBe(3);

  // Cleanup: revoke any auto actions + hard-delete marks.
  const { data: marks } = await sb
    .from("attendance_marks")
    .select("id, auto_action_id")
    .eq("player_id", playerId);
  for (const m of (marks ?? []) as Array<{ id: string; auto_action_id: string | null }>) {
    if (m.auto_action_id) {
      await sb
        .from("disciplinary_actions")
        .update({
          revoked_at: new Date().toISOString(),
          revoke_reason: "e2e ladder cleanup",
        })
        .eq("id", m.auto_action_id);
    }
    await sb.from("attendance_marks").delete().eq("id", m.id);
  }
  await sb.from("disciplinary_precedents").delete().eq("player_id", playerId);
  await sb.from("season_participants").delete().eq("player_id", playerId);
  await sb.from("players").delete().eq("id", playerId);
});
