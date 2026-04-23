#!/usr/bin/env node
// One-shot: recompute item_type for every futbin.com row using the fixed
// classifier. Reads each row's attributes.futbin_variant and rewrites
// item_type. No network traffic apart from DB writes.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { classifyVariant } = require("./_classify_variant");

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

  // Page all rows.
  const all = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, item_type, attributes")
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

  const stats = { total: all.length, unchanged: 0, changed: 0, errors: 0 };
  const transitions = {};
  const toUpdate = [];
  for (const r of all) {
    const v = r.attributes?.futbin_variant;
    const next = classifyVariant(v);
    if (next === r.item_type) { stats.unchanged++; continue; }
    const key = `${r.item_type} → ${next}`;
    transitions[key] = (transitions[key] || 0) + 1;
    toUpdate.push({ id: r.id, next });
  }
  console.log(`need to update ${toUpdate.length} of ${stats.total}`);

  // Update in batches of 50 concurrent.
  const BATCH = 50;
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const slice = toUpdate.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((u) =>
      sb.from("fc26_players").update({ item_type: u.next }).eq("id", u.id)
    ));
    for (const r of results) {
      if (r.error) { stats.errors++; console.error(r.error.message); }
      else stats.changed++;
    }
    process.stdout.write(`\rupdated ${Math.min(i + BATCH, toUpdate.length)}/${toUpdate.length}`);
  }
  process.stdout.write("\n");

  console.log("\n=== transitions ===");
  for (const [k, n] of Object.entries(transitions).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${k.padEnd(28)} ${n}`);
  }
  console.log("\n=== summary ===");
  console.log(stats);
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
