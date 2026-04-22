// Populate public.fc26_players.value_coins_estimate using Kaggle FUT price
// datasets. EAFC26 (our source) has no prices; these older FUT datasets do.
//
// Sources (all pulled via Kaggle REST API, unpacked under /tmp/kaggle/unzipped):
//   1. lucas142129silva/fifa-23-ultimate-team-players-database
//      file: eafc24_players_2024-06-07.csv  (prices already in FUT coins)
//   2. mohammedessam97/ea-fc-24-fut-players-dataset
//      file: EA_FC_24_Fut_Players.csv       (prices like "9.9M 0.81%")
//   3. mohammedessam97/fifa-23-fut-players-dataset
//      file: FIFA_23_Fut_Players.csv        (same format as #2)
//   4. anasfullstack/fifa23-futbin-players
//      file: futbin_players.csv             (Futbin FIFA23)
//   5. baranb/fut-22-ultimate-team-dataset
//      file: fut22players.csv               (FUT22, prices in plain numbers)
//
// Matching strategy:
//   1. Name-slug exact match against combined price map — "normal" variant
//      preferred; min nonzero price across datasets as the quote.
//   2. Rating-based median fallback for unmatched EAFC26 rows (computed from
//      the same datasets, "normal" version only, per-rating median).
//   3. For the very bottom of the rating ladder (<47, sparse/empty samples in
//      source datasets) we use a linear floor = 150 coins.
//
// Currency: all source datasets quote in FUT coins. No EUR/USD conversion
// applied.
//
// Run:
//   node KNOWLEDGE/extracted/_ingest_prices.js
//
// Idempotent: re-runs overwrite value_coins_estimate. The `attributes` jsonb
// gets two keys merged in: `price_source` ('matched'|'rating_median') and
// `price_dataset_url` (pointer to lucas dataset as the canonical source,
// others listed in the commit body).

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Node on Windows needs a native path; cygwin /tmp/ maps to %TEMP%\.
const UNZIP_ROOT =
  process.env.PRICE_UNZIP_ROOT ||
  (process.platform === "win32"
    ? path.join(process.env.TEMP || "C:/Users/Sweez/AppData/Local/Temp", "kaggle", "unzipped")
    : "/tmp/kaggle/unzipped");
const LUCAS_CSV = path.join(
  UNZIP_ROOT,
  "lucas142129silva_fifa-23-ultimate-team-players-database",
  "eafc24_players_2024-06-07.csv",
);
const MOH_FC24_CSV = path.join(
  UNZIP_ROOT,
  "mohammedessam97_ea-fc-24-fut-players-dataset",
  "EA_FC_24_Fut_Players.csv",
);
const MOH_FIFA23_CSV = path.join(
  UNZIP_ROOT,
  "mohammedessam97_fifa-23-fut-players-dataset",
  "FIFA_23_Fut_Players.csv",
);
const FUTBIN_CSV = path.join(
  UNZIP_ROOT,
  "anasfullstack_fifa23-futbin-players",
  "futbin_players.csv",
);
const FUT22_CSV = path.join(
  UNZIP_ROOT,
  "baranb_fut-22-ultimate-team-dataset",
  "fut22players.csv",
);

const CANONICAL_DATASET_URL =
  "https://www.kaggle.com/datasets/lucas142129silva/fifa-23-ultimate-team-players-database";

const UPDATE_BATCH = 500;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function stripDiacritics(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function slugify(name) {
  return stripDiacritics(String(name || ""))
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Parses price strings like "9.9M 0.81%", "67.5K", "1980000.0", "5M", "200".
// Returns integer FUT coins, or 0 when unparseable / non-positive.
function parsePrice(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s) return 0;
  const tok = s.split(/\s+/)[0];
  if (!tok) return 0;
  let mult = 1;
  let stripped = tok;
  if (tok.endsWith("M") || tok.endsWith("m")) {
    mult = 1_000_000;
    stripped = tok.slice(0, -1);
  } else if (tok.endsWith("K") || tok.endsWith("k")) {
    mult = 1_000;
    stripped = tok.slice(0, -1);
  }
  const n = parseFloat(stripped);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * mult);
}

// Minimal CSV parser — handles quoted fields with commas + escaped quotes ""
function parseCsvRow(line) {
  const out = [];
  let buf = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        buf += c;
      }
    } else {
      if (c === ",") {
        out.push(buf);
        buf = "";
      } else if (c === '"') {
        inQ = true;
      } else {
        buf += c;
      }
    }
  }
  out.push(buf);
  return out;
}

function* iterCsv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  const lines = [];
  let buf = "";
  let inQ = false;
  for (const ch of text) {
    if (ch === '"') inQ = !inQ;
    if (ch === "\n" && !inQ) {
      lines.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) lines.push(buf);
  if (!lines.length) return;
  const header = parseCsvRow(lines[0].replace(/\r$/, ""));
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    const cells = parseCsvRow(line);
    const row = {};
    for (let k = 0; k < header.length; k++) row[header[k]] = cells[k] ?? "";
    yield row;
  }
}

function buildPriceMap() {
  const map = new Map(); // slug -> price (min nonzero)
  const addPrice = (slug, p) => {
    if (!slug || p <= 0) return;
    const cur = map.get(slug);
    if (cur == null || p < cur) map.set(slug, p);
  };

  // Lucas — prices already in FUT coins, prefer "normal" version
  let lucasRows = 0;
  for (const row of iterCsv(LUCAS_CSV)) {
    lucasRows++;
    const ver = String(row["Card_Version"] || "").trim().toLowerCase();
    if (ver !== "normal") continue;
    const n = String(row["Name"] || "").trim();
    const p = Number(row["Price"]) || 0;
    if (n && p > 0) addPrice(slugify(n), Math.round(p));
  }

  // Mohammed FC24 + FIFA23 — VER contains 'normal' substring
  let mohRows = 0;
  for (const fp of [MOH_FC24_CSV, MOH_FIFA23_CSV]) {
    for (const row of iterCsv(fp)) {
      mohRows++;
      const ver = String(row["VER"] || "").trim().toLowerCase();
      if (!ver.includes("normal")) continue;
      const n = String(row["Name"] || "").trim();
      const p = parsePrice(row["Price"]);
      if (n && p > 0) addPrice(slugify(n), p);
    }
  }

  // Futbin FIFA23
  let fbRows = 0;
  for (const row of iterCsv(FUTBIN_CSV)) {
    fbRows++;
    const ver = String(row["version"] || "").trim().toLowerCase();
    if (!ver.includes("normal")) continue;
    const n = String(row["name"] || "").trim();
    const p = parsePrice(row["price"]);
    if (n && p > 0) addPrice(slugify(n), p);
  }

  // FUT22 — revision may be 'Normal' or empty
  let fut22Rows = 0;
  for (const row of iterCsv(FUT22_CSV)) {
    fut22Rows++;
    const rev = String(row["revision"] || "").trim().toLowerCase();
    if (rev && !rev.includes("normal")) continue;
    const n = String(row["player_name"] || "").trim();
    const p = Number(String(row["price"] || "").replace(/,/g, "")) || 0;
    if (n && p > 0) addPrice(slugify(n), Math.round(p));
  }

  console.log(
    `price sources parsed — lucas:${lucasRows} mohammed:${mohRows} futbin:${fbRows} fut22:${fut22Rows}`,
  );
  return map;
}

function buildRatingMedians() {
  const byRat = new Map(); // rating -> array of prices
  const add = (r, p) => {
    const k = Number(r);
    if (!Number.isFinite(k) || k < 1 || k > 99 || p <= 0) return;
    if (!byRat.has(k)) byRat.set(k, []);
    byRat.get(k).push(p);
  };

  for (const row of iterCsv(LUCAS_CSV)) {
    const ver = String(row["Card_Version"] || "").trim().toLowerCase();
    if (ver !== "normal") continue;
    add(Number(row["Rating"]), Number(row["Price"]) || 0);
  }
  for (const fp of [MOH_FC24_CSV, MOH_FIFA23_CSV]) {
    for (const row of iterCsv(fp)) {
      const ver = String(row["VER"] || "").trim().toLowerCase();
      if (!ver.includes("normal")) continue;
      add(Number(row["RAT"]), parsePrice(row["Price"]));
    }
  }

  const out = new Map();
  for (const [r, arr] of byRat.entries()) {
    arr.sort((a, b) => a - b);
    const med = arr[Math.floor(arr.length / 2)];
    out.set(r, med);
  }
  // Fill any gaps by interpolating / flooring
  let lastKnown = 150;
  for (let r = 30; r <= 99; r++) {
    if (!out.has(r)) {
      out.set(r, lastKnown);
    } else {
      lastKnown = out.get(r);
    }
  }
  return out;
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing env");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log("building price map from Kaggle datasets...");
  const priceMap = buildPriceMap();
  console.log(`price map: ${priceMap.size} unique name slugs with nonzero price`);

  const ratMed = buildRatingMedians();
  console.log(
    `rating medians computed for ratings 30..99 (e.g. 60=${ratMed.get(60)}, 75=${ratMed.get(75)}, 85=${ratMed.get(85)}, 90=${ratMed.get(90)}, 95=${ratMed.get(95)})`,
  );

  // Pull ALL active fc26_players (id, slug, rating, attributes)
  console.log("loading fc26_players from DB...");
  const allRows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, slug, rating, attributes")
      .is("deleted_at", null)
      .range(from, to);
    if (error) {
      console.error("select err:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`loaded ${allRows.length} active fc26_players rows`);

  // Build update list
  const updates = [];
  let matched = 0;
  let fallback = 0;
  let unmatched = 0;
  for (const row of allRows) {
    const slug = row.slug || "";
    const rating = Number(row.rating || 0);
    let price = 0;
    let source = null;
    if (slug && priceMap.has(slug)) {
      price = priceMap.get(slug);
      source = "matched";
      matched++;
    } else if (rating > 0 && ratMed.has(rating)) {
      price = ratMed.get(rating);
      source = "rating_median";
      fallback++;
    } else {
      unmatched++;
      continue;
    }
    const baseAttrs =
      row.attributes && typeof row.attributes === "object"
        ? row.attributes
        : {};
    const newAttrs = {
      ...baseAttrs,
      price_source: source,
      price_dataset_url: CANONICAL_DATASET_URL,
    };
    updates.push({ id: row.id, value_coins_estimate: price, attributes: newAttrs });
  }
  console.log(
    `name-match:${matched}  rating-fallback:${fallback}  unmatched:${unmatched}  total:${allRows.length}`,
  );
  console.log(
    `coverage (matched only): ${((100 * matched) / allRows.length).toFixed(1)}%`,
  );
  console.log(
    `coverage (matched + fallback): ${((100 * (matched + fallback)) / allRows.length).toFixed(1)}%`,
  );

  // Push updates via parallelised .update().eq('id', ...). Supabase's bulk
  // upsert won't work here because the fc26_players table has NOT NULL cols
  // (source_dataset, name, slug, position, etc.) that upsert would overwrite
  // with nulls. Parallel single-row UPDATE is simpler + safer.
  const CONCURRENCY = 24;
  let done = 0;
  let idx = 0;
  const errors = [];
  async function worker() {
    while (idx < updates.length) {
      const my = idx++;
      const u = updates[my];
      const { error } = await sb
        .from("fc26_players")
        .update({
          value_coins_estimate: u.value_coins_estimate,
          attributes: u.attributes,
        })
        .eq("id", u.id);
      if (error) {
        errors.push({ id: u.id, msg: error.message });
        if (errors.length <= 5) console.error("update err:", u.id, error.message);
      }
      done++;
      if (done % 1000 === 0) console.log(`updated ${done}/${updates.length}`);
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  console.log(
    `done. updated ${done - errors.length} rows successfully, ${errors.length} errors`,
  );
}

main().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
