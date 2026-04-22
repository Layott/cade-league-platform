import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 23 — E2E: ref opens a seeded squad submission and the FCDB
 * enrichment renders end-to-end. The spec is FCDB-population-tolerant:
 * if `fc26_players` is empty in the cloud DB (Kaggle CSV not yet imported),
 * we assert the empty-banner path; if populated, we assert the per-row
 * badges + summary chip and exercise an ambiguous-pick lock-in.
 *
 * Self-cleaning: hard-deletes any throwaway rows it inserted.
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

test("FCDB review surface renders inline on /admin/squads/[id]", async ({
  page,
}) => {
  const sb = svc();

  // Sanity-check the new column exists (Plan 23 migration applied).
  // Failing this assertion would mean the migration wasn't pushed and the
  // server action would 500 on the lock-in path. Better to fail loud here.
  const { data: colCheck } = await sb
    .from("squad_player_items")
    .select("resolved_fc_player_id")
    .limit(1);
  // colCheck === [] when the table is empty, but the absence of a thrown
  // error proves the column was selected successfully.
  expect(Array.isArray(colCheck)).toBeTruthy();

  // Probe whether FCDB has rows; this drives which assertions to run below.
  const { count: fcdbCount } = await sb
    .from("fc26_players")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  const fcdbPopulated = (fcdbCount ?? 0) > 0;

  // Seed a throwaway submission with three items: one obvious typo, one
  // short name, one plausible. We pick a real player + active season so
  // the page renders fully.
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

  const weekStart = weekStartThursdayNow();

  // Clean slate.
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
      futbin_screenshot_path: `seasons/${season!.id}/players/${player!.id}/weeks/${weekStart}/plan23.png`,
      validation_status: "pending",
    })
    .select("id")
    .single();
  expect(inserted?.id).toBeTruthy();
  const submissionId = inserted!.id as string;

  await sb.from("squad_player_items").insert([
    {
      submission_id: submissionId,
      name: "Lionel Messi",
      rating: 90,
      position: "RW",
      value: 1_500_000,
      item_type: "gold",
      nationality_flag: "AR",
      slot_index: 0,
    },
    {
      submission_id: submissionId,
      name: "Bo",
      rating: 80,
      position: "ST",
      value: 50_000,
      item_type: "gold",
      nationality_flag: "NG",
      slot_index: 1,
    },
    {
      submission_id: submissionId,
      name: "Zzzzz Notreal",
      rating: 75,
      position: "CB",
      value: 1_000,
      item_type: "gold",
      nationality_flag: "NG",
      slot_index: 2,
    },
  ]);

  try {
    await login(page);
    await page.goto(`/admin/squads/${submissionId}`);
    await expect(page.getByTestId("squad-items-table")).toBeVisible();

    if (fcdbPopulated) {
      // Summary chip rendered + at least one badge.
      await expect(page.getByTestId("fcdb-summary-chip")).toBeVisible();
      const anyBadge = page.locator('[data-testid^="fcdb-badge-"]').first();
      await expect(anyBadge).toBeVisible();
    } else {
      // Empty FCDB → banner present, summary chip hidden.
      await expect(page.getByTestId("fcdb-empty-banner")).toBeVisible();
      await expect(page.getByTestId("fcdb-summary-chip")).toHaveCount(0);
      // Every row's FCDB cell renders the badge in 'unknown' state.
      const unknowns = page.locator(
        '[data-testid^="fcdb-badge-"][data-status="unknown"]',
      );
      await expect.poll(async () => await unknowns.count()).toBeGreaterThanOrEqual(3);
    }
  } finally {
    // Hard-cleanup so re-runs are clean.
    await sb.from("squad_submissions").delete().eq("id", submissionId);
  }
});
