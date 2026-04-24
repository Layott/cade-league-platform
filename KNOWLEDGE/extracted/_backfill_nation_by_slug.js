#!/usr/bin/env node
// Propagate nation across slug groups. If ANY card with slug X has
// nation populated, fill nation for ALL cards with slug X.
//
// Covers the real-world rule: card variants of a single player (gold /
// icon / TOTY / etc) do NOT change the player's country. Multi-pass
// scrape sometimes fills one variant but not others.
//
// Also includes a hand-curated "famous names" map for icons / heroes
// that never appeared in any Kaggle export — bridge the gap until the
// scraper-captured futbin_nation_id rolls out across the catalog.
//
// Usage:
//   node KNOWLEDGE/extracted/_backfill_nation_by_slug.js         (dry run)
//   node KNOWLEDGE/extracted/_backfill_nation_by_slug.js --apply

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

// Famous-player nation fallback. Covers icons / heroes / legends whose
// Kaggle rows (if any) didn't slug-match cleanly. Extend as needed.
// Keys are the diacritic-stripped slug; values are the country name.
const FAMOUS_NATIONS = {
  // Nigeria
  kanu: "Nigeria",
  john_obi_mikel: "Nigeria",
  jay_jay_okocha: "Nigeria",
  nwankwo_kanu: "Nigeria",
  okocha: "Nigeria",
  finidi_george: "Nigeria",
  daniel_amokachi: "Nigeria",
  rashidi_yekini: "Nigeria",
  sunday_oliseh: "Nigeria",
  taribo_west: "Nigeria",
  celestine_babayaro: "Nigeria",
  stephen_keshi: "Nigeria",
  joseph_yobo: "Nigeria",
  // Ghana
  abedi_pele: "Ghana",
  michael_essien: "Ghana",
  stephen_appiah: "Ghana",
  asamoah_gyan: "Ghana",
  sulley_muntari: "Ghana",
  // Cameroon
  samuel_etoo: "Cameroon",
  roger_milla: "Cameroon",
  rigobert_song: "Cameroon",
  // Ivory Coast
  didier_drogba: "Ivory Coast",
  drogba: "Ivory Coast",
  yaya_toure: "Ivory Coast",
  kolo_toure: "Ivory Coast",
  // Senegal
  el_hadji_diouf: "Senegal",
  sadio_mane: "Senegal",
  // Liberia
  george_weah: "Liberia",
  // Egypt
  mohamed_aboutrika: "Egypt",
  // ICONS (non-African — high profile without Kaggle match)
  pele: "Brazil",
  ronaldinho: "Brazil",
  ronaldo: "Brazil", // Ronaldo Nazário
  cafu: "Brazil",
  rivaldo: "Brazil",
  romario: "Brazil",
  maradona: "Argentina",
  kempes: "Argentina",
  crespo: "Argentina",
  zidane: "France",
  platini: "France",
  henry: "France",
  thuram: "France",
  vieira: "France",
  beckenbauer: "Germany",
  klinsmann: "Germany",
  matthaeus: "Germany",
  kahn: "Germany",
  netzer: "Germany",
  cruyff: "Netherlands",
  van_basten: "Netherlands",
  bergkamp: "Netherlands",
  gullit: "Netherlands",
  rijkaard: "Netherlands",
  overmars: "Netherlands",
  eusebio: "Portugal",
  figo: "Portugal",
  rui_costa: "Portugal",
  puskas: "Hungary",
  del_piero: "Italy",
  baggio: "Italy",
  maldini: "Italy",
  nesta: "Italy",
  buffon: "Italy",
  cannavaro: "Italy",
  baresi: "Italy",
  totti: "Italy",
  pirlo: "Italy",
  zanetti: "Italy",
  cantona: "France",
  keane: "Republic of Ireland",
  shearer: "England",
  gerrard: "England",
  lampard: "England",
  beckham: "England",
  scholes: "England",
  ferdinand: "England",
  terry: "England",
  cole: "England",
  rooney: "England",
  owen: "England",
  gascoigne: "England",
  bobby_moore: "England",
  drogba_didier: "Ivory Coast",
  hazard: "Belgium",
  // Add more as needed
};

(async () => {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Phase 1: propagate nation across slug groups.
  console.log("Phase 1 — propagate nation across slug groups...");
  const all = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from("fc26_players")
      .select("id, slug, nation")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .order("id")
      .range(off, off + 999);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`total futbin rows: ${all.length}`);

  // Group by slug, find slugs that have AT LEAST ONE populated nation.
  const nationBySlug = new Map();
  const rowsBySlug = new Map();
  for (const r of all) {
    if (!r.slug) continue;
    if (!rowsBySlug.has(r.slug)) rowsBySlug.set(r.slug, []);
    rowsBySlug.get(r.slug).push(r);
    if (r.nation && !nationBySlug.has(r.slug)) {
      nationBySlug.set(r.slug, r.nation);
    }
  }
  console.log(`distinct slugs: ${rowsBySlug.size}`);
  console.log(`slugs with at least one nation: ${nationBySlug.size}`);

  const phase1 = [];
  for (const [slug, rows] of rowsBySlug) {
    const nation = nationBySlug.get(slug);
    if (!nation) continue;
    for (const r of rows) {
      if (!r.nation || r.nation !== nation) {
        phase1.push({ id: r.id, nation, source: "slug-propagate" });
      }
    }
  }
  console.log(`phase 1 updates: ${phase1.length}`);

  // Phase 2: famous-names map for rows still missing nation.
  console.log("\nPhase 2 — famous-names fallback...");
  const phase2 = [];
  const phase1Ids = new Set(phase1.map((u) => u.id));
  for (const r of all) {
    if (r.nation) continue;
    if (phase1Ids.has(r.id)) continue;
    const hit = FAMOUS_NATIONS[r.slug];
    if (hit) {
      phase2.push({ id: r.id, nation: hit, source: "famous-map" });
    }
  }
  console.log(`phase 2 updates: ${phase2.length}`);

  const all_updates = [...phase1, ...phase2];

  // How many new Nigerian cards?
  const newNG = all_updates.filter((u) => u.nation.toLowerCase() === "nigeria").length;
  console.log(`\nnew Nigerian cards total: ${newNG}`);

  if (!apply) {
    console.log("\nsample 10 updates:");
    for (const u of all_updates.slice(0, 10)) {
      console.log(`  [${u.source}] ${u.id} → ${u.nation}`);
    }
    console.log("\nDRY RUN. Re-run with --apply to execute.");
    return;
  }

  const BATCH = 50;
  let done = 0, errs = 0;
  for (let i = 0; i < all_updates.length; i += BATCH) {
    const slice = all_updates.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((u) => sb.from("fc26_players").update({ nation: u.nation }).eq("id", u.id)),
    );
    for (const r of results) if (r.error) { errs++; console.error(r.error.message); }
    done += slice.length;
    process.stdout.write(`\rupdated ${done}/${all_updates.length}  errors=${errs}`);
  }
  process.stdout.write("\n");
  console.log("done");
})();
