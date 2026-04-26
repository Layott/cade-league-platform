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
const NOW = new Date().toISOString();

console.log("== Plan 52 fixup ==");

// 1. Soft-delete e2e-appeal-* leftover players
const { data: leftovers, error: lErr } = await sb
  .from("players")
  .select("id, gamer_tag")
  .like("gamer_tag", "e2e-appeal-%")
  .is("deleted_at", null);
if (lErr) throw new Error(lErr.message);
console.log(`Found ${leftovers?.length ?? 0} e2e-appeal-* players to soft-delete`);
if (leftovers && leftovers.length) {
  const ids = leftovers.map((p) => p.id);
  const { error: dErr } = await sb
    .from("players")
    .update({ deleted_at: NOW })
    .in("id", ids);
  if (dErr) throw new Error(`soft-delete: ${dErr.message}`);
  console.log(`  soft-deleted ${ids.length} leftover players`);
}

// 2. Link BAJI_JNR + KILLER_FREAK using underscore tags
const { data: orgs } = await sb
  .from("organizations")
  .select("id, name")
  .is("deleted_at", null);
const orgByName = new Map(
  (orgs ?? []).map((o) => [o.name.toLowerCase(), o.id]),
);
const fixupLinks = [
  ["BAJI_JNR", "GameEvo Esports"],
  ["KILLER_FREAK", "GameEvo Esports"],
];
let linked = 0;
for (const [tag, orgName] of fixupLinks) {
  const orgId = orgByName.get(orgName.toLowerCase());
  if (!orgId) {
    console.warn(`  no org named ${orgName}`);
    continue;
  }
  const { error: uErr } = await sb
    .from("players")
    .update({ organization_id: orgId })
    .eq("gamer_tag", tag)
    .is("deleted_at", null);
  if (uErr) {
    console.warn(`  fail link ${tag}: ${uErr.message}`);
    continue;
  }
  linked++;
}
console.log(`Linked ${linked}/2 fixup players`);

// 3. Verify
const { count: activePlayers } = await sb
  .from("players")
  .select("*", { count: "exact", head: true })
  .is("deleted_at", null);
console.log(`Active players now: ${activePlayers}`);

const { data: finalState } = await sb
  .from("players")
  .select("gamer_tag, organization_id")
  .is("deleted_at", null)
  .order("gamer_tag");
console.log("Final state:");
for (const p of finalState ?? []) {
  console.log(`  ${p.gamer_tag} → ${p.organization_id ? "linked" : "NULL"}`);
}
console.log("== done ==");

// 4. Clean stale standings + season_participants for soft-deleted players
const { data: deletedPlayers } = await sb
  .from("players")
  .select("id")
  .not("deleted_at", "is", null);
const deletedIds = (deletedPlayers ?? []).map((p) => p.id);
if (deletedIds.length) {
  const { count: spDel } = await sb
    .from("season_participants")
    .delete({ count: "exact" })
    .in("player_id", deletedIds);
  console.log(`Cleaned ${spDel ?? 0} season_participants for deleted players`);
  const { count: stDel } = await sb
    .from("standings")
    .delete({ count: "exact" })
    .in("player_id", deletedIds);
  console.log(`Cleaned ${stDel ?? 0} standings for deleted players`);
}
