#!/usr/bin/env node
/**
 * Plan 52 — wipe match data + disputes/appeals/announcements + seed orgs +
 * link players to orgs. One-shot destructive op. Reads SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY from apps/web/.env.local at runtime.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, "..", ".env.local");
const envText = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const NOW = new Date().toISOString();

async function softDeleteAll(table, extra = {}) {
  const q = sb.from(table).update({ deleted_at: NOW }).is("deleted_at", null);
  for (const [k, v] of Object.entries(extra)) q.eq(k, v);
  const { count, error } = await q.select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  soft-deleted ${count ?? "?"} rows in ${table}`);
}

async function truncateViaRpc(table) {
  // Supabase JS doesn't expose TRUNCATE — use DELETE WHERE TRUE.
  const attempts = [
    () => sb.from(table).delete({ count: "exact" }).gte("created_at", "1970-01-01"),
    () => sb.from(table).delete({ count: "exact" }).gte("id", -9223372036854775000n),
    () => sb.from(table).delete({ count: "exact" }).neq("id", "00000000-0000-0000-0000-000000000000"),
  ];
  for (const attempt of attempts) {
    try {
      const { error, count } = await attempt();
      if (!error) {
        console.log(`  deleted ${count ?? "?"} rows in ${table}`);
        return;
      }
    } catch {}
  }
  console.warn(`  could not delete rows from ${table}`);
}

async function execSql(sql, label) {
  // No public RPC for arbitrary SQL — service role can use pg via REST is not exposed.
  // We fall back to per-table operations. This stub is a placeholder.
  console.log(`  [skip-sql] ${label}`);
}

async function main() {
  console.log("== Plan 52 wipe + link ==");
  console.log(`URL: ${SUPABASE_URL}`);

  console.log("\n[B-1] Wiping match data...");
  await softDeleteAll("match_results");
  await softDeleteAll("disciplinary_actions");
  await softDeleteAll("disciplinary_cases");
  await softDeleteAll("attendance_marks");
  await softDeleteAll("match_stat_screenshots");

  console.log("\n[B-1] Truncating computed tables...");
  await truncateViaRpc("standings");
  await truncateViaRpc("leaderboard_snapshots");
  await truncateViaRpc("player_match_stats");
  await truncateViaRpc("disciplinary_precedents");

  console.log("\n[B-1] Re-seeding empty standings (1 row per active player)...");
  const { data: participants, error: spErr } = await sb
    .from("season_participants")
    .select("season_id, player_id")
    .is("deleted_at", null);
  if (spErr) throw new Error(`season_participants: ${spErr.message}`);
  if (participants && participants.length) {
    const rows = participants.map((p) => ({
      season_id: p.season_id,
      player_id: p.player_id,
      matches_played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
    }));
    const { error: insErr } = await sb
      .from("standings")
      .upsert(rows, { onConflict: "season_id,player_id" });
    if (insErr) throw new Error(`standings seed: ${insErr.message}`);
    console.log(`  seeded ${rows.length} zero-rows`);
  }

  console.log("\n[B-2] Wiping disputes / appeals / announcements...");
  await softDeleteAll("disputes");
  await softDeleteAll("appeals");
  await softDeleteAll("announcements");

  console.log("\n[B-2] Wiping related notifications...");
  const kinds = [
    "announcement",
    "dispute_filed",
    "dispute_replied",
    "appeal_filed",
    "appeal_outcome",
  ];
  for (const k of kinds) {
    const { count, error } = await sb
      .from("notifications")
      .update({ deleted_at: NOW })
      .is("deleted_at", null)
      .eq("kind", k)
      .select("*", { count: "exact", head: true });
    if (error) console.warn(`  notifications kind=${k}: ${error.message}`);
    else console.log(`  notifications kind=${k}: cleared ${count ?? "?"}`);
  }

  console.log("\n[C] Seeding orgs...");
  const orgNames = [
    "CADE Esports",
    "GameEvo Esports",
    "Breaking Gaming Barriers",
    "Phoenix Esports",
    "Outlaws",
    "Lumo Labs",
    "Funquest Esports",
    "Solar Flare",
    "Yakabu Global",
    "Afropanda Esports",
    "OAS Esports",
  ];
  const { data: existingOrgs, error: eoErr } = await sb
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null);
  if (eoErr) throw new Error(`organizations read: ${eoErr.message}`);
  const existingNames = new Set(
    (existingOrgs ?? []).map((o) => o.name.toLowerCase()),
  );
  const toInsert = orgNames
    .filter((n) => !existingNames.has(n.toLowerCase()))
    .map((name) => ({ name, status: "active" }));
  if (toInsert.length) {
    const { error: insErr } = await sb.from("organizations").insert(toInsert);
    if (insErr) throw new Error(`orgs insert: ${insErr.message}`);
    console.log(`  inserted ${toInsert.length} new orgs`);
  } else {
    console.log("  all 11 orgs already present");
  }

  console.log("\n[C] Linking players to orgs...");
  const { data: orgs2, error: o2Err } = await sb
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null);
  if (o2Err) throw new Error(`organizations re-read: ${o2Err.message}`);
  const orgByName = new Map(
    (orgs2 ?? []).map((o) => [o.name.toLowerCase(), o.id]),
  );

  const linkMap = [
    ["ADEFOLA", "CADE Esports"],
    ["BAJI JNR", "GameEvo Esports"],
    ["KILLER FREAK", "GameEvo Esports"],
    ["WOLEVATION", "Breaking Gaming Barriers"],
    ["MITCH", "Phoenix Esports"],
    ["DADABOI", "Outlaws"],
    ["KAYKAY", "Lumo Labs"],
    ["TACTICAL", "Funquest Esports"],
    ["KINGNONEX", "Solar Flare"],
    ["GURU", "Yakabu Global"],
    ["ANIFE", "Afropanda Esports"],
    ["FARUK", "OAS Esports"],
  ];
  const { data: players, error: pErr } = await sb
    .from("players")
    .select("id, gamer_tag")
    .is("deleted_at", null);
  if (pErr) throw new Error(`players read: ${pErr.message}`);
  const playerByTag = new Map(
    (players ?? []).map((p) => [p.gamer_tag.toUpperCase(), p.id]),
  );

  let linked = 0;
  for (const [tag, orgName] of linkMap) {
    const playerId = playerByTag.get(tag);
    const orgId = orgByName.get(orgName.toLowerCase());
    if (!playerId) {
      console.warn(`  skip: no player with gamer_tag=${tag}`);
      continue;
    }
    if (!orgId) {
      console.warn(`  skip: no org named ${orgName}`);
      continue;
    }
    const { error: uErr } = await sb
      .from("players")
      .update({ organization_id: orgId })
      .eq("id", playerId);
    if (uErr) {
      console.warn(`  fail link ${tag}: ${uErr.message}`);
      continue;
    }
    linked++;
  }
  console.log(`  linked ${linked}/12 players to orgs`);

  console.log("\n[verify] Counts...");
  for (const [t, where] of [
    ["match_results", { is_deleted: false }],
    ["disputes", { is_deleted: false }],
    ["appeals", { is_deleted: false }],
    ["announcements", { is_deleted: false }],
    ["matches", { is_deleted: false }],
    ["match_days", { is_deleted: false }],
    ["players", { is_deleted: false }],
    ["organizations", { is_deleted: false }],
  ]) {
    const { count, error } = await sb
      .from(t)
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null);
    if (error) console.warn(`  ${t}: ${error.message}`);
    else console.log(`  ${t} active rows: ${count}`);
  }

  console.log("\n== done ==");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
