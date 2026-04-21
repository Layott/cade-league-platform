import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 10 — E2E: a pending submission is created via service role (so we
 * don't depend on the storage upload UI), then an admin visits
 * /admin/squads, opens the detail page, approves, and we verify the
 * public /players/[id] page renders the approved squad card.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

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

function weekStartThursdayNow(): string {
  const now = new Date();
  // Format in WAT (UTC+1, no DST).
  const watMs = now.getTime() + 60 * 60 * 1000;
  const d = new Date(watMs);
  const dow = d.getUTCDay();
  const diff = (dow - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.setTimeout(120_000);

test("admin approves a seeded squad submission and public profile renders it", async ({
  page,
}) => {
  const sb = svc();
  const weekStart = weekStartThursdayNow();

  // Pick an active season + existing player. Re-use is fine; unique partial
  // index on (player, week_start_date) means we hard-delete any live row
  // before seeding a fresh one.
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  expect(season).toBeTruthy();

  const { data: player } = await sb
    .from("players")
    .select("id")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  expect(player).toBeTruthy();

  // Clean slate: hard-delete any pre-existing live submission for this (player, week).
  await sb
    .from("squad_submissions")
    .delete()
    .eq("player_id", player!.id)
    .eq("week_start_date", weekStart);

  const { data: inserted } = await sb
    .from("squad_submissions")
    .insert({
      season_id: season!.id,
      player_id: player!.id,
      week_start_date: weekStart,
      futbin_screenshot_path: `seasons/${season!.id}/players/${player!.id}/weeks/${weekStart}/e2e.png`,
      validation_status: "pending",
    })
    .select("id")
    .single();
  expect(inserted?.id).toBeTruthy();

  // One XI item so the approved card has content.
  await sb.from("squad_player_items").insert({
    submission_id: inserted!.id,
    name: "E2E Striker",
    rating: 87,
    position: "ST",
    value: 1_234_567,
    item_type: "gold",
    nationality_flag: "NG",
    slot_index: 0,
  });

  await login(page);
  await page.goto(`/admin/squads?week=${weekStart}`);
  await expect(page.getByTestId("squads-list")).toBeVisible();
  await page.goto(`/admin/squads/${inserted!.id}`);
  await expect(page.getByTestId("squad-items-table")).toBeVisible();

  // Approve.
  await page.getByTestId("squad-approve-btn").click();
  await expect(page.getByRole("status").or(page.getByText(/Decision locked/i))).toBeVisible().catch(() => undefined);

  // Verify DB flipped to approved.
  const { data: verified } = await sb
    .from("squad_submissions")
    .select("validation_status, validated_at")
    .eq("id", inserted!.id)
    .single();
  expect(verified?.validation_status).toBe("approved");

  // Public profile shows the squad card.
  await page.goto(`/players/${player!.id}`);
  await expect(page.getByTestId("public-week-squad")).toBeVisible();
  await expect(page.getByText(/E2E Striker/)).toBeVisible();

  // Cleanup — hard-delete so re-runs are clean.
  await sb.from("squad_submissions").delete().eq("id", inserted!.id);
});
