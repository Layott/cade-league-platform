#!/usr/bin/env node
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
  // Peek 10 special rows, 10 normal rows, and any "toty" with variant NOT matching
  const { data: sp } = await sb.from("fc26_players").select("name, rating, item_type, attributes").eq("source_dataset", "futbin.com").eq("item_type", "special").limit(12);
  console.log("=== sample special (first 12) ===");
  for (const r of sp) console.log(`  r${r.rating}  ${r.attributes?.futbin_variant?.padEnd(30)}  ${r.name}`);
  const { data: nm } = await sb.from("fc26_players").select("name, rating, item_type, attributes").eq("source_dataset", "futbin.com").eq("item_type", "normal").order("rating", { ascending: false }).limit(12);
  console.log("\n=== sample normal (top 12 by rating) ===");
  for (const r of nm) console.log(`  r${r.rating}  ${r.attributes?.futbin_variant?.padEnd(30)}  ${r.name}`);
  // Count by item_type
  const { data: counts } = await sb.rpc("exec_sql", { sql: "select item_type, count(*) from fc26_players where source_dataset='futbin.com' and deleted_at is null group by item_type order by count desc" }).catch(() => ({ data: null }));
  // fallback: manual
  const byType = {};
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await sb.from("fc26_players").select("item_type").eq("source_dataset", "futbin.com").is("deleted_at", null).order("id").range(offset, offset + PAGE - 1);
    if (!data?.length) break;
    for (const r of data) byType[r.item_type] = (byType[r.item_type] || 0) + 1;
    if (data.length < PAGE) break;
  }
  console.log("\n=== new item_type distribution ===");
  for (const [t, n] of Object.entries(byType).sort((a,b) => b[1]-a[1])) console.log(`  ${t.padEnd(10)} ${n}`);
})();
