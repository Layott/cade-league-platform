import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data } = await sb
  .from("matches")
  .select("id, match_day_id, home_player_id, away_player_id, match_days!inner(match_date), home:players!matches_home_player_id_fkey(gamer_tag), away:players!matches_away_player_id_fkey(gamer_tag)")
  .eq("match_days.match_date", "2026-04-26");
console.log("Matches on 2026-04-26:");
for (const m of data ?? []) {
  console.log(`  ${m.home?.gamer_tag} vs ${m.away?.gamer_tag} (match_id=${m.id})`);
}

const adefolaGuru = (data ?? []).find(m =>
  (m.home?.gamer_tag === 'ADEFOLA' && m.away?.gamer_tag === 'GURU') ||
  (m.home?.gamer_tag === 'GURU' && m.away?.gamer_tag === 'ADEFOLA')
);
if (adefolaGuru) {
  console.log("\nFound Adefola vs Guru match:", adefolaGuru.id);
  const { data: results } = await sb
    .from("match_results")
    .select("*")
    .eq("match_id", adefolaGuru.id);
  console.log("All match_results for it (incl deleted):");
  for (const r of results ?? []) console.log(JSON.stringify(r, null, 2));
}
