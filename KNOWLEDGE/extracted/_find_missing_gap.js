#!/usr/bin/env node
// Enumerate the cards Kaggle has but Futbin's default scrape didn't
// match. These are the real "gap" — candidates for targeted lookup.
// Outputs JSON + a summary report. Does NOT mutate the DB.

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

(async () => {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Read all Kaggle rows that were NOT Futbin-enriched (no futbin_resource_id).
  const gap = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, name, slug, rating, position, source_row_id, attributes")
      .eq("source_dataset", "https://www.kaggle.com/datasets/flynn28/eafc26-player-database")
      .is("deleted_at", null)
      .is("attributes->>futbin_resource_id", null)
      .order("rating", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data?.length) break;
    gap.push(...data);
    if (data.length < PAGE) break;
  }

  // Bucket by rating band.
  const bands = { "90+": [], "85-89": [], "80-84": [], "75-79": [], "70-74": [], "<70": [] };
  for (const r of gap) {
    const band = r.rating >= 90 ? "90+" : r.rating >= 85 ? "85-89" : r.rating >= 80 ? "80-84" : r.rating >= 75 ? "75-79" : r.rating >= 70 ? "70-74" : "<70";
    bands[band].push(r);
  }

  console.log(`=== Kaggle rows WITHOUT Futbin match — ${gap.length} total ===\n`);
  for (const [b, rows] of Object.entries(bands)) {
    console.log(`${b.padEnd(6)} ${rows.length}`);
  }

  console.log("\n=== High-priority gap (rating >= 75) ===");
  const hot = gap.filter((r) => r.rating >= 75);
  console.log(`${hot.length} cards rated 75+\n`);
  for (const r of hot.slice(0, 40)) {
    console.log(`  r${r.rating}  ${(r.position ?? "").padEnd(3)}  ${r.name}`);
  }
  if (hot.length > 40) console.log(`  ... (${hot.length - 40} more)`);

  // Dump full gap list to JSON for the targeted scraper.
  const outPath = path.resolve(__dirname, "futbin_gap.json");
  fs.writeFileSync(outPath, JSON.stringify(
    gap.map((r) => ({ name: r.name, rating: r.rating, position: r.position })),
    null, 2,
  ));
  console.log(`\nWrote ${outPath} — ${gap.length} entries`);
  console.log("Next: run _scrape_futbin_by_name.js to hunt these on Futbin.");
})();
