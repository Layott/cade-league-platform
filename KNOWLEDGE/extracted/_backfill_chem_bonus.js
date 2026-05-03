#!/usr/bin/env node
// One-shot backfill: classify every existing futbin.com row's
// `attributes.futbin_variant` via the upgraded shared classifier, and
// when a granular promo subclass / chem-bonus is detected, merge those
// keys into the row's `attributes` jsonb. Idempotent — safe to re-run.
//
// Why this exists: the May-2026 scraper patch teaches the loader to write
// `promo_class` + `chem_bonus` into attributes alongside the existing
// `item_type` bucket. Existing rows scraped pre-patch don't carry those
// keys; chemistry calc (lib/chemistry.ts) reads `card.chemBonus` as an
// explicit override and falls back to deriveChemBonus() when missing.
// For rows that DON'T need a granular tag (gold / icon / hero / toty /
// tots / totw / rttf / unrecognised special), the backfill is a no-op.
//
// Usage:
//   node KNOWLEDGE/extracted/_backfill_chem_bonus.js          # apply
//   node KNOWLEDGE/extracted/_backfill_chem_bonus.js --dry-run
//   node KNOWLEDGE/extracted/_backfill_chem_bonus.js --limit 100
//
// Prereqs:
//   - apps/web/.env.local has NEXT_PUBLIC_SUPABASE_URL +
//     SUPABASE_SERVICE_ROLE_KEY.
//
// Run AFTER the updated classifier has been deployed to the scrapers
// (so newly-scraped rows carry the tags). This catches up the existing
// 22,839 rows in fc26_players. Idempotent — re-runs only update rows
// whose attributes drift from the classifier output.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { classifyVariantWithBonus } = require("./_classify_variant.js");

const PAGE_SIZE = 1000;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

// Decide whether a row needs an UPDATE based on classifier output vs.
// what the row currently has stored. Returns the merged attributes
// object (or null if no change needed).
function mergeAttrsIfChanged(existingAttrs, classified) {
  const attrs = existingAttrs && typeof existingAttrs === "object"
    ? { ...existingAttrs }
    : {};
  const oldPromoClass = attrs.promo_class ?? null;
  const oldChemBonus = JSON.stringify(attrs.chem_bonus ?? null);
  const newPromoClass = classified.promoClass ?? null;
  const newChemBonus = JSON.stringify(classified.chemBonus ?? null);

  if (oldPromoClass === newPromoClass && oldChemBonus === newChemBonus) {
    return null;
  }
  if (classified.promoClass) {
    attrs.promo_class = classified.promoClass;
  } else {
    delete attrs.promo_class;
  }
  if (classified.chemBonus) {
    attrs.chem_bonus = classified.chemBonus;
  } else {
    delete attrs.chem_bonus;
  }
  return attrs;
}

async function main() {
  loadEnv();
  const dryRun = !!arg("dry-run", false);
  const limitArg = arg("limit", null);
  const limit = limitArg && limitArg !== true ? parseInt(limitArg, 10) : null;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("missing supabase env — check apps/web/.env.local");
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log(`[backfill-chem] mode=${dryRun ? "dry-run" : "apply"} limit=${limit ?? "∞"}`);

  // Pre-flight: total candidate rows.
  const { count: totalRows } = await sb
    .from("fc26_players")
    .select("id", { count: "exact", head: true })
    .eq("source_dataset", "futbin.com")
    .is("deleted_at", null);
  console.log(`[backfill-chem] total futbin.com rows (alive): ${totalRows}`);

  const stats = {
    scanned: 0,
    classified: 0,    // rows where classifier produced promoClass !== null OR chemBonus !== null
    updated: 0,       // rows where merged attrs actually changed
    skipped: 0,       // rows where classifier output matched stored attrs
    errors: 0,
  };
  const byPromoClass = {};

  let offset = 0;
  let processed = 0;
  const target = limit ?? Infinity;

  while (processed < target) {
    const remaining = target - processed;
    const fetchSize = Math.min(PAGE_SIZE, remaining);
    const { data: rows, error } = await sb
      .from("fc26_players")
      .select("id, attributes")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + fetchSize - 1);

    if (error) {
      console.error(`[backfill-chem] fetch err at offset ${offset}: ${error.message}`);
      stats.errors++;
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      stats.scanned++;
      const variant = row.attributes?.futbin_variant || "";
      const classified = classifyVariantWithBonus(variant);
      if (classified.promoClass !== null || classified.chemBonus !== null) {
        stats.classified++;
        const promoKey = classified.promoClass || `(bucket:${classified.itemType})`;
        byPromoClass[promoKey] = (byPromoClass[promoKey] || 0) + 1;
      }

      const merged = mergeAttrsIfChanged(row.attributes, classified);
      if (!merged) {
        stats.skipped++;
        continue;
      }

      if (dryRun) {
        stats.updated++;
        continue;
      }

      const { error: uErr } = await sb
        .from("fc26_players")
        .update({ attributes: merged, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (uErr) {
        stats.errors++;
        console.error(`[backfill-chem] update err id=${row.id}: ${uErr.message}`);
        continue;
      }
      stats.updated++;
    }

    processed += rows.length;
    offset += rows.length;
    if ((processed % 5000) === 0 || processed === target) {
      console.log(`[backfill-chem] progress: scanned=${stats.scanned} classified=${stats.classified} updated=${stats.updated} skipped=${stats.skipped} err=${stats.errors}`);
    }
    if (rows.length < fetchSize) break;
  }

  console.log("");
  console.log("[backfill-chem] DONE");
  console.log(`  scanned:      ${stats.scanned}`);
  console.log(`  classified:   ${stats.classified}`);
  console.log(`  updated:      ${stats.updated}${dryRun ? " (DRY-RUN)" : ""}`);
  console.log(`  skipped:      ${stats.skipped}`);
  console.log(`  errors:       ${stats.errors}`);
  console.log("");
  console.log("  promo_class breakdown (rows the classifier matched):");
  const entries = Object.entries(byPromoClass).sort((a, b) => b[1] - a[1]);
  for (const [key, n] of entries) {
    console.log(`    ${key.padEnd(40)} ${n}`);
  }
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
