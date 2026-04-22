#!/usr/bin/env node
/**
 * Plan 13A seed: 2 organizations, 1 contract, 1 caution deposit. Idempotent
 * — looks up by name first.
 *
 * Plan 33 (2026-04-22): preseason-shoot seeding removed when the preseason
 * feature was dropped. Tables soft-archived in cloud; new dev seeds no
 * longer create preseason rows.
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

// Plan 31 — cacNumber arg ignored; columns dropped in migration
// 20260507000300_orgs_simplify.sql. Kept in signature for call-site
// compatibility until the next seed refresh.
async function getOrCreateOrg(name, _cacNumber) {
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
    .insert({ name, status: "active" })
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

// Plan 33 (2026-04-22): seedPreseasonShoot + seedShootAttendance removed
// when the preseason-shoot feature was dropped. Cloud tables soft-archived
// (see migration 20260507000020_drop_content_preseason_features.sql).

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

  // Plan 33: preseason-shoot seed removed.

  console.log("plan13 seed complete");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
