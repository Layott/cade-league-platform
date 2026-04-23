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
  const { data } = await sb.from("fc26_players")
    .select("attributes")
    .eq("source_dataset", "futbin.com")
    .not("attributes->>card_bg_url", "is", null)
    .is("deleted_at", null)
    .limit(10);
  if (!data?.length) { console.log("no rows with card_bg_url yet"); return; }
  console.log("Real card_bg_url values from recent scrape:");
  for (const r of data) {
    console.log(`  variant=${r.attributes.futbin_variant}  →  ${r.attributes.card_bg_url}`);
  }
})();
