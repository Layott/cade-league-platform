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
  // Sample icons — search for famous icon names
  const icons = ["Pele", "Maradona", "Ronaldo Nazário", "Ronaldo Luís Nazário", "Cruyff", "Zidane", "Beckenbauer", "Kahn", "Puskás", "Eusébio", "Ronaldinho", "Drogba", "Henry", "Zanetti"];
  console.log("=== icon lookups (default view should surface these) ===");
  for (const nm of icons) {
    const { data } = await sb.from("fc26_players")
      .select("name, rating, item_type, value_coins_estimate, attributes")
      .eq("source_dataset", "futbin.com")
      .ilike("name", `%${nm}%`)
      .is("deleted_at", null)
      .order("rating", { ascending: false })
      .limit(3);
    if (!data?.length) { console.log(`  ${nm.padEnd(25)}  (not found)`); continue; }
    for (const r of data) console.log(`  ${nm.padEnd(25)}  r${r.rating}  ${r.item_type}  ${r.attributes?.futbin_variant || "?"}  ${r.name}  ${r.value_coins_estimate?.toLocaleString() || "?"}`);
  }

  // Counts by item_type + coin band
  console.log("\n=== premium card counts ===");
  for (const it of ["icon", "hero", "toty", "tots", "rttf"]) {
    const { count } = await sb.from("fc26_players").select("id", { count: "exact", head: true })
      .eq("source_dataset", "futbin.com").eq("item_type", it).is("deleted_at", null);
    console.log(`  ${it.padEnd(8)} ${count}`);
  }
})();
