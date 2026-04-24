#!/usr/bin/env node
// Futbin Nigeria nation-ID finder.
//
// Context: Futbin's /26/players list page doesn't ship raw ISO codes for
// nations — the country flag is served as a CDN icon keyed by a Futbin-
// internal integer ID. The ID for Nigeria in FC26 is not documented and
// may differ from historical FIFA-year values (133 was Nigeria in FIFA
// 23, for example — still our best-guess default). This script finds
// the current FC26 Nigeria ID by looking at the DB AFTER a fresh scrape
// has populated `attributes.futbin_nation_id` for Kaggle-enriched
// rows where `nation='Nigeria'` is already known.
//
// Usage (after a fresh Futbin scrape that captures futbin_nation_id):
//   node KNOWLEDGE/extracted/_find_futbin_nation_id.js
//
// The script:
//   1. Pulls rows where nation='Nigeria' AND attributes.futbin_nation_id IS NOT NULL.
//   2. Prints the modal (most-frequent) futbin_nation_id — that's the
//      FC26 Nigeria ID.
//   3. Also prints the breakdown so you can see if there's any skew
//      (e.g. some rows came in mislabelled).
//
// Once you've confirmed the value, set NG_FUTBIN_NATION_ID in the
// web app's env (or in apps/web/src/server/squads/validate.ts as the
// default) so the Nigerian-in-starting-XI count works for cards where
// nation_iso is empty.

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

async function main() {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // We pull a generous sample so the modal is statistically stable.
  // Kaggle-enriched rows carry `nation='Nigeria'` already; after a fresh
  // Futbin scrape, `attributes.futbin_nation_id` is populated too. When
  // both are present on the same row, the ID must be Nigeria's.
  const { data, error } = await sb
    .from("fc26_players")
    .select("id, name, nation, nation_iso, attributes")
    .eq("nation", "Nigeria")
    .not("attributes->>futbin_nation_id", "is", null)
    .is("deleted_at", null)
    .limit(200);

  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.error("no rows matched. Did you scrape Futbin yet with the updated scrapers?");
    console.error("");
    console.error("Expected path:");
    console.error("  1. Run a Futbin scrape (any of _scrape_futbin_*.js) — captures futbin_nation_id.");
    console.error("  2. Re-run this helper — it matches Nigeria-labelled rows against their IDs.");
    process.exit(2);
  }

  const counts = new Map();
  for (const row of data) {
    const attrs = row.attributes && typeof row.attributes === "object" ? row.attributes : {};
    const id = typeof attrs.futbin_nation_id === "number" ? attrs.futbin_nation_id : null;
    if (id == null) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  if (counts.size === 0) {
    console.error("matched rows had no numeric futbin_nation_id — attributes jsonb may be malformed.");
    process.exit(3);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [modalId, modalCount] = sorted[0];
  console.log(`\nFutbin Nigeria nation_id (FC26): ${modalId}`);
  console.log(`  based on ${modalCount}/${data.length} rows labelled nation='Nigeria'.`);
  console.log("");
  console.log("Full breakdown:");
  for (const [id, n] of sorted) {
    const pct = ((n / data.length) * 100).toFixed(1);
    console.log(`  id=${id}\tcount=${n}\t(${pct}%)`);
  }
  console.log("");
  console.log("Next step: set NG_FUTBIN_NATION_ID env var to this value (or update the");
  console.log("           default in apps/web/src/server/squads/validate.ts).");
}

main().catch((e) => {
  console.error("[fatal]", e.stack || e.message);
  process.exit(1);
});
