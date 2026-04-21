#!/usr/bin/env node
/**
 * Plan 13A seed: 2 organizations, 1 contract, 1 caution deposit, 1 preseason
 * shoot with sample attendance. Idempotent — looks up by name first.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-plan13.mjs
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

async function getOrCreateOrg(name, cacNumber) {
  const { data: existing } = await sb
    .from("organizations")
    .select("*")
    .eq("name", name)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    console.log(`org exists: ${name} → ${existing.id}`);
    return existing;
  }
  const { data, error } = await sb
    .from("organizations")
    .insert({ name, cac_number: cacNumber, status: "active" })
    .select("*")
    .single();
  if (error) throw error;
  console.log(`org created: ${name} → ${data.id}`);
  return data;
}

async function depositOnce(org, userId, amountCoins, reference) {
  // Idempotent guard — look for same reference.
  if (reference) {
    const { data: existing } = await sb
      .from("caution_ledger_entries")
      .select("id")
      .eq("organization_id", org.id)
      .eq("reference", reference)
      .maybeSingle();
    if (existing) {
      console.log(`ledger entry exists for ${reference} → skip`);
      return;
    }
  }
  const newBalance = Number(org.caution_fee_balance_coins) + amountCoins;
  await sb.from("caution_ledger_entries").insert({
    organization_id: org.id,
    entry_type: "deposit",
    amount_coins: amountCoins,
    direction: "credit",
    balance_after_coins: newBalance,
    reference,
    entered_by_user_id: userId,
  });
  await sb
    .from("organizations")
    .update({ caution_fee_balance_coins: newBalance })
    .eq("id", org.id);
  console.log(`ledger deposit: ${org.name} +${amountCoins} → balance ${newBalance}`);
}

async function getAnyUserId() {
  const { data } = await sb
    .from("users")
    .select("id")
    .is("deleted_at", null)
    .limit(1)
    .single();
  return data?.id ?? null;
}

async function getActiveSeasonId() {
  const { data } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function seedPreseasonShoot(seasonId) {
  const shootDate = "2026-04-28";
  const { data: existing } = await sb
    .from("preseason_shoots")
    .select("*")
    .eq("season_id", seasonId)
    .eq("shoot_date", shootDate)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    console.log(`preseason shoot exists: ${shootDate} → ${existing.id}`);
    return existing;
  }
  const { data, error } = await sb
    .from("preseason_shoots")
    .insert({
      season_id: seasonId,
      shoot_date: shootDate,
      type: "photo",
      location: "Lekki Studios",
      status: "scheduled",
    })
    .select("*")
    .single();
  if (error) throw error;
  console.log(`preseason shoot created: ${shootDate} → ${data.id}`);
  return data;
}

async function seedShootAttendance(shoot) {
  const { data: players } = await sb
    .from("players")
    .select("id, gamer_tag")
    .is("deleted_at", null)
    .limit(5);
  if (!players || players.length === 0) {
    console.log("no players found; skipping attendance seed");
    return;
  }
  for (let i = 0; i < players.length; i += 1) {
    const p = players[i];
    const attended = i % 2 === 0; // ~half attended
    const { data: ex } = await sb
      .from("preseason_shoot_attendance")
      .select("id")
      .eq("shoot_id", shoot.id)
      .eq("player_id", p.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (ex) {
      console.log(`attendance exists for ${p.gamer_tag} → skip`);
      continue;
    }
    await sb.from("preseason_shoot_attendance").insert({
      shoot_id: shoot.id,
      player_id: p.id,
      attended_bool: attended,
    });
    console.log(`attendance inserted: ${p.gamer_tag} attended=${attended}`);
  }
}

async function seedContract(org, seasonId) {
  const { data: player } = await sb
    .from("players")
    .select("id, gamer_tag")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!player) {
    console.log("no player for contract; skipping");
    return;
  }
  const { data: ex } = await sb
    .from("organization_contracts")
    .select("id")
    .eq("organization_id", org.id)
    .eq("player_id", player.id)
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .maybeSingle();
  if (ex) {
    console.log(`contract exists: ${org.name} ↔ ${player.gamer_tag}`);
    return;
  }
  await sb.from("organization_contracts").insert({
    organization_id: org.id,
    player_id: player.id,
    season_id: seasonId,
    contract_url: "https://example.com/contracts/placeholder.pdf",
    valid_from: "2025-09-01",
    valid_until: "2026-06-30",
    status: "active",
    signed_at: new Date().toISOString(),
  });
  console.log(`contract created: ${org.name} ↔ ${player.gamer_tag}`);
}

(async () => {
  const userId = await getAnyUserId();
  if (!userId) {
    console.error("no user available; run seed-players first");
    process.exit(1);
  }
  const seasonId = await getActiveSeasonId();
  if (!seasonId) {
    console.error("no active season available");
    process.exit(1);
  }

  const crown = await getOrCreateOrg("Lagos Crown Esports", "RC-1120345");
  const eagles = await getOrCreateOrg("Abuja Eagles FC", "RC-1120346");

  await depositOnce(crown, userId, 50000, "plan13-seed-initial-deposit");
  await depositOnce(eagles, userId, 50000, "plan13-seed-initial-deposit");

  await seedContract(crown, seasonId);

  const shoot = await seedPreseasonShoot(seasonId);
  await seedShootAttendance(shoot);

  console.log("plan13 seed complete");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
