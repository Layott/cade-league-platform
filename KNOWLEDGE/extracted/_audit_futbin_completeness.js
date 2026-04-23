#!/usr/bin/env node
// Audit completeness of futbin-sourced rows in fc26_players.
// Reports: total, priced, with-image, with-stats, with-variant, per-rating band.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

async function main() {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // Paginate — Supabase default caps 1000 rows per request.
  const all = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, name, rating, value_coins_estimate, item_type, attributes")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    process.stdout.write(`\rfetched ${all.length}...`);
  }
  process.stdout.write("\n");

  const total = all.length;
  let priced = 0, withImage = 0, withStats = 0, withWf = 0, withSm = 0;
  let withVariant = 0, withMeta = 0, withPS = 0, withPC = 0, withSnapshot = 0;
  const byRating = {};
  const byItemType = {};
  const byVariant = {};
  const missingFieldCounts = { name: 0, rating: 0, price: 0, image: 0, stats: 0 };

  for (const r of all) {
    const a = r.attributes || {};
    if (r.value_coins_estimate) priced++; else missingFieldCounts.price++;
    if (a.card_image_url) withImage++; else missingFieldCounts.image++;
    if (a.mains && a.mains.pac != null) withStats++; else missingFieldCounts.stats++;
    if (a.weak_foot != null) withWf++;
    if (a.skill_moves != null) withSm++;
    if (a.futbin_variant) withVariant++;
    if (a.futbin_meta_rating) withMeta++;
    if (a.platform_prices?.ps) withPS++;
    if (a.platform_prices?.pc) withPC++;
    if (a.price_snapshot_at) withSnapshot++;
    if (!r.name) missingFieldCounts.name++;
    if (!r.rating) missingFieldCounts.rating++;

    const band = r.rating >= 90 ? "90+" : r.rating >= 85 ? "85-89" : r.rating >= 80 ? "80-84" : r.rating >= 75 ? "75-79" : r.rating >= 70 ? "70-74" : "<70";
    byRating[band] = (byRating[band] || 0) + 1;
    byItemType[r.item_type || "unknown"] = (byItemType[r.item_type || "unknown"] || 0) + 1;
    const vkey = (a.futbin_variant || "(none)").toLowerCase();
    byVariant[vkey] = (byVariant[vkey] || 0) + 1;
  }

  const pct = (n) => total ? ((n / total) * 100).toFixed(1) + "%" : "0%";

  console.log("=== fc26_players (futbin.com) completeness ===");
  console.log(`total rows:       ${total}`);
  console.log("");
  console.log("coverage:");
  console.log(`  price (any):    ${priced.toString().padStart(6)} (${pct(priced)})`);
  console.log(`  PS price:       ${withPS.toString().padStart(6)} (${pct(withPS)})`);
  console.log(`  PC price:       ${withPC.toString().padStart(6)} (${pct(withPC)})`);
  console.log(`  card image:     ${withImage.toString().padStart(6)} (${pct(withImage)})`);
  console.log(`  main stats:     ${withStats.toString().padStart(6)} (${pct(withStats)})`);
  console.log(`  weak foot:      ${withWf.toString().padStart(6)} (${pct(withWf)})`);
  console.log(`  skill moves:    ${withSm.toString().padStart(6)} (${pct(withSm)})`);
  console.log(`  variant tag:    ${withVariant.toString().padStart(6)} (${pct(withVariant)})`);
  console.log(`  meta rating:    ${withMeta.toString().padStart(6)} (${pct(withMeta)})`);
  console.log(`  price snapshot: ${withSnapshot.toString().padStart(6)} (${pct(withSnapshot)})`);
  console.log("");
  console.log("by rating band:");
  for (const [b, n] of Object.entries(byRating).sort()) console.log(`  ${b.padEnd(6)} ${n}`);
  console.log("");
  console.log("by item_type:");
  for (const [t, n] of Object.entries(byItemType).sort((a,b) => b[1]-a[1])) console.log(`  ${t.padEnd(10)} ${n}`);
  console.log("");
  console.log("top 30 variants:");
  const sortedVariants = Object.entries(byVariant).sort((a,b) => b[1]-a[1]).slice(0, 30);
  for (const [v, n] of sortedVariants) console.log(`  ${v.padEnd(30)} ${n}`);
  console.log(`  ... (${Object.keys(byVariant).length - sortedVariants.length} more variants)`);
  console.log("");
  console.log("missing (required) field counts:");
  for (const [f, n] of Object.entries(missingFieldCounts)) console.log(`  ${f.padEnd(8)} ${n}`);

  // Sample 5 priced, 5 no-price
  const priced5 = all.filter(r => r.value_coins_estimate).slice(0, 5);
  const nop5 = all.filter(r => !r.value_coins_estimate).slice(0, 5);
  console.log("\nsample priced (5):");
  for (const r of priced5) console.log(`  r${r.rating} ${r.name} — ${r.value_coins_estimate.toLocaleString()} (${r.item_type})`);
  console.log("\nsample no-price (5):");
  for (const r of nop5) console.log(`  r${r.rating} ${r.name} (${r.item_type})`);
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
