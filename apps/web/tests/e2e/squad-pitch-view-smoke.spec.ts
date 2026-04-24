import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Smoke coverage for the new SquadPitchView surface (2026-04-24).
 *
 * We reuse the existing FARUK approved-squad seed (inserted during earlier
 * E2E runs + kept by the squad-submission-flow self-cleaning cleanup only
 * when it ran to completion). Rather than depend on that, we query for
 * ANY player with an approved submission for the current week and hit
 * their public profile.
 *
 * Public profile route requires no auth, so this lane is cheap to run.
 * Admin + player lanes are covered by the existing squad-submission-flow
 * spec end-to-end already; here we just lock in the pitch markers (not
 * the old <ul> rows).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test("public player profile renders submitted squad as a pitch view", async ({
  page,
}) => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_SERVICE_ROLE,
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot seed-verify against cloud DB",
  );

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  // Find any player with an approved submission whose items carry FCDB
  // resolution. We don't seed data here — rely on the real FARUK row the
  // admin submitted during manual QA.
  const { data: subs } = await sb
    .from("squad_submissions")
    .select("id, player_id")
    .eq("validation_status", "approved")
    .is("deleted_at", null)
    .limit(1);
  test.skip(
    !subs || subs.length === 0,
    "no approved squad submission in DB — skip pitch smoke",
  );
  const playerId = subs![0].player_id;

  await page.goto(`/players/${playerId}`);
  await expect(page.getByTestId("public-week-squad")).toBeVisible();
  await expect(page.getByTestId("squad-pitch-view")).toBeVisible();
  // Formation label renders — we don't assert a specific value since it
  // depends on the player's current approved squad.
  await expect(page.getByTestId("squad-pitch-formation-label")).toBeVisible();
  // All 11 starter slots present.
  for (let i = 0; i < 11; i++) {
    await expect(page.getByTestId(`squad-pitch-slot-${i}`)).toBeVisible();
  }
});
