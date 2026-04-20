#!/usr/bin/env node
/**
 * Seed the 13-player roster into the linked Supabase project.
 *
 * Flow per player:
 *   1. Create auth.users row via Supabase Auth admin API (email + password).
 *      The handle_new_auth_user trigger populates public.users automatically.
 *   2. Insert public.players row extending the mirrored users row.
 *   3. Insert public.season_participants row linking the player to the active season.
 *   4. Insert public.user_roles row granting 'player' role.
 *
 * Idempotent: re-running upserts on email / player-id conflicts.
 *
 * !!! REPLACE ROSTER WITH REAL DATA BEFORE PRODUCTION SEED !!!
 *
 * Required env (root .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-players.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k]) process.env[k] = v.trim();
  }
}

loadEnvFile(resolve(repoRoot, ".env.local"));
loadEnvFile(resolve(repoRoot, "apps/web/.env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// !!! REPLACE WITH REAL ROSTER BEFORE PRODUCTION SEED !!!
// Password is shared placeholder for local dev — rotate in production.
const SHARED_PASSWORD = "dev-player-2026";

const ROSTER = [
  { jersey: 1,  display: "Player One",      email: "player01@cade.local", gamer_tag: "P01_GAMER", psn_id: "p01_psn" },
  { jersey: 2,  display: "Player Two",      email: "player02@cade.local", gamer_tag: "P02_GAMER", psn_id: "p02_psn" },
  { jersey: 3,  display: "Player Three",    email: "player03@cade.local", gamer_tag: "P03_GAMER", psn_id: "p03_psn" },
  { jersey: 4,  display: "Player Four",     email: "player04@cade.local", gamer_tag: "P04_GAMER", psn_id: "p04_psn" },
  { jersey: 5,  display: "Player Five",     email: "player05@cade.local", gamer_tag: "P05_GAMER", psn_id: "p05_psn" },
  { jersey: 6,  display: "Player Six",      email: "player06@cade.local", gamer_tag: "P06_GAMER", psn_id: "p06_psn" },
  { jersey: 7,  display: "Player Seven",    email: "player07@cade.local", gamer_tag: "P07_GAMER", psn_id: "p07_psn" },
  { jersey: 8,  display: "Player Eight",    email: "player08@cade.local", gamer_tag: "P08_GAMER", psn_id: "p08_psn" },
  { jersey: 9,  display: "Player Nine",     email: "player09@cade.local", gamer_tag: "P09_GAMER", psn_id: "p09_psn" },
  { jersey: 10, display: "Player Ten",      email: "player10@cade.local", gamer_tag: "P10_GAMER", psn_id: "p10_psn" },
  { jersey: 11, display: "Player Eleven",   email: "player11@cade.local", gamer_tag: "P11_GAMER", psn_id: "p11_psn" },
  { jersey: 12, display: "Player Twelve",   email: "player12@cade.local", gamer_tag: "P12_GAMER", psn_id: "p12_psn" },
  { jersey: 13, display: "Player Thirteen", email: "player13@cade.local", gamer_tag: "P13_GAMER", psn_id: "p13_psn" },
];

async function ensureAuthUser(email, password, display_name) {
  const { data: existing } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const hit = existing?.users?.find((u) => u.email === email);
  if (hit) return hit.id;

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function ensureActiveSeason() {
  const { data, error } = await sb
    .from("seasons")
    .select("id, year_range")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No active season. Run migrations first.");
  return data;
}

async function upsertPlayer(userId, row) {
  const { data: existing } = await sb
    .from("players")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await sb
      .from("players")
      .update({
        gamer_tag: row.gamer_tag,
        psn_id: row.psn_id,
        jersey_number: row.jersey,
      })
      .eq("id", existing.id);
    if (updErr) throw updErr;
    return existing.id;
  }

  const { data, error } = await sb
    .from("players")
    .insert({
      user_id: userId,
      gamer_tag: row.gamer_tag,
      psn_id: row.psn_id,
      jersey_number: row.jersey,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function upsertParticipant(seasonId, playerId) {
  const { error } = await sb
    .from("season_participants")
    .upsert(
      { season_id: seasonId, player_id: playerId, entry_status: "confirmed" },
      { onConflict: "season_id,player_id" }
    );
  if (error) throw error;
}

async function upsertPlayerRole(publicUserId) {
  const { error } = await sb
    .from("user_roles")
    .upsert(
      { user_id: publicUserId, role: "player" },
      { onConflict: "user_id,role" }
    );
  if (error) throw error;
}

async function resolvePublicUserId(authUserId) {
  const { data, error } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`public.users mirror not created for auth id ${authUserId}`);
  return data.id;
}

async function main() {
  console.log(`Seeding ${ROSTER.length} players into ${SUPABASE_URL}`);

  const season = await ensureActiveSeason();
  console.log(`Active season: ${season.year_range} (${season.id})`);

  for (const row of ROSTER) {
    const authId = await ensureAuthUser(row.email, SHARED_PASSWORD, row.display);
    const publicUserId = await resolvePublicUserId(authId);
    const playerId = await upsertPlayer(publicUserId, row);
    await upsertParticipant(season.id, playerId);
    await upsertPlayerRole(publicUserId);
    console.log(`  ✓ ${row.email} → player ${playerId} (jersey ${row.jersey})`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
