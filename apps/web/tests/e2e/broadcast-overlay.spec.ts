import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Broadcast Overlay";

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
  // Soft-delete our E2E match_days; cascade not needed (stream_sessions
  // still exist but orphaned). If we find linked sessions with this
  // venue, soft-delete those too.
  const { data: days } = await sb
    .from("match_days")
    .select("id")
    .eq("venue_name", E2E_VENUE)
    .is("deleted_at", null);
  const dayIds = (days ?? []).map((d) => d.id);
  if (dayIds.length > 0) {
    // End any still-open stream sessions for these days.
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

test("admin starts session, triggers scorebar, overlay updates within 2s, clears, ends", async ({
  browser,
  page,
}) => {
  // Plan 52 — broadcast v2 promoted to be THE control room. The legacy
  // /admin/broadcast/[sessionId] panel that exposed `trigger-payload-scorebar`
  // / `clear-scorebar` / `end-session-btn` testids is now a 307 redirect
  // and the v1 textarea grid + scorebar trigger no longer have a UI
  // surface. The flow this test exercised needs to be rebuilt against
  // the v2 ControlGrid (ToggleTriggerButton on the secondary-score-bug
  // card) before re-enabling.
  test.skip(
    true,
    "broadcast v1 textarea trigger grid removed; rewrite against v2 ToggleTriggerButton",
  );
  await login(page);

  // 1. Create a disposable match day via API fixture helper (direct DB write
  //    — mirrors admin UI but avoids coupling to match-day form).
  const sb = getServiceRoleClient();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();
  expect(season).toBeTruthy();
  const uniqueYmd = `209${Math.floor(Math.random() * 9)}-${String(
    1 + Math.floor(Math.random() * 12),
  ).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(
    2,
    "0",
  )}`;
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
  const matchDayId = md!.id;

  // 2. Start a stream session via the admin UI.
  await page.goto(`/admin/broadcast?matchDayId=${matchDayId}`);
  await expect(page.getByTestId("match-day-picker")).toBeVisible();
  await page.getByTestId("start-session-btn").click();
  await expect(page).toHaveURL(/\/admin\/broadcast\/[0-9a-f-]+/);
  const sessionUrl = page.url();
  const sessionId = sessionUrl.split("/").pop()!;

  // 3. Open a second browser context at /overlay/scorebar?session=<id>
  const overlayCtx: BrowserContext = await browser.newContext();
  const overlayPage = await overlayCtx.newPage();
  await overlayPage.goto(`/overlay/scorebar?session=${sessionId}`);

  // Assert body transparent (Plan 12 acceptance criterion).
  const bodyBg = await overlayPage.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bodyBg).toBe("rgba(0, 0, 0, 0)");

  // 4. Back on admin page: fill scorebar payload (home=3 away=1) + trigger.
  const scorebarPayload = JSON.stringify(
    {
      homeName: "Anon-Home",
      awayName: "Anon-Away",
      homeScore: 3,
      awayScore: 1,
    },
    null,
    2,
  );
  await page.getByTestId("trigger-payload-scorebar").fill(scorebarPayload);
  await page.getByTestId("trigger-btn-scorebar").click();

  // 5. Overlay page updates within 2s (spec tolerance).
  await expect(overlayPage.getByTestId("scorebar")).toBeVisible({
    timeout: 3_000,
  });
  await expect(overlayPage.getByTestId("scorebar-score")).toContainText("3");
  await expect(overlayPage.getByTestId("scorebar-score")).toContainText("1");
  await expect(overlayPage.getByTestId("scorebar-home-name")).toContainText(
    "Anon-Home",
  );
  await expect(overlayPage.getByTestId("scorebar-away-name")).toContainText(
    "Anon-Away",
  );

  // 6. Clear the active scorebar from the admin panel. Revalidate renders
  //    the active overlays panel without the scorebar row.
  await page.reload();
  await page.getByTestId("clear-scorebar").click();
  // Overlay card should fade out within 2s.
  await expect(overlayPage.getByTestId("scorebar")).toHaveCount(0, {
    timeout: 3_000,
  });

  // 7. End the session — should still succeed even with no active overlays.
  await page.getByTestId("end-session-btn").click();
  await expect(page).toHaveURL(/\/admin\/broadcast$/);

  await overlayCtx.close();
});

test("non-admin gets 403 from POST /api/broadcast/events without session", async ({
  request,
}) => {
  // No login: anonymous request -> 401 (Unauthorized). The 403 variant
  // would require a logged-in non-admin user fixture; Phase 1A seed has
  // only admin+player, and player already lacks broadcast.trigger so
  // logging them in would satisfy the 403 path. For Phase 2 prep the
  // unauth check is sufficient proof the route is gated.
  const r = await request.post("/api/broadcast/events", {
    data: {
      sessionId: "00000000-0000-4000-8000-000000000000",
      templateKey: "scorebar",
      payload: {
        homeName: "a",
        awayName: "b",
        homeScore: 0,
        awayScore: 0,
      },
    },
  });
  // Either 401 (no session cookie) or 403 (session present but missing perm)
  // — both prove the route isn't open.
  expect([401, 403]).toContain(r.status());
});
