import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Plan 37 Editable";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

async function cleanup() {
  const sb = getServiceRoleClient();
  // Drop our test presets (label-prefixed for easy filter).
  await sb
    .from("overlay_presets")
    .update({ deleted_at: new Date().toISOString() })
    .like("label", "P37 E2E · %")
    .is("deleted_at", null);

  const { data: days } = await sb
    .from("match_days")
    .select("id")
    .eq("venue_name", E2E_VENUE)
    .is("deleted_at", null);
  const dayIds = (days ?? []).map((d) => d.id);
  if (dayIds.length > 0) {
    await sb
      .from("stream_sessions")
      .update({
        ended_at: new Date().toISOString(),
        deleted_at: new Date().toISOString(),
      })
      .in("match_day_id", dayIds)
      .is("ended_at", null);
    await sb
      .from("match_days")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", dayIds);
  }
}

test.afterAll(async () => {
  await cleanup();
});

test.setTimeout(180_000);

test("Plan 37 — preset CRUD + multi-instance lower-third + live clock", async ({
  browser,
  page,
}) => {
  await login(page);

  // 1. Disposable match day + start session.
  const sb = getServiceRoleClient();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();
  expect(season).toBeTruthy();
  // Generate a date inside the broadcast picker's [today-30, today+90] window
  // so the page resolves `selected` and renders the start-session button.
  const future = new Date();
  future.setDate(future.getDate() + 60 + Math.floor(Math.random() * 20));
  const uniqueYmd = future.toISOString().slice(0, 10);
  const { data: md } = await sb
    .from("match_days")
    .insert({
      season_id: season!.id,
      match_date: uniqueYmd,
      arrival_cutoff_time: "18:00",
      match_start_time: "19:00",
      venue_name: E2E_VENUE,
    })
    .select("id")
    .single();
  expect(md?.id).toBeTruthy();

  await page.goto(`/admin/broadcast?matchDayId=${md!.id}`);
  await page.getByTestId("start-session-btn").click();
  await expect(page).toHaveURL(/\/admin\/broadcast\/[0-9a-f-]+/);
  const sessionId = page.url().split("/").pop()!;

  // 2. Save TWO lower-third presets via the editable panel save form.
  const savePreset = async (label: string, payload: object) => {
    const panel = page.getByTestId("editable-panel-lower_third");
    await expect(panel).toBeVisible();
    await panel.getByTestId("preset-label-lower_third").fill(label);
    await panel
      .getByTestId("preset-payload-lower_third")
      .fill(JSON.stringify(payload));
    await panel.getByTestId("save-preset-btn-lower_third").click();
    await page.waitForLoadState("networkidle");
  };

  await savePreset("P37 E2E · Caster Rhymez", {
    playerId: "11111111-1111-4111-8111-111111111111",
    displayName: "Rhymez",
    gamerTag: "RHYMEZ_FC",
    jerseyNumber: 10,
  });
  await savePreset("P37 E2E · Sponsor X", {
    playerId: "22222222-2222-4222-8222-222222222222",
    displayName: "Sponsor X",
    gamerTag: "SPONSOR_X",
    jerseyNumber: 99,
  });

  // Reload to confirm both presets persist on a fresh server render.
  await page.reload();
  await page.waitForLoadState("networkidle");
  const ltAfterReload = page.getByTestId("editable-panel-lower_third");
  await expect(ltAfterReload.getByText("P37 E2E · Caster Rhymez")).toBeVisible();
  await expect(ltAfterReload.getByText("P37 E2E · Sponsor X")).toBeVisible();

  // 3. Open the multi-instance overlay tab.
  const overlayCtx: BrowserContext = await browser.newContext();
  const overlayPage = await overlayCtx.newPage();
  await overlayPage.goto(`/overlay/lower-third?session=${sessionId}`);

  // 4. Trigger to slot 1 (default radio) directly via the trigger form.
  const ltLive = page.getByTestId("editable-panel-lower_third");
  await ltLive.getByTestId("slot-radio-lower_third-1").check();
  await ltLive.getByTestId("trigger-payload-lower_third").fill(
    JSON.stringify({
      playerId: "33333333-3333-4333-8333-333333333333",
      displayName: "ZED",
      gamerTag: "ZED_FC",
      jerseyNumber: 7,
    }),
  );
  await ltLive.getByTestId("trigger-btn-lower_third").click();

  // Slot 1 renders.
  await expect(overlayPage.getByTestId("lower-third-slot-1")).toBeVisible({
    timeout: 5_000,
  });

  // 5. Trigger another payload to slot 3.
  await page.reload();
  const ltPanel2 = page.getByTestId("editable-panel-lower_third");
  await ltPanel2.getByTestId("slot-radio-lower_third-3").check();
  await ltPanel2.getByTestId("trigger-payload-lower_third").fill(
    JSON.stringify({
      playerId: "44444444-4444-4444-8444-444444444444",
      displayName: "Sponsor Mark",
      gamerTag: "GAMEPRIDE",
      jerseyNumber: 1,
    }),
  );
  await ltPanel2.getByTestId("trigger-btn-lower_third").click();

  await expect(overlayPage.getByTestId("lower-third-slot-3")).toBeVisible({
    timeout: 5_000,
  });
  // Slot 1 still rendering.
  await expect(overlayPage.getByTestId("lower-third-slot-1")).toBeVisible();

  // 6. Match-clock: set countdown 5:00 → start.
  // Plan 45 — minutes + seconds inputs replaced the raw seconds field.
  const clockPanel = page.getByTestId("match-clock-panel");
  await expect(clockPanel).toBeVisible();
  await clockPanel.getByTestId("clock-label").fill("WARMUP");
  await clockPanel.getByTestId("clock-minutes").fill("5");
  await clockPanel.getByTestId("clock-seconds").fill("0");
  await clockPanel.getByTestId("clock-set").click();
  await page.waitForLoadState("networkidle");
  await clockPanel.getByTestId("clock-start").click();

  // Open timer overlay.
  const timerPage = await overlayCtx.newPage();
  await timerPage.goto(`/overlay/layout-timer?session=${sessionId}`);
  await expect(timerPage.getByTestId("layout-timer")).toBeVisible({
    timeout: 5_000,
  });

  // 7. Cleanup: end session.
  await page.getByTestId("end-session-btn").click();
  await expect(page).toHaveURL(/\/admin\/broadcast$/);

  await overlayCtx.close();
});
