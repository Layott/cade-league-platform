// Direct ingest of the EAFC26 Kaggle CSV into public.fc26_players.
// Runs on Node; uses service-role Supabase client.
//
// Dataset: https://www.kaggle.com/datasets/flynn28/eafc26-player-database
// CSV path: KNOWLEDGE/extracted/EAFC26.csv (17874 rows, schema differs from
// the older flynn28 dump the original _fc26_import.py was written for).
//
// Run:
//   node KNOWLEDGE/extracted/_ingest_eafc26_csv.js
//
// Idempotent via (source_dataset, source_row_id) unique index. Re-runs upsert
// in place.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const CSV_PATH = path.resolve(
  __dirname,
  "EAFC26.csv",
);
const DATASET = "https://www.kaggle.com/datasets/flynn28/eafc26-player-database";
const BATCH = 500;

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
  return stripDiacritics(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseInt10(raw) {
  if (raw == null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

// "175cm / 5'9\"" → 175
function parseHeightCm(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)\s*cm/i);
  return m ? parseInt10(m[1]) : null;
}

// "72kg / 159lb" → 72
function parseWeightKg(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)\s*kg/i);
  return m ? parseInt10(m[1]) : null;
}

// "['RW']" → ["RW"]   ''  → null
function parseAltPositions(raw) {
  if (!raw) return null;
  try {
    const j = JSON.parse(String(raw).replace(/'/g, '"'));
    if (Array.isArray(j) && j.length > 0) return j.map((s) => String(s).trim());
  } catch {}
  return null;
}

// Naive CSV parser (handles double-quote escaping, including embedded commas
// + embedded quotes as ""). No external dep needed.
function parseCsvRow(line) {
  const out = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        buf += c;
      }
    } else {
      if (c === ",") {
        out.push(buf);
        buf = "";
      } else if (c === '"') {
        inQuotes = true;
      } else {
        buf += c;
      }
    }
  }
  out.push(buf);
  return out;
}

// Read whole file, then iterate lines. File is ~7 MB — fits in memory.
function* readCsvRows(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  // Some rows have embedded newlines inside quoted fields. Rejoin.
  const lines = [];
  let buf = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "\n" && !inQuotes) {
      lines.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) lines.push(buf);

  const header = parseCsvRow(lines[0]);
  const idx = (name) => header.indexOf(name);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    const cells = parseCsvRow(line);
    const row = {};
    for (let k = 0; k < header.length; k++) {
      row[header[k]] = cells[k] ?? "";
    }
    row.__idx = idx;
    yield row;
  }
}

function normalize(row) {
  const name = (row["Name"] || "").trim();
  const rating = parseInt10(row["OVR"]);
  if (!name || rating == null) return null;

  const position = (row["Position"] || "ST").trim().slice(0, 8);
  const altPositions = parseAltPositions(row["Alternative positions"]);
  const club = (row["Team"] || "").trim() || null;
  const league = (row["League"] || "").trim() || null;
  const nation = (row["Nation"] || "").trim() || null;
  const age = parseInt10(row["Age"]);
  const heightCm = parseHeightCm(row["Height"]);
  const weightKg = parseWeightKg(row["Weight"]);
  const preferredFoot = (row["Preferred foot"] || "").trim() || null;
  const weakFoot = parseInt10(row["Weak foot"]);
  const skillMoves = parseInt10(row["Skill moves"]);
  const cardImage = (row["card"] || "").trim() || null;

  // Build attributes jsonb from the six main + sub-attrs.
  const attrs = {};
  const attrCols = [
    ["PAC", "pace"],
    ["SHO", "shooting"],
    ["PAS", "passing"],
    ["DRI", "dribbling"],
    ["DEF", "defending"],
    ["PHY", "physical"],
    ["Acceleration", "acceleration"],
    ["Sprint Speed", "sprint_speed"],
    ["Finishing", "finishing"],
    ["Shot Power", "shot_power"],
    ["Long Shots", "long_shots"],
    ["Vision", "vision"],
    ["Crossing", "crossing"],
    ["Free Kick Accuracy", "free_kick_accuracy"],
    ["Short Passing", "short_passing"],
    ["Long Passing", "long_passing"],
    ["Curve", "curve"],
    ["Dribbling", "dribbling_attr"],
    ["Agility", "agility"],
    ["Balance", "balance"],
    ["Reactions", "reactions"],
    ["Ball Control", "ball_control"],
    ["Composure", "composure"],
    ["Interceptions", "interceptions"],
    ["Heading Accuracy", "heading_accuracy"],
    ["Def Awareness", "def_awareness"],
    ["Standing Tackle", "standing_tackle"],
    ["Sliding Tackle", "sliding_tackle"],
    ["Jumping", "jumping"],
    ["Stamina", "stamina"],
    ["Strength", "strength"],
    ["Aggression", "aggression"],
    ["Positioning", "positioning"],
    ["GK Diving", "gk_diving"],
    ["GK Handling", "gk_handling"],
    ["GK Kicking", "gk_kicking"],
    ["GK Positioning", "gk_positioning"],
    ["GK Reflexes", "gk_reflexes"],
  ];
  for (const [src, dst] of attrCols) {
    const v = parseInt10(row[src]);
    if (v != null) attrs[dst] = v;
  }
  // Play-style + card image URL + EA link → keep in attributes for now.
  if (row["play style"]) attrs.play_styles = row["play style"];
  if (row["url"]) attrs.ea_url = row["url"];
  if (cardImage) attrs.card_image_url = cardImage;
  const gender = (row["GENDER"] || "").trim();
  if (gender) attrs.gender = gender;

  return {
    source_dataset: DATASET,
    source_row_id: String(row["ID"] || "").trim() || `eafc26_${slugify(name)}_${rating}`,
    name,
    slug: slugify(name),
    rating: Math.max(1, Math.min(99, rating)),
    position,
    alt_positions: altPositions,
    club,
    league,
    nation,
    age,
    height_cm: heightCm,
    weight_kg: weightKg,
    preferred_foot: preferredFoot === "Left" || preferredFoot === "Right" ? preferredFoot : null,
    weak_foot: weakFoot,
    skill_moves: skillMoves,
    attributes: attrs,
    item_type: "normal",
    value_coins_estimate: null,
  };
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing env");

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const rows = [];
  let skipped = 0;
  for (const raw of readCsvRows(CSV_PATH)) {
    const norm = normalize(raw);
    if (norm) rows.push(norm);
    else skipped++;
  }
  console.log(`parsed: ${rows.length}, skipped: ${skipped}`);

  // Partial unique index (WHERE deleted_at IS NULL) can't serve ON CONFLICT
  // without a matching conflict target. Plain strategy: soft-delete existing
  // rows for this dataset, then insert everything fresh.
  const { error: delErr } = await sb
    .from("fc26_players")
    .update({ deleted_at: new Date().toISOString() })
    .eq("source_dataset", DATASET)
    .is("deleted_at", null);
  if (delErr) {
    console.error("soft-delete prior dataset rows failed:", delErr.message);
    process.exit(1);
  }

  let up = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb.from("fc26_players").insert(batch);
    if (error) {
      console.error(`batch ${i}..${i + batch.length} err:`, error.message);
      break;
    }
    up += batch.length;
    if ((i / BATCH) % 4 === 0) console.log(`inserted ${up}/${rows.length}`);
  }
  console.log(`done. inserted ${up}`);
}

main().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
