const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
(async () => {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const patterns = ["Mikel", "Obi", "John Obi", "John Mikel", "Obinna", "Obi Mikel"];
  for (const p of patterns) {
    const { data } = await sb.from("fc26_players")
      .select("name, rating, position, item_type, source_dataset, attributes")
      .ilike("name", `%${p}%`)
      .is("deleted_at", null)
      .limit(15);
    if (!data?.length) { console.log(`❌ "${p}" — NONE`); continue; }
    console.log(`✅ "${p}" — ${data.length} matches:`);
    for (const r of data) {
      console.log(`    r${r.rating}  ${r.position?.padEnd(4)}  ${r.item_type.padEnd(8)}  ${r.source_dataset === "futbin.com" ? "FUTBIN" : "KAGGLE"}  ${r.name}  (${r.attributes?.futbin_variant ?? "-"})`);
    }
  }
})();
