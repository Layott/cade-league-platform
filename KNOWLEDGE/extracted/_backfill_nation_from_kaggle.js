#!/usr/bin/env node
// One-time backfill: fill `nation` on futbin-sourced rows where it's null
// by fuzzy-matching the name against the Kaggle EAFC26 CSV. Uses the
// same diacritic-stripped slug comparison the picker typeahead uses, plus
// a rating-window tiebreak.
//
// Run: `node KNOWLEDGE/extracted/_backfill_nation_from_kaggle.js` (dry-run)
//      `node KNOWLEDGE/extracted/_backfill_nation_from_kaggle.js --apply`

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const CSV_PATH = path.resolve(__dirname, "EAFC26.csv");

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const stripD = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const slugify = (n) =>
  stripD(n).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function parseCsvRow(line) {
  // Minimal CSV parser — handles quoted fields with commas inside.
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function loadKaggle() {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  const idx = {
    name: headers.indexOf("Name"),
    ovr: headers.indexOf("OVR"),
    nation: headers.indexOf("Nation"),
  };
  if (idx.name < 0 || idx.nation < 0) {
    throw new Error("CSV missing Name or Nation column");
  }
  // Group by slug. Many duplicates possible (same slug, different rating).
  const bySlug = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const fields = parseCsvRow(line);
    const name = fields[idx.name]?.trim();
    const nation = fields[idx.nation]?.trim();
    const ovr = parseInt(fields[idx.ovr], 10);
    if (!name || !nation) continue;
    const slug = slugify(name);
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({ name, nation, rating: Number.isFinite(ovr) ? ovr : null });
  }
  return bySlug;
}

function pickBest(candidates, targetRating) {
  if (candidates.length === 1) return candidates[0];
  // Prefer closest rating.
  return [...candidates].sort((a, b) => {
    const da = a.rating == null ? 999 : Math.abs(a.rating - (targetRating ?? 0));
    const db = b.rating == null ? 999 : Math.abs(b.rating - (targetRating ?? 0));
    return da - db;
  })[0];
}

async function main() {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  console.log("loading Kaggle CSV...");
  const bySlug = loadKaggle();
  console.log(`Kaggle: ${bySlug.size} distinct slugs loaded`);

  // Pull every futbin row where nation is null.
  const gap = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, name, slug, rating")
      .eq("source_dataset", "futbin.com")
      .is("nation", null)
      .is("deleted_at", null)
      .order("id")
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data?.length) break;
    gap.push(...data);
    if (data.length < 1000) break;
    process.stdout.write(`\rfutbin no-nation: ${gap.length}...`);
  }
  process.stdout.write("\n");
  console.log(`${gap.length} futbin rows have null nation`);

  // Name-match each.
  const updates = [];
  let ambig = 0, unmatched = 0;
  for (const r of gap) {
    const candidates = bySlug.get(r.slug);
    if (!candidates || candidates.length === 0) { unmatched++; continue; }
    const pick = pickBest(candidates, r.rating);
    if (candidates.length > 1 && pick.rating != null && r.rating != null &&
        Math.abs(pick.rating - r.rating) > 10) { ambig++; continue; }
    updates.push({ id: r.id, nation: pick.nation });
  }
  console.log(`matched:  ${updates.length}`);
  console.log(`ambig:    ${ambig}`);
  console.log(`unmatched:${unmatched}`);

  const nigeriaCount = updates.filter((u) => u.nation.toLowerCase() === "nigeria").length;
  console.log(`among matches, Nigerian cards to add: ${nigeriaCount}`);

  if (!apply) {
    console.log("\nsample 5 planned updates:");
    for (const u of updates.slice(0, 5)) console.log("  ", u.id, "→", u.nation);
    console.log("\nDRY RUN. re-run with --apply.");
    return;
  }

  const BATCH = 50;
  let done = 0, errs = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((u) => sb.from("fc26_players").update({ nation: u.nation }).eq("id", u.id)),
    );
    for (const r of results) if (r.error) { errs++; console.error(r.error.message); }
    done += slice.length;
    process.stdout.write(`\rupdated ${done}/${updates.length}  errors=${errs}`);
  }
  process.stdout.write("\n");
  console.log("done");
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
