import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 42.2 + 42.3 + 48.3 (2026-04-24) — verification for three shipped changes:
 *
 *   1) `updateScoreBug` now lazily auto-creates the missing score_bug row
 *      instead of throwing "no active score_bug for primary slot". This
 *      test drives the UI directly: it creates a session + match, directly
 *      calls the score delta action without firing startMatch, and
 *      asserts the score updates to 1 : 0.
 *
 *   2) Plan 48.3 — the old standalone `BroadcastPreviewGrid` is GONE. Mini
 *      iframes are now embedded INSIDE each `EditableTemplatePanel` and
 *      legacy `trigger-card-*` container so the producer sees a change
 *      take effect next to the control that fired it. The test asserts
 *      the mini-preview nests inside `editable-panel-score_bug` (slot-
 *      capable, so two tiles — primary + secondary).
 *
 *   3) Plan 48.3 — the nested-form DOM violation from OffTriggerButton
 *      inside the Edit & trigger form is fixed. Zero "cannot be a
 *      descendant" / "cannot contain a nested form" warnings in the
 *      browser console after page load.
 *
 * Tolerant of network / seed gating: if required prerequisites are
 * missing the test is skipped rather than failing. Mirrors the existing
 * match-aware-broadcast spec pattern.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const E2E_VENUE = "E2E Mini Preview";

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

test.describe("Plan 42.2 — lazy auto-create score_bug + Plan 48.3 inline mini preview", () => {
  test("score +1 without startMatch seeds the bug + mini preview nests inside editable panel", async ({
    page,
  }) => {
    // Plan 52 — broadcast v2 promoted; the v1 EditableTemplatePanel +
    // MatchControlPanel that this test exercised live behind a redirect
    // now. The lazy score-bug fix is still covered by unit tests on
    // `@/server/broadcast/match_flow`. Rewrite against the v2 control
    // grid before re-enabling.
    test.skip(
      true,
      "v1 mini-preview + match-control panels removed; rewrite against v2 cards when ported",
    );
    const sb = getServiceRoleClient();

    const { data: season, error: seasonErr } = await sb
      .from("seasons")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    test.skip(!season, `no active season in DB (err=${seasonErr?.message}); skipping`);

    const { data: players, error: playersErr } = await sb
      .from("players")
      .select("id, gamer_tag")
      .is("deleted_at", null)
      .limit(2);
    test.skip(!players || players.length < 2, `need 2 players in roster (err=${playersErr?.message})`);

    const seasonId = (season as { id: string }).id;
    const [pHome, pAway] = players as Array<{ id: string; gamer_tag: string }>;

    // Create throwaway match_day + match for today.
    const today = new Date().toISOString().slice(0, 10);
    // Reuse today's match_day if present — the unique (season_id, match_date)
    // constraint blocks us from creating a parallel one. Fall through to
    // insert when missing.
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

    // Reuse any existing scheduled/in_progress match between these two
    // players on this match_day — the 78-match round-robin fixture table
    // already holds a row for every pair in the season.
    const { data: existingMatch } = await sb
      .from("matches")
      .select("id")
      .eq("season_id", seasonId)
      .eq("match_day_id", matchDayId)
      .eq("home_player_id", pHome.id)
      .eq("away_player_id", pAway.id)
      .is("deleted_at", null)
      .maybeSingle();
    let matchId: string;
    let createdMatch = false;
    if (existingMatch) {
      matchId = (existingMatch as { id: string }).id;
    } else {
      const { data: match, error: matchErr } = await sb
        .from("matches")
        .insert({
          season_id: seasonId,
          match_day_id: matchDayId,
          home_player_id: pHome.id,
          away_player_id: pAway.id,
          scheduled_time: "18:00:00",
          status: "in_progress",
        })
        .select("id")
        .single();
      test.skip(!!matchErr || !match, `match insert failed: ${matchErr?.message}`);
      matchId = (match as { id: string }).id;
      createdMatch = true;
    }

    // Resolve a real admin user id so the stream_sessions insert satisfies
    // the started_by_user_id FK.
    const { data: adminUser } = await sb
      .from("users")
      .select("id")
      .eq("email", ADMIN_EMAIL)
      .is("deleted_at", null)
      .maybeSingle();
    test.skip(!adminUser, `admin user ${ADMIN_EMAIL} not found in DB`);

    // Pin the match directly on a new stream_session WITHOUT firing
    // startMatch — this is the failure mode: the slot has a matchId but
    // no score_bug overlay event. The fix makes +1 auto-create the bug.
    const { data: sess, error: sessErr } = await sb
      .from("stream_sessions")
      .insert({
        match_day_id: matchDayId,
        session_tag: E2E_VENUE,
        primary_match_id: matchId,
        primary_match_started_at: new Date().toISOString(),
        started_by_user_id: (adminUser as { id: string }).id,
        view_token: Array.from({ length: 32 }, () =>
          Math.random().toString(36).charAt(2),
        ).join(""),
      })
      .select("id, view_token")
      .single();
    test.skip(!!sessErr || !sess, `stream_session insert failed: ${sessErr?.message}`);
    const sessionId = (sess as { id: string }).id;
    const viewToken = (sess as { view_token: string | null }).view_token;

    try {
      const ok = await login(page);
      test.skip(!ok, "login failed; dev server unreachable");

      // Navigate directly to the pinned session.
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      await page.goto(`/admin/broadcast/${sessionId}`, {
        waitUntil: "networkidle",
      });

      // The match-control-panel + primary slot should be visible.
      await expect(page.getByTestId("match-control-panel")).toBeVisible();
      await expect(page.getByTestId("match-slot-primary")).toBeVisible();

      // No score_bug overlay exists yet for this session — this is the
      // state where +1 used to throw. Assert the panel still offers the
      // +1 button (present when hasCurrent = true, which is derived from
      // primaryDigest = matchId !== null).
      const plusBtn = page.getByTestId("score-primary-home-plus");
      await expect(plusBtn).toBeVisible();

      // Plan 48.3 fixed the nested-form hydration blocker, so a single
      // click is now enough. Keep a tight retry in case the dev-server
      // cold-starts the chunk on first navigation.
      let scored = false;
      for (let attempt = 0; attempt < 2 && !scored; attempt++) {
        await plusBtn.click();
        try {
          await expect(page.getByTestId("score-primary-home")).toHaveText(
            "1",
            { timeout: 6_000 },
          );
          scored = true;
        } catch {
          await page.waitForTimeout(800);
        }
      }
      expect(scored).toBe(true);
      await expect(page.getByTestId("score-primary-away")).toHaveText("0");

      // Verify a score_bug overlay_events row now exists for the slot.
      const { data: events } = await sb
        .from("overlay_events")
        .select("id, payload")
        .eq("stream_session_id", sessionId)
        .is("cleared_at", null)
        .is("deleted_at", null);
      const bugs = (events ?? []).filter((e) => {
        const p = (e as { payload: { slot?: string } }).payload;
        return p && p.slot === "primary";
      });
      expect(bugs.length).toBeGreaterThan(0);

      // --- Plan 48.3: inline mini preview inside editable panel --------
      // The old standalone BroadcastPreviewGrid is gone — mini-previews
      // now nest inside each EditableTemplatePanel (slot-capable → two
      // tiles) and legacy trigger-card-*.
      const scoreBugPanel = page.getByTestId("editable-panel-score_bug");
      await expect(scoreBugPanel).toBeVisible();

      // Plan 48.4 — mini-preview iframes are now IntersectionObserver-
      // gated lazy-mount. Scroll the panel into view so the observer
      // fires; the tile then injects the iframe. Staggered fallback
      // timer (≤ 3s) also trips regardless.
      await scoreBugPanel.scrollIntoViewIfNeeded();

      // Primary + secondary mini-previews must live INSIDE that panel.
      const scoreBugPrimaryTile = scoreBugPanel.getByTestId(
        "mini-preview-score_bug-primary",
      );
      const scoreBugSecondaryTile = scoreBugPanel.getByTestId(
        "mini-preview-score_bug-secondary",
      );
      await expect(scoreBugPrimaryTile).toBeVisible();
      await expect(scoreBugSecondaryTile).toBeVisible();

      // The iframe inside should have the right src (session + slot + t).
      // Allow up to the lazy-mount fallback budget for the iframe to
      // be injected into the DOM.
      const iframe = scoreBugPanel.getByTestId(
        "mini-preview-iframe-score_bug-primary",
      );
      await expect(iframe).toBeAttached({ timeout: 10_000 });
      const src = await iframe.getAttribute("src");
      expect(src).toContain(`/overlay/score-bug`);
      expect(src).toContain(`session=${sessionId}`);
      expect(src).toContain(`slot=primary`);
      if (viewToken) {
        expect(src).toContain(`t=${viewToken}`);
      }

      // Copy button per tile — also INSIDE the panel.
      await expect(
        scoreBugPanel.getByTestId("mini-preview-copy-score_bug-primary"),
      ).toBeVisible();

      // Sanity-check a legacy trigger card too — scorebar is not editable
      // but still gets an inline mini preview.
      const scorebarCard = page.getByTestId("trigger-card-scorebar");
      await scorebarCard.scrollIntoViewIfNeeded();
      await expect(scorebarCard).toBeVisible();
      await expect(
        scorebarCard.getByTestId("mini-preview-scorebar"),
      ).toBeVisible();

      // No runtime errors. Plan 48.3 also fixes the nested-form DOM
      // violation so "cannot be a descendant" warnings should be GONE.
      // Tripwire ANY such warning now.
      const relevantErrors = errors.filter((e) => {
        const lower = e.toLowerCase();
        if (lower.includes("favicon")) return false;
        if (lower.includes("download the react devtools")) return false;
        if (lower.includes("failed to load resource")) return false;
        return true;
      });
      expect(relevantErrors).toEqual([]);
    } finally {
      // Cleanup — soft-delete what we created.
      await sb
        .from("overlay_events")
        .delete()
        .eq("stream_session_id", sessionId);
      await sb
        .from("stream_sessions")
        .update({
          ended_at: new Date().toISOString(),
          deleted_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      await sb.from("match_results").delete().eq("match_id", matchId);
      if (createdMatch) {
        await sb.from("matches").delete().eq("id", matchId);
      } else {
        // Reset the fixture row to its pre-test scheduled status so the
        // league data stays consistent.
        await sb
          .from("matches")
          .update({ status: "scheduled", updated_at: new Date().toISOString() })
          .eq("id", matchId);
      }
      if (createdMatchDay) {
        await sb.from("match_days").delete().eq("id", matchDayId);
      }
    }
  });
});
