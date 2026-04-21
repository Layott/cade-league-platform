import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 10 — E2E boundary check. We exercise the server module directly via
 * a REST call to a tiny harness. The UI portion is best verified as a unit
 * (change.test.ts covers the 21:00 inclusive / 22:00 exclusive edges). In
 * E2E we verify the unique partial index rejects a second live swap, which
 * mirrors the "second attempt in same week" success criterion.
 */

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

test.setTimeout(60_000);

test("squad_change_requests unique partial index rejects second live swap", async () => {
  const sb = svc();

  // Seed a throwaway approved submission linked to a real player + season.
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  const { data: player } = await sb
    .from("players")
    .select("id")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const { data: user } = await sb
    .from("users")
    .select("id")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  expect(season?.id).toBeTruthy();
  expect(player?.id).toBeTruthy();
  expect(user?.id).toBeTruthy();

  // Ensure no prior live submission for a fixed far-future week.
  const weekStart = "2099-04-16";
  await sb
    .from("squad_submissions")
    .delete()
    .eq("player_id", player!.id)
    .eq("week_start_date", weekStart);

  const { data: sub } = await sb
    .from("squad_submissions")
    .insert({
      season_id: season!.id,
      player_id: player!.id,
      week_start_date: weekStart,
      futbin_screenshot_path: "e2e/change-window/a.png",
      validation_status: "approved",
      validated_by: user!.id,
      validated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  expect(sub?.id).toBeTruthy();

  const first = await sb
    .from("squad_change_requests")
    .insert({
      submission_id: sub!.id,
      player_out_name: "out-1",
      player_in_name: "in-1",
      player_in_item_type: "gold",
      player_in_rating: 80,
      player_in_value: 1000,
      authorized_by_ref_user_id: user!.id,
    })
    .select("id")
    .single();
  expect(first.data?.id).toBeTruthy();

  const second = await sb.from("squad_change_requests").insert({
    submission_id: sub!.id,
    player_out_name: "out-2",
    player_in_name: "in-2",
    player_in_item_type: "gold",
    player_in_rating: 80,
    player_in_value: 1000,
    authorized_by_ref_user_id: user!.id,
  });
  // Unique partial index must raise a 23505.
  expect(second.error).toBeTruthy();
  expect(second.error?.code ?? "").toMatch(/23505|duplicate/i);

  // Cleanup.
  await sb.from("squad_submissions").delete().eq("id", sub!.id);
});
