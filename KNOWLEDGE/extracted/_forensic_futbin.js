// Forensic: what's actually in fc26_players right now, by every
// available slice — source_dataset spellings, source_row_id prefixes,
// created_at histogram, distinct futbin_resource_id counts, etc.
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
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. Count including deleted
  const { count: grand } = await sb.from("fc26_players").select("*", { count: "exact", head: true });
  console.log("grand total rows (including deleted):", grand);
  const { count: notDel } = await sb.from("fc26_players").select("*", { count: "exact", head: true }).is("deleted_at", null);
  console.log("not-deleted:", notDel);
  const { count: del } = await sb.from("fc26_players").select("*", { count: "exact", head: true }).not("deleted_at", "is", null);
  console.log("soft-deleted:", del);
  console.log("");

  // 2. All distinct source_dataset + source_row_id prefixes, and day buckets of created_at
  const bySrc = {}, byPrefix = {}, byDay = {}, byResourceIdBand = {};
  const distinctResourceIds = new Set();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.from("fc26_players")
      .select("source_dataset, source_row_id, created_at, attributes")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data?.length) break;
    for (const r of data) {
      bySrc[r.source_dataset || "(null)"] = (bySrc[r.source_dataset || "(null)"] || 0) + 1;
      const prefix = (r.source_row_id || "").split("_")[0] || "(none)";
      byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
      const day = (r.created_at || "").slice(0, 10) || "(none)";
      byDay[day] = (byDay[day] || 0) + 1;
      const fbRid = r.attributes?.futbin_resource_id;
      if (fbRid) {
        distinctResourceIds.add(fbRid);
        const n = parseInt(fbRid, 10);
        const band = Number.isFinite(n) ? `${Math.floor(n / 10000) * 10000}-${Math.floor(n / 10000) * 10000 + 9999}` : "(nonnumeric)";
        byResourceIdBand[band] = (byResourceIdBand[band] || 0) + 1;
      }
    }
    if (data.length < PAGE) break;
    process.stdout.write(`\rscanned ${offset + data.length}...`);
  }
  process.stdout.write("\n");

  console.log("\nby source_dataset:");
  for (const [s, n] of Object.entries(bySrc).sort((a,b) => b[1]-a[1])) console.log(`  ${s.padEnd(60)} ${n}`);

  console.log("\nby source_row_id prefix:");
  for (const [p, n] of Object.entries(byPrefix).sort((a,b) => b[1]-a[1])) console.log(`  ${p.padEnd(30)} ${n}`);

  console.log("\nby created_at day:");
  for (const [d, n] of Object.entries(byDay).sort()) console.log(`  ${d}  ${n}`);

  console.log("\ndistinct futbin_resource_id count:", distinctResourceIds.size);

  console.log("\nfutbin_resource_id band (10k wide):");
  for (const [b, n] of Object.entries(byResourceIdBand).sort((a,b) => {
    const aa = parseInt(a[0]); const bb = parseInt(b[0]);
    return aa - bb;
  })) console.log(`  ${b.padEnd(18)} ${n}`);
})();
