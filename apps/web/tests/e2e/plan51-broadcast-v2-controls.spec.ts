import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 51 — broadcast v2 control panel E2E.
 *
 * Acceptance criteria:
 *   1. /admin/broadcast/v2/[sessionId] renders 16 control cards.
 *   2. Lower-third slot 1 ENTER fires → an `overlay_active_instances`
 *      row exists for the session + slot 1.
 *   3. The same slot 1 OFF clears that row (cleared_at IS NOT NULL).
 *   4. The page surfaces a copy view-token button + an "open legacy"
 *      link to the legacy /admin/broadcast/[sessionId] route.
 *
 * Prerequisites (skip on missing): active season, ≥2 players, admin
 * login, `broadcast.v2.read`+`broadcast.v2.trigger` perms applied to
 * admin (Plan 51 migration `20260525000003`).
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E V2 Control";

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
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required",
    );
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

const ALL_OVERLAY_KEYS = [
  "01-brb",
  "02-timer",
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "08-lower-third",
  "09-secondary-score-bug",
  "10-up-next-bug",
  "11-match-scores-day",
  "12-starting-soon",
  "13-stream-ended",
  "14-top-scorers",
  "15-orgs",
  "16-coaches",
  "17-penalties",
];

test.describe("Plan 51 — broadcast v2 control panel", () => {
  test("renders 16 control cards + lower-third ENTER/OUT round-trips", async ({
    page,
  }) => {
    const sb = getServiceRoleClient();

    const { data: season } = await sb
      .from("seasons")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    test.skip(!season, "no active season — skipping plan-51 v2 spec");

    const seasonId = (season as { id: string }).id;

    // Resolve admin user id for the FK on stream_sessions.
    const { data: adminUser } = await sb
      .from("users")
      .select("id")
      .eq("email", ADMIN_EMAIL)
      .is("deleted_at", null)
      .maybeSingle();
    test.skip(!adminUser, `admin user ${ADMIN_EMAIL} missing`);

    // Reuse / create today's match-day.
    const today = new Date().toISOString().slice(0, 10);
    const { data: existingMd } = await sb
      .from("match_days")
      .select("id")
      .eq("season_id", seasonId)
      .eq("match_date", today)
      .is("deleted_at", null)
      .maybeSingle();
    let matchDayId: string;
    let createdMatchDay = false;
    if (existingMd) {
      matchDayId = (existingMd as { id: string }).id;
    } else {
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
      matchDayId = (md as { id: string }).id;
      createdMatchDay = true;
    }

    const { data: sess, error: sessErr } = await sb
      .from("stream_sessions")
      .insert({
        match_day_id: matchDayId,
        session_tag: E2E_VENUE,
        started_by_user_id: (adminUser as { id: string }).id,
        view_token: Array.from({ length: 32 }, () =>
          Math.random().toString(36).charAt(2),
        ).join(""),
      })
      .select("id, view_token")
      .single();
    test.skip(
      !!sessErr || !sess,
      `stream_session insert failed: ${sessErr?.message}`,
    );
    const sessionId = (sess as { id: string }).id;
    const viewToken = (sess as { view_token: string | null }).view_token;

    try {
      const ok = await login(page);
      test.skip(!ok, "login failed; dev server unreachable");

      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      await page.goto(`/admin/broadcast/v2/${sessionId}`, {
        waitUntil: "networkidle",
      });

      // 1) Page shell renders + 16 cards visible.
      await expect(page.getByTestId("broadcast-v2-session")).toBeVisible();
      await expect(page.getByTestId("v2-control-grid")).toBeVisible();
      for (const k of ALL_OVERLAY_KEYS) {
        await expect(
          page.getByTestId(`v2-card-${k}`),
          `card ${k} should render`,
        ).toBeVisible();
      }
      expect(ALL_OVERLAY_KEYS.length).toBe(16);

      // 2) Header surfaces copy-view-token + open-legacy link.
      if (viewToken) {
        await expect(page.getByTestId("v2-copy-token")).toBeVisible();
      }
      const legacy = page.getByTestId("v2-open-legacy");
      await expect(legacy).toBeVisible();
      await expect(legacy).toHaveAttribute(
        "href",
        `/admin/broadcast/${sessionId}`,
      );

      // 3) Lower-third slot 1 ENTER → overlay_active_instances row.
      const ltCard = page.getByTestId("v2-card-08-lower-third");
      await ltCard.scrollIntoViewIfNeeded();
      await ltCard.getByTestId("v2-lt-enter-1").click();
      // The action revalidates the page; give it a beat to settle.
      await page.waitForTimeout(1500);

      const { data: inst } = await sb
        .from("overlay_active_instances")
        .select("id, instance_slot, cleared_at, payload")
        .eq("stream_session_id", sessionId)
        .eq("template_key", "lower_third")
        .eq("instance_slot", 1)
        .order("triggered_at", { ascending: false })
        .limit(1);
      expect((inst ?? []).length).toBeGreaterThan(0);
      const enteredRow = (inst ?? [])[0] as {
        id: string;
        cleared_at: string | null;
      } | null;
      expect(enteredRow?.cleared_at).toBeNull();

      // 4) Lower-third slot 1 OFF → cleared_at populated.
      await ltCard.getByTestId("v2-lt-off-1").click();
      await page.waitForTimeout(1500);

      const { data: cleared } = await sb
        .from("overlay_active_instances")
        .select("id, cleared_at")
        .eq("id", enteredRow!.id)
        .maybeSingle();
      expect((cleared as { cleared_at: string | null } | null)?.cleared_at).not.toBeNull();

      // 5) Hard tripwire — no nested-form / hydration / runtime React
      //    errors (Plan 48.3 lesson — control room is form-heavy).
      const relevantErrors = errors.filter((e) => {
        const lower = e.toLowerCase();
        if (lower.includes("favicon")) return false;
        if (lower.includes("failed to load resource")) return false;
        if (lower.includes("download the react devtools")) return false;
        return true;
      });
      expect(relevantErrors).toEqual([]);
    } finally {
      // Cleanup created rows. overlay_active_instances cascades through
      // stream_session FK so no explicit delete needed there.
      await sb
        .from("stream_sessions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", sessionId);
      if (createdMatchDay) {
        await sb
          .from("match_days")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", matchDayId);
      }
    }
  });
});
