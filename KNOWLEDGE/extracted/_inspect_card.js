#!/usr/bin/env node
// Quick single-card inspector. Usage:
//   node KNOWLEDGE/extracted/_inspect_card.js "Mbappe"
//   node KNOWLEDGE/extracted/_inspect_card.js --rid 231747
//
// Prints the raw fc26_players row (futbin-sourced) for manual verification
// after a delta/full scrape.

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

  const ridArg = process.argv.indexOf("--rid");
  const rid = ridArg >= 0 ? process.argv[ridArg + 1] : null;
  const nameQuery = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== rid).join(" ");

  let q = sb
    .from("fc26_players")
    .select("id, name, rating, position, item_type, value_coins_estimate, updated_at, attributes")
    .eq("source_dataset", "futbin.com")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (rid) q = q.eq("attributes->>futbin_resource_id", rid);
  else if (nameQuery) q = q.ilike("name", `%${nameQuery}%`);
  else {
    console.log("usage: _inspect_card.js <name substring> | --rid <futbin_resource_id>");
    console.log("no query given — showing the 10 most recently updated futbin rows:");
  }

  const { data, error } = await q;
  if (error) { console.error(error); process.exit(1); }
  if (!data?.length) { console.log("no matches"); return; }

  for (const r of data) {
    const a = r.attributes ?? {};
    console.log(`─ ${r.name}  r${r.rating}  ${r.position}  (${r.item_type})`);
    console.log(`   id:            ${r.id}`);
    console.log(`   updated_at:    ${r.updated_at}`);
    console.log(`   coins:         ${(r.value_coins_estimate ?? 0).toLocaleString()}`);
    console.log(`   variant:       ${a.futbin_variant ?? "-"}`);
    console.log(`   futbin_rid:    ${a.futbin_resource_id ?? "-"}`);
    console.log(`   PS / PC:       ${a.platform_prices?.ps?.toLocaleString() ?? "-"} / ${a.platform_prices?.pc?.toLocaleString() ?? "-"}`);
    console.log(`   meta:          ${a.futbin_meta_rating ?? "-"}`);
    console.log(`   WF / SM:       ${a.weak_foot ?? "-"} / ${a.skill_moves ?? "-"}`);
    console.log(`   stats:         ${JSON.stringify(a.mains ?? {})}`);
    console.log(`   card_image:    ${a.card_image_url ?? "-"}`);
    console.log(`   card_bg:       ${a.card_bg_url ?? "-"}`);
    console.log(`   snapshot_at:   ${a.price_snapshot_at ?? "-"}`);
    console.log("");
  }
})();
