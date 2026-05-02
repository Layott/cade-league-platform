#!/usr/bin/env node
// Backfill `nation_iso` (and optionally `nation` text) for all
// `source_dataset='futbin.com'` rows that lack an ISO code.
//
// Why: pre-2026-05-01 the scrapers captured `attributes.futbin_nation_id`
// (Futbin's internal nation ID, parsed from the CDN icon path) but never
// wrote `nation_iso` — so callers that try to count Nigerians via
// `nation_iso='NG'` see zero matches even when the ID is 133 (Nigeria).
// The runtime check in apps/web/src/server/squads/validate.ts works
// around it via `futbin_nation_id === NG_FUTBIN_NATION_ID`, but ANY
// other UI (admin filters, broadcast overlays, exports) hitting
// nation_iso directly would mis-classify.
//
// What this script does:
//   1. Builds a futbin_nation_id → { iso, name } map. Source of truth:
//      the FUTBIN_NATION_MAP constant below (carefully curated against
//      the modal `nation` text already present in the DB and standard
//      ISO 3166-1 alpha-2 codes; covers all 122 Futbin nation IDs that
//      appear in our 22.8k Futbin rows).
//   2. Pulls every futbin.com row where nation_iso is NULL.
//   3. For each row, looks up the futbin_nation_id in the map.
//   4. UPDATEs the row with `nation_iso` (always) + `nation` text (if
//      currently NULL).
//   5. Anything that fails to resolve goes into
//      `_unresolved_nationalities.csv` for manual triage.
//
// Idempotent: re-running only fills rows where nation_iso is still NULL.
//
// Usage:
//   node KNOWLEDGE/extracted/_backfill_nationality.js --dry-run
//   node KNOWLEDGE/extracted/_backfill_nationality.js          # actual write
//   node KNOWLEDGE/extracted/_backfill_nationality.js --apply  # alias

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

// Futbin internal nation ID → { iso (ISO 3166-1 alpha-2), name (canonical) }.
// Curated 2026-05-01 from a histogram dump of every futbin_nation_id that
// appears in the live `fc26_players` table joined against the Kaggle-
// matched `nation` text (top 122 IDs cover 100% of our 22.8k rows).
//
// Country names follow Futbin/EA's preferred form where it differs from
// the official ISO label (e.g. "Holland" not "Netherlands", "Korea
// Republic" not "South Korea"). The ISO codes follow ISO 3166-1 alpha-2.
//
// To extend: add the new ID here. To find a missing ID, run
// `node KNOWLEDGE/extracted/_dump_nation_id_mapping.js` and inspect the
// modal `nation` text for that ID.
const FUTBIN_NATION_MAP = {
  2: { iso: "AD", name: "Andorra" }, // Iker Álvarez de Eulate (Andorran GK)
  1: { iso: "AL", name: "Albania" },
  3: { iso: "AM", name: "Armenia" },
  4: { iso: "AT", name: "Austria" },
  5: { iso: "AZ", name: "Azerbaijan" },
  6: { iso: "BY", name: "Belarus" },
  7: { iso: "BE", name: "Belgium" },
  8: { iso: "BA", name: "Bosnia and Herzegovina" },
  9: { iso: "BG", name: "Bulgaria" },
  10: { iso: "HR", name: "Croatia" },
  11: { iso: "CY", name: "Cyprus" },
  12: { iso: "CZ", name: "Czech Republic" },
  13: { iso: "DK", name: "Denmark" },
  14: { iso: "EN", name: "England" }, // Futbin uses EN for England (not GB)
  15: { iso: "ME", name: "Montenegro" },
  16: { iso: "FO", name: "Faroe Islands" },
  17: { iso: "FI", name: "Finland" },
  18: { iso: "FR", name: "France" },
  19: { iso: "MK", name: "North Macedonia" },
  20: { iso: "GE", name: "Georgia" },
  21: { iso: "DE", name: "Germany" },
  22: { iso: "GR", name: "Greece" },
  23: { iso: "HU", name: "Hungary" },
  24: { iso: "IS", name: "Iceland" },
  25: { iso: "IE", name: "Republic of Ireland" },
  26: { iso: "IL", name: "Israel" },
  27: { iso: "IT", name: "Italy" },
  28: { iso: "LV", name: "Latvia" },
  29: { iso: "LI", name: "Liechtenstein" },
  30: { iso: "LT", name: "Lithuania" },
  31: { iso: "LU", name: "Luxembourg" },
  32: { iso: "MT", name: "Malta" },
  33: { iso: "MD", name: "Moldova" },
  34: { iso: "NL", name: "Holland" }, // Futbin's preferred form for Netherlands
  35: { iso: "NIR", name: "Northern Ireland" }, // 3-char ISO; FIFA-specific
  36: { iso: "NO", name: "Norway" },
  37: { iso: "PL", name: "Poland" },
  38: { iso: "PT", name: "Portugal" },
  39: { iso: "RO", name: "Romania" },
  40: { iso: "RU", name: "Russia" },
  42: { iso: "SCO", name: "Scotland" }, // FIFA-specific 3-char
  43: { iso: "SK", name: "Slovakia" },
  44: { iso: "SI", name: "Slovenia" },
  45: { iso: "ES", name: "Spain" },
  46: { iso: "SE", name: "Sweden" },
  47: { iso: "CH", name: "Switzerland" },
  48: { iso: "TR", name: "Turkey" },
  49: { iso: "UA", name: "Ukraine" },
  50: { iso: "WAL", name: "Wales" }, // FIFA-specific 3-char
  51: { iso: "RS", name: "Serbia" },
  52: { iso: "AR", name: "Argentina" },
  53: { iso: "BO", name: "Bolivia" },
  54: { iso: "BR", name: "Brazil" },
  55: { iso: "CL", name: "Chile" },
  56: { iso: "CO", name: "Colombia" },
  57: { iso: "EC", name: "Ecuador" },
  58: { iso: "PY", name: "Paraguay" },
  59: { iso: "PE", name: "Peru" },
  60: { iso: "UY", name: "Uruguay" },
  61: { iso: "VE", name: "Venezuela" },
  63: { iso: "AG", name: "Antigua and Barbuda" },
  66: { iso: "BB", name: "Barbados" },
  68: { iso: "BM", name: "Bermuda" },
  70: { iso: "CA", name: "Canada" },
  72: { iso: "CR", name: "Costa Rica" },
  73: { iso: "CU", name: "Cuba" },
  76: { iso: "SV", name: "El Salvador" },
  77: { iso: "GD", name: "Grenada" },
  78: { iso: "GT", name: "Guatemala" },
  79: { iso: "GY", name: "Guyana" },
  80: { iso: "HT", name: "Haiti" },
  81: { iso: "HN", name: "Honduras" },
  82: { iso: "JM", name: "Jamaica" },
  83: { iso: "MX", name: "Mexico" },
  84: { iso: "MS", name: "Montserrat" },
  85: { iso: "CW", name: "Curaçao" },
  87: { iso: "PA", name: "Panama" },
  88: { iso: "US", name: "United States" }, // Some legacy rows use 88
  89: { iso: "KN", name: "St. Kitts and Nevis" },
  90: { iso: "LC", name: "St. Lucia" },
  92: { iso: "SR", name: "Suriname" },
  93: { iso: "TT", name: "Trinidad and Tobago" },
  95: { iso: "US", name: "United States" }, // Most US rows use 95
  97: { iso: "DZ", name: "Algeria" },
  98: { iso: "AO", name: "Angola" },
  99: { iso: "BJ", name: "Benin" },
  101: { iso: "BF", name: "Burkina Faso" },
  102: { iso: "BI", name: "Burundi" },
  103: { iso: "CM", name: "Cameroon" },
  104: { iso: "CV", name: "Cape Verde Islands" },
  105: { iso: "CF", name: "Central African Republic" },
  106: { iso: "TD", name: "Chad" },
  107: { iso: "CG", name: "Congo" },
  108: { iso: "CI", name: "Côte d'Ivoire" },
  110: { iso: "CD", name: "Congo DR" },
  111: { iso: "EG", name: "Egypt" },
  112: { iso: "GQ", name: "Equatorial Guinea" },
  115: { iso: "GA", name: "Gabon" },
  116: { iso: "GM", name: "Gambia" },
  117: { iso: "GH", name: "Ghana" },
  118: { iso: "GN", name: "Guinea" },
  119: { iso: "GW", name: "Guinea-Bissau" },
  120: { iso: "KE", name: "Kenya" },
  122: { iso: "LR", name: "Liberia" },
  123: { iso: "LY", name: "Libya" },
  124: { iso: "MG", name: "Madagascar" },
  125: { iso: "MW", name: "Malawi" },
  126: { iso: "ML", name: "Mali" },
  127: { iso: "MR", name: "Mauritania" },
  129: { iso: "MA", name: "Morocco" },
  130: { iso: "MZ", name: "Mozambique" }, // Reinildo Mandava, Geny Catamo et al
  131: { iso: "NA", name: "Namibia" },
  132: { iso: "NE", name: "Niger" },
  133: { iso: "NG", name: "Nigeria" },
  134: { iso: "RW", name: "Rwanda" },
  136: { iso: "SN", name: "Senegal" },
  138: { iso: "SL", name: "Sierra Leone" },
  139: { iso: "SO", name: "Somalia" },
  140: { iso: "ZA", name: "South Africa" },
  143: { iso: "TZ", name: "Tanzania" },
  144: { iso: "TG", name: "Togo" },
  145: { iso: "TN", name: "Tunisia" },
  146: { iso: "UG", name: "Uganda" },
  147: { iso: "ZM", name: "Zambia" },
  148: { iso: "ZW", name: "Zimbabwe" },
  149: { iso: "AF", name: "Afghanistan" },
  151: { iso: "BD", name: "Bangladesh" },
  155: { iso: "CN", name: "China PR" },
  158: { iso: "HK", name: "Hong Kong" },
  159: { iso: "IN", name: "India" },
  160: { iso: "ID", name: "Indonesia" },
  161: { iso: "IR", name: "Iran" },
  162: { iso: "IQ", name: "Iraq" },
  163: { iso: "JP", name: "Japan" },
  164: { iso: "JO", name: "Jordan" },
  167: { iso: "KR", name: "Korea Republic" },
  171: { iso: "LB", name: "Lebanon" },
  173: { iso: "MY", name: "Malaysia" },
  179: { iso: "PK", name: "Pakistan" },
  180: { iso: "PS", name: "Palestine" },
  181: { iso: "PH", name: "Philippines" },
  183: { iso: "SA", name: "Saudi Arabia" },
  185: { iso: "LK", name: "Sri Lanka" },
  186: { iso: "SY", name: "Syria" },
  187: { iso: "TJ", name: "Tajikistan" },
  188: { iso: "TH", name: "Thailand" },
  190: { iso: "AE", name: "United Arab Emirates" },
  191: { iso: "UZ", name: "Uzbekistan" },
  195: { iso: "AU", name: "Australia" },
  198: { iso: "NZ", name: "New Zealand" },
  204: { iso: "VU", name: "Vanuatu" },
  207: { iso: "DO", name: "Dominican Republic" },
  208: { iso: "EE", name: "Estonia" },
  213: { iso: "TW", name: "Chinese Taipei" }, // Po Liang Chen, Tim Chow et al
  214: { iso: "KM", name: "Comoros" },
  215: { iso: "FR", name: "France" }, // Outlier — only one row, treat as France
  219: { iso: "XK", name: "Kosovo" },
};

// Nation NAME (free-form text) → ISO. Used as a fallback when a row has
// `nation` populated (e.g. from Kaggle slug-match) but no
// futbin_nation_id and no nation_iso. Mirrors the values in
// FUTBIN_NATION_MAP plus a few additional name spellings.
const NAME_TO_ISO = {};
for (const v of Object.values(FUTBIN_NATION_MAP)) {
  NAME_TO_ISO[v.name.toLowerCase()] = v.iso;
}
// Common alt spellings.
Object.assign(NAME_TO_ISO, {
  "netherlands": "NL",
  "south korea": "KR",
  "ivory coast": "CI",
  "republic of the congo": "CG",
  "democratic republic of the congo": "CD",
  "drc": "CD",
  "dr congo": "CD",
  "korea south": "KR",
  "uk": "EN",
  "united kingdom": "EN",
  "united states of america": "US",
  "usa": "US",
  "england": "EN",
  "great britain": "EN",
  "myanmar": "MM",
  "burma": "MM",
  "gibraltar": "GI", // Jaiden Bartolo
  "taiwan": "TW",
  "chinese taipei": "TW",
  "mozambique": "MZ",
  "andorra": "AD",
});

(async () => {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const apply = process.argv.includes("--apply") || (!dryRun && !process.argv.some((a) => a.startsWith("--")));

  console.log(`Futbin nationality backfill — mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`Map covers ${Object.keys(FUTBIN_NATION_MAP).length} Futbin nation IDs.`);

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Pull EVERY futbin.com row missing nation_iso (idempotent — only NULL rows).
  console.log("\nFetching all futbin.com rows where nation_iso IS NULL...");
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, name, slug, rating, item_type, source_row_id, nation, nation_iso, attributes")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .is("nation_iso", null)
      .order("id")
      .range(off, off + 999);
    if (error) { console.error("query failed:", error.message); process.exit(1); }
    if (!data?.length) break;
    rows.push(...data);
    process.stderr.write(`\r  fetched ${rows.length}...`);
    if (data.length < 1000) break;
  }
  process.stderr.write("\n");
  console.log(`Found ${rows.length} rows missing nation_iso.`);

  // Resolve each row.
  const updates = [];
  const unresolved = [];
  let resolvedById = 0;
  let resolvedByName = 0;
  for (const r of rows) {
    const attrs = r.attributes && typeof r.attributes === "object" ? r.attributes : {};
    const fbNid = typeof attrs.futbin_nation_id === "number" ? attrs.futbin_nation_id : null;

    let iso = null;
    let name = r.nation || null;
    let source = null;

    // 1. ID → ISO via FUTBIN_NATION_MAP. Authoritative when present.
    if (fbNid != null && FUTBIN_NATION_MAP[fbNid]) {
      const m = FUTBIN_NATION_MAP[fbNid];
      iso = m.iso;
      if (!name) name = m.name;
      source = "futbin_nation_id";
      resolvedById++;
    }
    // 2. Fallback: existing `nation` text → ISO via NAME_TO_ISO.
    else if (r.nation) {
      const nLower = r.nation.toLowerCase().trim();
      const candidate = NAME_TO_ISO[nLower];
      if (candidate) {
        iso = candidate;
        source = "nation_text";
        resolvedByName++;
      }
    }

    if (!iso) {
      unresolved.push({
        id: r.id,
        name: r.name,
        slug: r.slug,
        rating: r.rating,
        item_type: r.item_type,
        source_row_id: r.source_row_id,
        nation: r.nation,
        futbin_nation_id: fbNid,
      });
      continue;
    }

    // Build the patch.
    const patch = { nation_iso: iso };
    if (name && !r.nation) patch.nation = name;
    updates.push({ id: r.id, patch, source, name: r.name, fbNid });
  }

  console.log(`Resolved: ${updates.length}`);
  console.log(`  via futbin_nation_id: ${resolvedById}`);
  console.log(`  via nation text:      ${resolvedByName}`);
  console.log(`Unresolved: ${unresolved.length}`);

  // Nigerian preview.
  const ngRows = updates.filter((u) => u.patch.nation_iso === "NG");
  console.log(`\nNigerian rows to be backfilled: ${ngRows.length}`);
  if (ngRows.length) {
    console.log("  sample 5:");
    for (const u of ngRows.slice(0, 5)) {
      console.log(`    id=${u.id} ${u.name} (fbNid=${u.fbNid}, source=${u.source})`);
    }
  }

  // Write unresolved CSV.
  if (unresolved.length) {
    const csvPath = path.resolve(__dirname, "_unresolved_nationalities.csv");
    const header = "id,name,slug,rating,item_type,source_row_id,nation,futbin_nation_id";
    const body = unresolved.map((u) => [
      u.id,
      JSON.stringify(u.name ?? ""),
      JSON.stringify(u.slug ?? ""),
      u.rating ?? "",
      JSON.stringify(u.item_type ?? ""),
      JSON.stringify(u.source_row_id ?? ""),
      JSON.stringify(u.nation ?? ""),
      u.futbin_nation_id ?? "",
    ].join(",")).join("\n");
    fs.writeFileSync(csvPath, header + "\n" + body);
    console.log(`\nWrote ${csvPath} (${unresolved.length} rows for manual triage)`);
  }

  if (dryRun) {
    console.log("\nDRY RUN — no DB writes. Re-run without --dry-run to apply.");
    if (updates.length > 0) {
      console.log("\nSample 5 planned updates:");
      for (const u of updates.slice(0, 5)) {
        console.log(`  id=${u.id} ${u.name} → ${JSON.stringify(u.patch)}  (${u.source})`);
      }
    }
    return;
  }

  if (!apply) {
    console.log("\nNeither --dry-run nor --apply specified. Defaulting to dry-run for safety.");
    return;
  }

  // Apply in parallel batches.
  console.log(`\nApplying ${updates.length} updates in batches of 50...`);
  const BATCH = 50;
  let done = 0;
  let errs = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((u) =>
        sb.from("fc26_players").update(u.patch).eq("id", u.id).then((r) => ({ ok: !r.error, error: r.error })),
      ),
    );
    for (const r of results) if (!r.ok) { errs++; if (errs < 5) console.error(`  err: ${r.error?.message}`); }
    done += slice.length;
    process.stderr.write(`\r  ${done}/${updates.length}  errors=${errs}`);
  }
  process.stderr.write("\n");

  console.log(`\nDone. Wrote ${done - errs} rows; ${errs} errors.`);
  console.log("\nVerification queries:");
  console.log("  Total futbin rows still missing nation_iso:");
  const { count: remaining } = await sb
    .from("fc26_players")
    .select("*", { count: "exact", head: true })
    .eq("source_dataset", "futbin.com")
    .is("deleted_at", null)
    .is("nation_iso", null);
  console.log(`    ${remaining}`);

  // Ajibade post-check.
  const { data: aj } = await sb
    .from("fc26_players")
    .select("id, name, rating, nation, nation_iso, attributes")
    .ilike("name", "%ajibade%")
    .order("rating", { ascending: false, nullsFirst: false });
  console.log(`\n  Ajibade rows post-backfill (${aj?.length ?? 0}):`);
  for (const r of aj || []) {
    const fbNid = r.attributes?.futbin_nation_id ?? null;
    console.log(`    r${r.rating} ${r.name}  iso=${r.nation_iso}  nation=${r.nation}  fbNid=${fbNid}`);
  }
})().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
