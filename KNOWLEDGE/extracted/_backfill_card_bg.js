#!/usr/bin/env node
// Backfill attributes.card_bg_url for every futbin.com row that's missing
// it. Uses a best-guess URL pattern built from the existing
// `attributes.futbin_variant` label so we don't need to rescrape Futbin.
//
// Futbin's observed card-frame URL shape (captured from real HTML
// 2026-04-23):
//   https://cdn3.futbin.com/content/fifa26/img/cards/tiny/{variant_underscored}.png
// Variants are stored hyphenated ("5-toty", "111-fantasy-fc"); the CDN
// path uses underscores + a .png extension.
//
// Safe: only writes rows that currently have card_bg_url null. Idempotent.
// Does NOT hit Futbin — purely DB updates.
//
// Usage:
//   node KNOWLEDGE/extracted/_backfill_card_bg.js           # dry run
//   node KNOWLEDGE/extracted/_backfill_card_bg.js --apply   # execute

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

const BASE = "https://cdn3.futbin.com/content/fifa26/img/cards/tiny/";

function buildBgUrl(variant) {
  if (!variant) return null;
  const underscored = String(variant).toLowerCase().replace(/-/g, "_");
  return `${BASE}${underscored}.png`;
}

(async () => {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Page every futbin.com row missing card_bg_url.
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, attributes")
      .eq("source_dataset", "futbin.com")
      .is("attributes->>card_bg_url", null)
      .not("attributes->>futbin_variant", "is", null)
      .is("deleted_at", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    process.stdout.write(`\rfetched ${all.length}...`);
  }
  process.stdout.write("\n");
  console.log(`candidates (no card_bg_url + variant present): ${all.length}`);

  // Build updates.
  const updates = [];
  const skipped = [];
  for (const r of all) {
    const variant = r.attributes?.futbin_variant;
    const url = buildBgUrl(variant);
    if (!url) { skipped.push({ id: r.id, variant }); continue; }
    updates.push({ id: r.id, attrs: { ...r.attributes, card_bg_url: url } });
  }
  console.log(`to update: ${updates.length}`);
  console.log(`skipped (no variant): ${skipped.length}`);

  if (!apply) {
    console.log("\nsample (first 5):");
    for (const u of updates.slice(0, 5)) {
      console.log(`  ${u.id}  → ${u.attrs.card_bg_url}`);
    }
    console.log("\nDRY RUN. Re-run with --apply to execute.");
    return;
  }

  const BATCH = 50;
  let done = 0;
  let errs = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((u) =>
        sb.from("fc26_players").update({ attributes: u.attrs }).eq("id", u.id),
      ),
    );
    for (const r of results) { if (r.error) { errs++; console.error(r.error.message); } }
    done += slice.length;
    process.stdout.write(`\rupdated ${done}/${updates.length}  errors=${errs}`);
  }
  process.stdout.write("\n");
  console.log("done");
})();
