import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Attendance Flow";

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

/**
 * Create (or reuse) a unique E2E match day for the attendance flow.
 * Returns { matchDayId, attendanceUrl }.
 */
async function ensureE2EMatchDay(): Promise<{ matchDayId: string; attendanceUrl: string }> {
  const sb = svc();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!season) throw new Error("active season not found — cannot run attendance E2E");

  // Stable near-future date so re-runs reuse the row (avoids leaking state).
  // Keep within the current decade so delta_seconds stays within int32 range.
  const matchDate = "2027-12-31";
  const { data: existing } = await sb
    .from("match_days")
    .select("id")
    .eq("season_id", season.id)
    .eq("match_date", matchDate)
    .is("deleted_at", null)
    .maybeSingle();

  let matchDayId = existing?.id ?? null;
  if (!matchDayId) {
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
    if (error || !created) throw new Error(`failed to create e2e match_day: ${error?.message}`);
    matchDayId = created.id as string;
  }

  // Reset attendance state: hard-delete any prior attendance marks + revoke
  // associated auto actions so the test starts clean.
  const { data: marks } = await sb
    .from("attendance_marks")
    .select("id, auto_action_id")
    .eq("match_day_id", matchDayId);
  for (const m of (marks ?? []) as { id: string; auto_action_id: string | null }[]) {
    if (m.auto_action_id) {
      await sb
        .from("disciplinary_actions")
        .update({
          revoked_at: new Date().toISOString(),
          revoke_reason: "e2e reset",
        })
        .eq("id", m.auto_action_id);
    }
    await sb.from("attendance_marks").delete().eq("id", m.id);
  }

  return {
    matchDayId,
    attendanceUrl: `/admin/match-days/${matchDayId}/attendance`,
  };
}

test.setTimeout(120_000);

test("admin marks absent → penalty appears → edits to present → penalty revoked", async ({
  page,
}) => {
  const { attendanceUrl, matchDayId } = await ensureE2EMatchDay();
  await login(page);

  // Navigate straight to our dedicated match day's attendance page.
  await page.goto(attendanceUrl);
  await expect(page.getByTestId("attendance-page")).toBeVisible();

  // Pick the first row and mark absent.
  const firstRow = page.locator("[data-testid^=att-row-]").first();
  await expect(firstRow).toBeVisible();
  const testid = await firstRow.getAttribute("data-testid");
  const playerId = testid!.replace("att-row-", "");

  await page.getByTestId(`att-btn-absent-${playerId}`).click();
  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("absent");

  // Confirm the auto-case + action landed in the DB with magnitude=3.
  const sb = svc();
  {
    const { data: mark } = await sb
      .from("attendance_marks")
      .select("id, auto_action_id, status")
      .eq("match_day_id", matchDayId)
      .eq("player_id", playerId)
      .single();
    expect(mark?.status).toBe("absent");
    expect(mark?.auto_action_id).not.toBeNull();

    const { data: action } = await sb
      .from("disciplinary_actions")
      .select("sanction_type, magnitude, revoked_at")
      .eq("id", mark!.auto_action_id)
      .single();
    expect(action?.sanction_type).toBe("point_deduction");
    expect(action?.magnitude).toBe(3);
    expect(action?.revoked_at).toBeNull();
  }

  // Now edit to present with a reason.
  await page.goto(attendanceUrl);
  await page.getByTestId(`att-edit-${playerId}`).click();
  await page.getByTestId(`att-reason-${playerId}`).fill("system test — revoking absence");
  await page.getByRole("combobox", { name: /new status/i }).selectOption("present");
  await page.getByRole("button", { name: "Save edit" }).click();

  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("present");

  // Confirm the auto action is revoked in the DB.
  {
    const { data: revoked } = await sb
      .from("disciplinary_actions")
      .select("revoked_at, revoke_reason")
      .not("revoke_reason", "is", null)
      .ilike("revoke_reason", "attendance edit%")
      .order("revoked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(revoked?.revoked_at).toBeTruthy();
  }
});

test("edit without reason is rejected by HTML5 validation", async ({ page }) => {
  const { attendanceUrl, matchDayId } = await ensureE2EMatchDay();
  await login(page);

  await page.goto(attendanceUrl);
  const firstRow = page.locator("[data-testid^=att-row-]").first();
  const testid = await firstRow.getAttribute("data-testid");
  const playerId = testid!.replace("att-row-", "");

  // Mark late so edit becomes available.
  await page.getByTestId(`att-btn-late-${playerId}`).click();
  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("late");

  await page.goto(attendanceUrl);
  await page.getByTestId(`att-edit-${playerId}`).click();
  await page.getByRole("button", { name: "Save edit" }).click();

  // HTML5 required + minLength blocks submission; status chip still reads late.
  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("late");
  // Reason textarea is still visible (form did not submit).
  await expect(page.getByTestId(`att-reason-${playerId}`)).toBeVisible();

  // Cleanup — revoke the late penalty directly so the state resets for next runs.
  const sb = svc();
  const { data: mark } = await sb
    .from("attendance_marks")
    .select("auto_action_id")
    .eq("match_day_id", matchDayId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (mark?.auto_action_id) {
    await sb
      .from("disciplinary_actions")
      .update({
        revoked_at: new Date().toISOString(),
        revoke_reason: "e2e cleanup",
      })
      .eq("id", mark.auto_action_id);
  }
});
