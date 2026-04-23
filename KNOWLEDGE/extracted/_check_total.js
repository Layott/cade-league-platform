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
  const { count: total } = await sb.from("fc26_players").select("*", { count: "exact", head: true }).is("deleted_at", null);
  console.log("fc26_players total (not deleted):", total);
  const { count: delCount } = await sb.from("fc26_players").select("*", { count: "exact", head: true }).not("deleted_at", "is", null);
  console.log("fc26_players total (deleted):", delCount);
  // By source
  const bySrc = {};
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await sb.from("fc26_players").select("source_dataset").is("deleted_at", null).range(offset, offset + PAGE - 1);
    if (!data?.length) break;
    for (const r of data) bySrc[r.source_dataset || "(none)"] = (bySrc[r.source_dataset || "(none)"] || 0) + 1;
    if (data.length < PAGE) break;
  }
  console.log("\nby source_dataset:");
  for (const [s, n] of Object.entries(bySrc).sort((a,b) => b[1]-a[1])) console.log(`  ${s.padEnd(30)} ${n}`);
})();
