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

  // Try many accented / long-form variants
  const hunts = [
    ["Pele", ["Pele", "Pelé", "Edson Arantes", "Arantes do Nascimento"]],
    ["Ronaldinho", ["Ronaldinho", "Ronaldinho Gaúcho", "Ronaldo de Assis", "Assis Moreira"]],
    ["Cristiano Ronaldo", ["Cristiano Ronaldo", "Cristiano Ronaldo dos Santos", "Ronaldo dos Santos"]],
    ["Messi", ["Messi", "Lionel Messi", "Lionel Andrés Messi"]],
    ["Mbappe", ["Mbappé", "Mbappe", "Kylian Mbappé", "Kylian Mbappe"]],
    ["Neymar", ["Neymar", "Neymar da Silva", "Neymar Jr", "da Silva Santos"]],
    ["Xavi", ["Xavi", "Xavier Hernández", "Xavier Hernandez"]],
    ["Iniesta", ["Iniesta", "Andrés Iniesta", "Andres Iniesta"]],
    ["Buffon", ["Buffon", "Gianluigi Buffon"]],
    ["Cantona", ["Cantona", "Eric Cantona"]],
    ["Del Piero", ["Del Piero", "Alessandro Del Piero"]],
    ["Ronaldo (striker)", ["Ronaldo Luís Nazário", "Ronaldo Nazário"]],
  ];
  for (const [label, patterns] of hunts) {
    let matches = [];
    for (const p of patterns) {
      const { data } = await sb.from("fc26_players")
        .select("name, rating, item_type, value_coins_estimate, attributes")
        .eq("source_dataset", "futbin.com")
        .ilike("name", `%${p}%`)
        .is("deleted_at", null)
        .order("rating", { ascending: false })
        .limit(5);
      if (data?.length) matches.push(...data);
    }
    // Dedupe by (name + rating + variant)
    const seen = new Set();
    matches = matches.filter((r) => {
      const k = `${r.name}__${r.rating}__${r.attributes?.futbin_variant || ""}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (matches.length === 0) {
      console.log(`❌ ${label}  — NONE FOUND`);
    } else {
      console.log(`✅ ${label}  — ${matches.length} variant(s)`);
      for (const r of matches.slice(0, 6)) {
        console.log(`    r${r.rating}  ${r.item_type.padEnd(8)}  ${(r.attributes?.futbin_variant || "").padEnd(25)}  ${r.name}`);
      }
    }
  }
})();
