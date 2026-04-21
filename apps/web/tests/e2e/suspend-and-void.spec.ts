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

test.setTimeout(240_000);

test("suspension voids both scheduled matches; revoke un-voids", async ({ page }) => {
  const sb = svc();

  // Build the fixture: two synthetic players + two match_days + two matches.
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .single();

  const tagQ = `e2e-susp-q-${Date.now()}`;
  const tagR = `e2e-susp-r-${Date.now()}`;

  const { data: uQ } = await sb
    .from("users")
    .insert({
      supabase_auth_id: crypto.randomUUID(),
      email: `${tagQ}@e2e.local`,
      display_name: `E2E Susp Q`,
    })
    .select("id")
    .single();
  const { data: uR } = await sb
    .from("users")
    .insert({
      supabase_auth_id: crypto.randomUUID(),
      email: `${tagR}@e2e.local`,
      display_name: `E2E Susp R`,
    })
    .select("id")
    .single();

  const { data: pQ } = await sb
    .from("players")
    .insert({ user_id: uQ!.id, gamer_tag: tagQ })
    .select("id")
    .single();
  const { data: pR } = await sb
    .from("players")
    .insert({ user_id: uR!.id, gamer_tag: tagR })
    .select("id")
    .single();

  await sb
    .from("season_participants")
    .insert({ season_id: season!.id, player_id: pQ!.id });
  await sb
    .from("season_participants")
    .insert({ season_id: season!.id, player_id: pR!.id });

  // Two future match days.
  const ds1 = "2031-03-07";
  const ds2 = "2031-03-14";

  const mkMd = async (d: string, venue: string) => {
    const { data: existing } = await sb
      .from("match_days")
      .select("id")
      .eq("season_id", season!.id)
      .eq("match_date", d)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) return existing.id as string;
    const { data } = await sb
      .from("match_days")
      .insert({
        season_id: season!.id,
        match_date: d,
        arrival_cutoff_time: "19:15:00",
        match_start_time: "19:30:00",
        venue_name: venue,
      })
      .select("id")
      .single();
    return data!.id as string;
  };

  const md1 = await mkMd(ds1, "Susp Venue A");
  const md2 = await mkMd(ds2, "Susp Venue B");

  const { data: m1 } = await sb
    .from("matches")
    .insert({
      season_id: season!.id,
      match_day_id: md1,
      home_player_id: pQ!.id,
      away_player_id: pR!.id,
      status: "scheduled",
    })
    .select("id")
    .single();
  const { data: m2 } = await sb
    .from("matches")
    .insert({
      season_id: season!.id,
      match_day_id: md2,
      home_player_id: pR!.id,
      away_player_id: pQ!.id,
      status: "scheduled",
    })
    .select("id")
    .single();

  await login(page);

  // Issue a suspension via /admin/punishments/new covering both match dates.
  await page.goto("/admin/punishments/new");
  await page.locator('select[name="playerId"]').selectOption(pQ!.id as string);
  await page.locator('select[name="incidentType"]').selectOption("other");
  await page.locator('select[name="sanctionType"]').selectOption("ban");
  await page.locator('input[name="effectiveFrom"]').fill(ds1);
  await page.locator('input[name="effectiveUntil"]').fill(ds2);

  // Blur to trigger preview fetch.
  await page.locator('input[name="effectiveUntil"]').blur();
  await expect(page.getByTestId("void-preview")).toContainText(/void 2 scheduled/i, {
    timeout: 10_000,
  });

  // Submit the form.
  await page.getByRole("button", { name: "Issue punishment" }).click();
  await expect(page).toHaveURL(/\/admin\/punishments$/, { timeout: 15_000 });

  // Assert both matches are now voided.
  const assertVoided = async (matchId: string) => {
    const { data: mr } = await sb
      .from("match_results")
      .select("result_type, notes")
      .eq("match_id", matchId)
      .maybeSingle();
    expect(mr?.result_type).toBe("void");
    expect(mr?.notes).toContain("auto-voided");
    const { data: match } = await sb
      .from("matches")
      .select("status")
      .eq("id", matchId)
      .single();
    expect(match?.status).toBe("voided");
  };
  await assertVoided(m1!.id as string);
  await assertVoided(m2!.id as string);

  // Now revoke the ban.
  const { data: action } = await sb
    .from("disciplinary_actions")
    .select("id, case_id")
    .eq("sanction_type", "ban")
    .order("imposed_at", { ascending: false })
    .limit(1)
    .single();
  await sb
    .from("disciplinary_actions")
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: "e2e un-suspend",
    })
    .eq("id", action!.id);

  // Assert matches reset to scheduled and no void rows.
  for (const mid of [m1!.id, m2!.id]) {
    const { data: match } = await sb
      .from("matches")
      .select("status")
      .eq("id", mid)
      .single();
    expect(match?.status).toBe("scheduled");
    const { data: mr } = await sb
      .from("match_results")
      .select("id")
      .eq("match_id", mid)
      .maybeSingle();
    expect(mr).toBeNull();
  }

  // Cleanup.
  await sb.from("disciplinary_actions").update({ deleted_at: new Date().toISOString() })
    .eq("id", action!.id);
  await sb.from("disciplinary_cases").update({ deleted_at: new Date().toISOString() })
    .eq("id", action!.case_id);
  await sb.from("matches").delete().in("id", [m1!.id, m2!.id]);
  await sb.from("season_participants").delete().in("player_id", [pQ!.id, pR!.id]);
  await sb.from("players").delete().in("id", [pQ!.id, pR!.id]);
});
