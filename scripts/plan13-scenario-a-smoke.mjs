#!/usr/bin/env node
/**
 * Plan 13A Scenario A smoke: confirms the caution-fee ledger math works end
 * to end against the linked Supabase project. Applies a 5,000-coin
 * fine_deduction to Lagos Crown Esports seeded by seed-plan13.mjs and prints
 * the expected 45,000-coin balance, plus the full ledger history.
 *
 * Idempotent: skips the fine_deduction if one with the same reference already
 * exists.
 *
 *   node scripts/plan13-scenario-a-smoke.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

for (const p of [
  resolve(repoRoot, ".env.local"),
  resolve(repoRoot, "apps/web/.env.local"),
]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const REFERENCE = "plan13-scenario-a-fine-5000";

const { data: org } = await sb
  .from("organizations")
  .select("*")
  .eq("name", "Lagos Crown Esports")
  .is("deleted_at", null)
  .single();
if (!org) {
  console.error("Lagos Crown Esports org not found — run seed:plan13 first");
  process.exit(1);
}

console.log("balance before fine:", org.caution_fee_balance_coins);

const { data: existing } = await sb
  .from("caution_ledger_entries")
  .select("id")
  .eq("organization_id", org.id)
  .eq("reference", REFERENCE)
  .maybeSingle();

if (!existing) {
  const { data: u } = await sb
    .from("users")
    .select("id")
    .is("deleted_at", null)
    .limit(1)
    .single();
  const newBal = Number(org.caution_fee_balance_coins) - 5000;
  if (newBal < 0) {
    console.error(`refuse: balance would go negative (${newBal})`);
    process.exit(1);
  }
  await sb.from("caution_ledger_entries").insert({
    organization_id: org.id,
    entry_type: "fine_deduction",
    amount_coins: 5000,
    direction: "debit",
    balance_after_coins: newBal,
    reference: REFERENCE,
    entered_by_user_id: u.id,
  });
  await sb
    .from("organizations")
    .update({ caution_fee_balance_coins: newBal })
    .eq("id", org.id);
  console.log(`fine_deduction applied: 50,000 - 5,000 = ${newBal}`);
} else {
  console.log("fine_deduction already applied; idempotent skip");
}

const { data: org2 } = await sb
  .from("organizations")
  .select("caution_fee_balance_coins")
  .eq("id", org.id)
  .single();
console.log("balance after fine:", org2.caution_fee_balance_coins);

const { data: rows } = await sb
  .from("caution_ledger_entries")
  .select("entry_type, direction, amount_coins, balance_after_coins, reference")
  .eq("organization_id", org.id)
  .order("entered_at", { ascending: true });
console.log("ledger rows:");
for (const r of rows ?? []) console.log("  ", JSON.stringify(r));
