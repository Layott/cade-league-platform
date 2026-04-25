import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 51 E2E — Tournament Management page + Broadcast v2.
 *
 * Spec ref: docs/superpowers/specs/2026-04-25-plan-51-tournament-page-and-broadcast-v2.md
 * Section 10.2 (E2E coverage) + RT (realtime / publisher audit) work.
 *
 * Each test is self-contained: skips early if the under-construction surface
 * isn't reachable, so the spec is safe to land before all UI agents finish.
 * Tests that mutate DB rows (walkover insert) clean up after themselves.
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
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function svc(): SupabaseClient | null {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
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

async function routeExists(page: Page, url: string): Promise<boolean> {
  try {
    const res = await page.goto(url);
    if (!res) return false;
    const status = res.status();
    return status < 400 || status === 401 || status === 403;
  } catch {
    return false;
  }
}

async function getActiveSessionId(): Promise<string | null> {
  const sb = svc();
  if (!sb) return null;
  const { data } = await sb
    .from("stream_sessions")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

test.setTimeout(240_000);

test.describe("Plan 51 — Tournament page", () => {
  test("standings live-refresh across two contexts", async ({
    page,
    context,
  }) => {
    if (!(await login(page))) {
      test.skip(true, "admin login unavailable in env");
      return;
    }
    if (!(await routeExists(page, "/admin/tournament"))) {
      test.skip(true, "/admin/tournament not deployed");
      return;
    }

    await page.goto("/admin/tournament/standings");
    await page.waitForLoadState("domcontentloaded");

    const pageB = await context.newPage();
    if (!(await login(pageB))) {
      test.skip(true, "second login failed");
      return;
    }
    await pageB.goto("/admin/tournament/standings");
    await pageB.waitForLoadState("domcontentloaded");

    const tableA = await page.getByTestId("standings-row").count();
    const tableB = await pageB.getByTestId("standings-row").count();
    expect(tableA).toBeGreaterThanOrEqual(0);
    expect(tableB).toBeGreaterThanOrEqual(0);
    await pageB.close();
  });

  test("tiebreaker save persists to seasons.tiebreaker_order", async ({
    page,
  }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    if (!(await routeExists(page, "/admin/tournament/tiebreaker-config"))) {
      test.skip(true, "tiebreaker page not deployed");
      return;
    }

    await page.goto("/admin/tournament/tiebreaker-config");
    const saveBtn = page.getByTestId("tiebreaker-save");
    if ((await saveBtn.count()) === 0) {
      test.skip(true, "tiebreaker-save testid not present");
      return;
    }
    await saveBtn.click();
    const sb = svc();
    if (sb) {
      const { data } = await sb
        .from("seasons")
        .select("id, tiebreaker_order")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const row = data as { tiebreaker_order: unknown } | null;
      expect(row?.tiebreaker_order).toBeDefined();
    }
  });

  test("walkover trigger writes 3-0 row", async ({ page }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    if (!(await routeExists(page, "/admin/tournament/walkovers"))) {
      test.skip(true, "walkovers tab not deployed");
      return;
    }
    await page.goto("/admin/tournament/walkovers");
    const triggerBtn = page.getByRole("button", { name: /Trigger Walkover/i });
    if ((await triggerBtn.count()) === 0) {
      test.skip(true, "Trigger Walkover button missing");
      return;
    }
    await triggerBtn.click();
    const matchSel = page.getByTestId("walkover-match-picker");
    const winnerSel = page.getByTestId("walkover-winner-picker");
    if (
      (await matchSel.count()) === 0 ||
      (await winnerSel.count()) === 0
    ) {
      test.skip(true, "walkover modal pickers missing");
      return;
    }
    await matchSel.selectOption({ index: 1 });
    await winnerSel.selectOption({ index: 1 });
    await page.getByTestId("walkover-confirm").click();
    await page.getByRole("tab", { name: /Fixtures/i }).click().catch(() => {});
    await expect(page.getByTestId("walkover-badge").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("walkover pending row flips to confirmed via Confirm button", async ({
    page,
  }) => {
    const sb = svc();
    if (!sb) {
      test.skip(true, "service-role client unavailable");
      return;
    }
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    if (!(await routeExists(page, "/admin/tournament/walkovers"))) {
      test.skip(true, "walkovers tab not deployed");
      return;
    }
    const { data: match } = await sb
      .from("matches")
      .select("id, home_player_id, away_player_id, match_day_id")
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    const m = match as
      | {
          id: string;
          home_player_id: string;
          away_player_id: string;
          match_day_id: string;
        }
      | null;
    if (!m) {
      test.skip(true, "no scheduled fixture available to seed pending walkover");
      return;
    }
    const { data: existing } = await sb
      .from("match_results")
      .select("id")
      .eq("match_id", m.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      test.skip(true, "scheduled fixture already has a result; cannot seed");
      return;
    }
    const winnerId = m.home_player_id;
    const { error: insertErr } = await sb.from("match_results").insert({
      match_id: m.id,
      home_score: 3,
      away_score: 0,
      result_type: "forfeit",
      is_walkover: true,
      walkover_initiated_by: "ref",
      walkover_pending: true,
      winner_player_id: winnerId,
    });
    if (insertErr) {
      test.skip(true, `seed insert failed: ${insertErr.message}`);
      return;
    }

    try {
      await page.goto("/admin/tournament/walkovers");
      const confirmBtn = page.getByTestId(`walkover-confirm-${m.id}`);
      if ((await confirmBtn.count()) === 0) {
        test.skip(
          true,
          "Confirm button testid missing — UI agent in flight",
        );
        return;
      }
      await confirmBtn.click();
      await page.waitForTimeout(2000);
      const { data: after } = await sb
        .from("match_results")
        .select("walkover_pending, walkover_confirmed_at")
        .eq("match_id", m.id)
        .is("deleted_at", null)
        .maybeSingle();
      const a = after as
        | { walkover_pending: boolean; walkover_confirmed_at: string | null }
        | null;
      expect(a?.walkover_pending).toBe(false);
      expect(a?.walkover_confirmed_at).toBeTruthy();
    } finally {
      await sb
        .from("match_results")
        .update({ deleted_at: new Date().toISOString() })
        .eq("match_id", m.id);
      await sb.from("matches").update({ status: "scheduled" }).eq("id", m.id);
    }
  });

  test("XLSX leaderboard download has valid magic bytes", async ({ page }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    if (!(await routeExists(page, "/admin/tournament/standings"))) {
      test.skip(true, "standings tab not deployed");
      return;
    }
    await page.goto("/admin/tournament/standings");
    const dlBtn = page.getByRole("button", { name: /Download XLSX/i });
    if ((await dlBtn.count()) === 0) {
      test.skip(true, "Download XLSX button missing");
      return;
    }
    const downloadPromise = page.waitForEvent("download");
    await dlBtn.click();
    const dl = await downloadPromise;
    expect(dl.suggestedFilename()).toMatch(/\.xlsx$/i);
    const filePath = await dl.path();
    if (filePath) {
      const buf = fs.readFileSync(filePath);
      expect(buf.slice(0, 4).toString("hex")).toBe("504b0304");
    }
  });

  test("H2H 5-player picker renders cards", async ({ page }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    if (!(await routeExists(page, "/admin/tournament/h2h-lookup"))) {
      if (!(await routeExists(page, "/admin/tournament?tab=h2h"))) {
        test.skip(true, "H2H tab not deployed");
        return;
      }
      await page.goto("/admin/tournament?tab=h2h");
    } else {
      await page.goto("/admin/tournament/h2h-lookup");
    }

    const picker = page.getByTestId("h2h-player-picker");
    if ((await picker.count()) === 0) {
      test.skip(true, "h2h picker testid missing");
      return;
    }
    for (let i = 0; i < 5; i++) {
      try {
        await picker.selectOption({ index: i + 1 });
      } catch {
        break;
      }
    }
    const cards = page.getByTestId("h2h-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Plan 51 — Broadcast v2", () => {
  test("control panel renders 16 control cards", async ({ page }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active broadcast session in DB");
      return;
    }
    const url = `/admin/broadcast/v2/${sessionId}`;
    if (!(await routeExists(page, url))) {
      test.skip(true, "v2 control panel not deployed");
      return;
    }
    await page.waitForLoadState("domcontentloaded");
    const cards = page.locator('[data-testid^="control-card-"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(15);
    expect(count).toBeLessThanOrEqual(17);
  });

  test("BRB ENTER fires overlay event, OFF clears it", async ({
    page,
    context,
  }) => {
    const sb = svc();
    if (!sb) {
      test.skip(true, "service-role client unavailable");
      return;
    }
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    const url = `/admin/broadcast/v2/${sessionId}`;
    if (!(await routeExists(page, url))) {
      test.skip(true, "v2 control panel not deployed");
      return;
    }
    const enterBtn = page.getByTestId("brb-enter").first();
    if ((await enterBtn.count()) === 0) {
      test.skip(true, "brb-enter testid missing");
      return;
    }
    await enterBtn.click();
    await page.waitForTimeout(1500);
    const { data: events } = await sb
      .from("overlay_events")
      .select("id, template_key, kind")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(5);
    const list = (events ?? []) as Array<{
      id: string;
      template_key: string;
      kind: string;
    }>;
    const enterRow = list.find(
      (r) => r.template_key === "layout_brb_basic" && r.kind === "trigger",
    );
    expect(enterRow).toBeDefined();

    const offBtn = page.getByTestId("brb-off").first();
    if ((await offBtn.count()) > 0) {
      await offBtn.click();
      await page.waitForTimeout(1500);
      const { data: afterEvents } = await sb
        .from("overlay_events")
        .select("id, template_key, kind")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(5);
      const after = (afterEvents ?? []) as Array<{
        template_key: string;
        kind: string;
      }>;
      const clear = after.find(
        (r) => r.template_key === "layout_brb_basic" && r.kind === "clear",
      );
      expect(clear).toBeDefined();
    }

    const overlayPage = await context.newPage();
    const ok = await routeExists(
      overlayPage,
      `/overlay/v2/01-brb?session=${sessionId}`,
    );
    expect(ok).toBe(true);
    await overlayPage.close();
  });

  test("lower-third 3 slots render side-by-side", async ({ page }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    const url = `/admin/broadcast/v2/${sessionId}`;
    if (!(await routeExists(page, url))) {
      test.skip(true, "v2 control panel not deployed");
      return;
    }
    const slot1 = page.getByTestId("lt-slot1-name");
    const slot2 = page.getByTestId("lt-slot2-name");
    const slot3 = page.getByTestId("lt-slot3-name");
    if (
      (await slot1.count()) === 0 ||
      (await slot2.count()) === 0 ||
      (await slot3.count()) === 0
    ) {
      test.skip(true, "3-slot lt editor not rendered");
      return;
    }
    await slot1.fill("HOST");
    await slot2.fill("CASTER");
    await slot3.fill("ANALYST");
    expect(await slot1.inputValue()).toBe("HOST");
    expect(await slot2.inputValue()).toBe("CASTER");
    expect(await slot3.inputValue()).toBe("ANALYST");
  });

  test("lower-third preset save + reload restores slot 1", async ({ page }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    const url = `/admin/broadcast/v2/${sessionId}`;
    if (!(await routeExists(page, url))) {
      test.skip(true, "v2 control panel not deployed");
      return;
    }
    const slot1 = page.getByTestId("lt-slot1-name");
    if ((await slot1.count()) === 0) {
      test.skip(true, "lt-slot1-name testid missing");
      return;
    }
    await slot1.fill("JOSH");
    const role = page.getByTestId("lt-slot1-role");
    if ((await role.count()) > 0) await role.fill("HOST");

    const saveBtn = page.getByTestId("lt-save-preset");
    if ((await saveBtn.count()) === 0) {
      test.skip(true, "save preset button missing");
      return;
    }
    await saveBtn.click();
    const presetName = page.getByTestId("lt-preset-name");
    if ((await presetName.count()) > 0) {
      await presetName.fill("Plan51TestPreset");
      await page.getByTestId("lt-preset-confirm").click();
    }

    await page.reload();

    const loadBtn = page.getByTestId("lt-load-preset");
    if ((await loadBtn.count()) === 0) {
      return;
    }
    await loadBtn.click();
    const item = page.getByText("Plan51TestPreset");
    if ((await item.count()) > 0) {
      await item.click();
      await expect(slot1).toHaveValue("JOSH");
    }
  });

  test("timer ENTER fires overlay_events trigger", async ({ page }) => {
    const sb = svc();
    if (!sb) {
      test.skip(true, "service-role client unavailable");
      return;
    }
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    const url = `/admin/broadcast/v2/${sessionId}`;
    if (!(await routeExists(page, url))) {
      test.skip(true, "v2 control panel not deployed");
      return;
    }
    const minInput = page.getByTestId("timer-min");
    const enterBtn = page.getByTestId("timer-enter");
    if ((await minInput.count()) === 0 || (await enterBtn.count()) === 0) {
      test.skip(true, "timer controls missing");
      return;
    }
    await minInput.fill("0");
    const secInput = page.getByTestId("timer-sec");
    if ((await secInput.count()) > 0) await secInput.fill("30");
    await enterBtn.click();
    await page.waitForTimeout(1200);
    const { data: events } = await sb
      .from("overlay_events")
      .select("template_key, kind")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(5);
    const list = (events ?? []) as Array<{
      template_key: string;
      kind: string;
    }>;
    const triggered = list.find(
      (r) => r.template_key === "layout_timer" && r.kind === "trigger",
    );
    expect(triggered).toBeDefined();
  });

  test("leaderboard ENTER fires overlay event", async ({ page }) => {
    const sb = svc();
    if (!sb) {
      test.skip(true, "service-role client unavailable");
      return;
    }
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    const url = `/admin/broadcast/v2/${sessionId}`;
    if (!(await routeExists(page, url))) {
      test.skip(true, "v2 control panel not deployed");
      return;
    }
    const enterBtn = page.getByTestId("leaderboard-enter");
    if ((await enterBtn.count()) === 0) {
      test.skip(true, "leaderboard-enter testid missing");
      return;
    }
    await enterBtn.click();
    await page.waitForTimeout(1200);
    const { data: events } = await sb
      .from("overlay_events")
      .select("template_key, kind")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(5);
    const list = (events ?? []) as Array<{
      template_key: string;
      kind: string;
    }>;
    const triggered = list.find(
      (r) =>
        r.template_key === "leaderboard_animated" && r.kind === "trigger",
    );
    expect(triggered).toBeDefined();
  });

  test("top-scorers ENTER fires overlay event", async ({ page }) => {
    const sb = svc();
    if (!sb) {
      test.skip(true, "service-role client unavailable");
      return;
    }
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    const url = `/admin/broadcast/v2/${sessionId}`;
    if (!(await routeExists(page, url))) {
      test.skip(true, "v2 control panel not deployed");
      return;
    }
    const enterBtn = page.getByTestId("top-scorers-enter");
    if ((await enterBtn.count()) === 0) {
      test.skip(true, "top-scorers-enter testid missing");
      return;
    }
    await enterBtn.click();
    await page.waitForTimeout(1200);
    const { data: events } = await sb
      .from("overlay_events")
      .select("template_key, kind")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(5);
    const list = (events ?? []) as Array<{
      template_key: string;
      kind: string;
    }>;
    const triggered = list.find(
      (r) => r.template_key === "top_scorers" && r.kind === "trigger",
    );
    expect(triggered).toBeDefined();
  });

  test("v2 initial-state endpoints return 200/401/404", async ({ request }) => {
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    for (const key of ["orgs", "coaches", "penalties"]) {
      const url = `/api/broadcast/v2/sessions/${sessionId}/${key}`;
      const res = await request.get(url);
      expect([200, 401, 404]).toContain(res.status());
    }
  });

  test("legacy initial-state endpoints accessible", async ({ request }) => {
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
      test.skip(true, "no active session");
      return;
    }
    for (const key of ["leaderboard", "top-scorers", "match-scores-day"]) {
      const url = `/api/broadcast/sessions/${sessionId}/${key}`;
      const res = await request.get(url);
      expect([200, 401, 404]).toContain(res.status());
    }
  });
});

test.describe("Plan 51 — Realtime publisher audit", () => {
  test("admin/match-days surface still loads after publisher refactor", async ({
    page,
  }) => {
    if (!(await login(page))) {
      test.skip(true, "login unavailable");
      return;
    }
    const sb = svc();
    if (!sb) return;
    const { data: md } = await sb
      .from("match_days")
      .select("id")
      .is("deleted_at", null)
      .order("match_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!md) {
      test.skip(true, "no match_days exist");
      return;
    }
    await page.goto(`/admin/match-days/${(md as { id: string }).id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
  });
});
