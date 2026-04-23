#!/usr/bin/env node
// Migrate Futbin-enriched Kaggle/fut.gg rows to source_dataset='futbin.com'.
//
// Steps:
//   1. Collect every row with attributes.futbin_resource_id set.
//   2. Group by futbin_resource_id to detect duplicates across sources.
//   3. For each group, keep the row with the most complete attributes
//      (priced + image + stats + meta wins ties). Soft-delete the rest.
//   4. Flip kept rows' source_dataset → 'futbin.com' and source_row_id →
//      'futbin_{resource_id}' unless already set that way.
//
// Safety: unique partial index on (source_dataset, source_row_id) WHERE
// deleted_at IS NULL is enforced — soft-deleted dupes don't block flip.
//
// Dry-run by default. Pass --apply to execute.

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

function completenessScore(r) {
  let n = 0;
  const a = r.attributes || {};
  if (r.value_coins_estimate) n += 4;
  if (a.card_image_url) n += 3;
  if (a.mains?.pac != null) n += 2;
  if (a.futbin_meta_rating) n += 1;
  if (a.platform_prices?.pc) n += 1;
  if (a.platform_prices?.ps) n += 1;
  if (a.weak_foot != null) n += 1;
  if (a.skill_moves != null) n += 1;
  return n;
}

async function main() {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // 1. Collect all rows with futbin_resource_id.
  const all = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, source_dataset, source_row_id, name, rating, value_coins_estimate, attributes, created_at")
      .not("attributes->>futbin_resource_id", "is", null)
      .is("deleted_at", null)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    process.stdout.write(`\rfetched ${all.length}...`);
  }
  process.stdout.write("\n");
  console.log(`total enriched rows: ${all.length}`);

  // 2. Group by futbin_resource_id.
  const groups = new Map();
  for (const r of all) {
    const rid = r.attributes.futbin_resource_id;
    if (!groups.has(rid)) groups.set(rid, []);
    groups.get(rid).push(r);
  }
  console.log(`distinct resource_ids: ${groups.size}`);

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`resource_ids with duplicates: ${dupGroups.length}`);

  // 3. Pick winner per group.
  const toSoftDelete = [];
  const toFlip = [];
  let keepers = 0;
  for (const g of groups.values()) {
    g.sort((a, b) => completenessScore(b) - completenessScore(a) || (b.created_at > a.created_at ? 1 : -1));
    const winner = g[0];
    keepers++;
    // Flip winner if not already on futbin.com + correct source_row_id.
    const wantsRowId = `futbin_${winner.attributes.futbin_resource_id}`;
    if (winner.source_dataset !== "futbin.com" || winner.source_row_id !== wantsRowId) {
      toFlip.push({ id: winner.id, from: `${winner.source_dataset}/${winner.source_row_id}`, to: `futbin.com/${wantsRowId}`, wantsRowId });
    }
    for (const loser of g.slice(1)) toSoftDelete.push({ id: loser.id, reason: "dup_resource_id", winnerId: winner.id });
  }
  console.log(`keepers: ${keepers}`);
  console.log(`to flip: ${toFlip.length}`);
  console.log(`to soft-delete (dupes): ${toSoftDelete.length}`);

  if (!apply) {
    console.log("\n--- sample flips (first 10) ---");
    for (const f of toFlip.slice(0, 10)) console.log(`  ${f.id}  ${f.from}  →  ${f.to}`);
    console.log("\n--- sample dup soft-deletes (first 10) ---");
    for (const d of toSoftDelete.slice(0, 10)) console.log(`  ${d.id}  dup of ${d.winnerId}`);
    console.log("\nDRY RUN. Re-run with --apply to execute.");
    return;
  }

  console.log("\n=== applying ===");

  // Soft-delete dupes first (frees up any composite-key collisions).
  const BATCH = 50;
  let done = 0;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < toSoftDelete.length; i += BATCH) {
    const slice = toSoftDelete.slice(i, i + BATCH);
    await Promise.all(slice.map((d) =>
      sb.from("fc26_players").update({ deleted_at: nowIso }).eq("id", d.id)
    ));
    done += slice.length;
    process.stdout.write(`\rsoft-deleted dupes: ${done}/${toSoftDelete.length}`);
  }
  process.stdout.write("\n");

  // Flip source_dataset + source_row_id on winners.
  done = 0; let flipErrors = 0;
  for (let i = 0; i < toFlip.length; i += BATCH) {
    const slice = toFlip.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((f) =>
      sb.from("fc26_players")
        .update({ source_dataset: "futbin.com", source_row_id: f.wantsRowId, updated_at: nowIso })
        .eq("id", f.id)
    ));
    for (const r of results) if (r.error) { flipErrors++; console.error("\n", r.error.message); }
    done += slice.length;
    process.stdout.write(`\rflipped: ${done}/${toFlip.length}  errors=${flipErrors}`);
  }
  process.stdout.write("\n");
  console.log("done.");
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
