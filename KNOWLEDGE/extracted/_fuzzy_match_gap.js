#!/usr/bin/env node
// For each Kaggle "gap" row (no futbin_resource_id), try to find a
// Futbin row that is almost certainly the same player — same rating,
// same position, fuzzy name match.
//
// Strategy:
//   1. Load all gap Kaggle rows + all futbin.com rows into memory.
//   2. Index futbin rows by (rating, first_name_token) and
//      (rating, last_name_token).
//   3. For each gap row, compute token sets from the name. Find
//      futbin candidates with overlapping tokens + same rating ±1.
//   4. Score: # shared tokens / max(token_count_kaggle, token_count_fb).
//      Accept matches with score >= 0.5 and exactly one candidate.
//
// Output: writes futbin_gap_fuzzy.json with:
//   - matched:  [{ kaggleName, futbinName, rating, score, kaggleId, futbinId }]
//   - unmatched: [{ name, rating, position }]
// Does NOT mutate the DB. Safe preview.

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

function stripDiacritics(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function tokens(s) {
  return stripDiacritics(String(s || ""))
    .toLowerCase()
    .split(/[\s.\-_'/()]+/)
    .filter((t) => t.length >= 2);
}
function jr(t) {
  return /^(jr|junior|snr|senior|de|da|do|dos|das|del|la|le|van|von|el|al|bin|ibn|mc)$/.test(t);
}

(async () => {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // 1. Load gap + futbin rows.
  const load = async (query) => {
    const all = [];
    for (let o = 0; ; o += 1000) {
      const { data, error } = await query.range(o, o + 999);
      if (error) { console.error(error); process.exit(1); }
      if (!data?.length) break;
      all.push(...data);
      if (data.length < 1000) break;
    }
    return all;
  };

  const gap = await load(
    sb.from("fc26_players")
      .select("id, name, rating, position")
      .eq("source_dataset", "https://www.kaggle.com/datasets/flynn28/eafc26-player-database")
      .is("deleted_at", null)
      .is("attributes->>futbin_resource_id", null)
      .order("rating", { ascending: false }),
  );
  const futbin = await load(
    sb.from("fc26_players")
      .select("id, name, rating, position, attributes")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .order("rating", { ascending: false }),
  );

  console.log(`gap (kaggle without futbin): ${gap.length}`);
  console.log(`futbin pool: ${futbin.length}`);

  // 2. Index Futbin rows by rating → list.
  const byRating = new Map();
  for (const r of futbin) {
    const rt = r.rating;
    if (!byRating.has(rt)) byRating.set(rt, []);
    byRating.get(rt).push(r);
  }
  // Helper that returns candidates at rating ±1 to absorb per-card rating drift.
  function candidatesForRating(rt) {
    return [
      ...(byRating.get(rt) ?? []),
      ...(byRating.get(rt - 1) ?? []),
      ...(byRating.get(rt + 1) ?? []),
    ];
  }

  // 3. Match.
  const matches = [];
  const unmatched = [];
  const ambiguous = [];

  for (const k of gap) {
    const kToks = tokens(k.name).filter((t) => !jr(t));
    if (kToks.length === 0) {
      unmatched.push({ name: k.name, rating: k.rating, position: k.position });
      continue;
    }
    const candidates = candidatesForRating(k.rating);
    const scored = [];
    for (const c of candidates) {
      // Position filter dropped — promo variants often sit in an alternate
      // position (e.g. Alexia Putellas base CM, Fantasy card CAM) and we'd
      // miss the same player.
      const cToks = tokens(c.name).filter((t) => !jr(t));
      if (cToks.length === 0) continue;
      // Count Kaggle tokens that appear exactly OR prefix-match (≥4 chars)
      // in the Futbin token set.
      let covered = 0;
      for (const t of kToks) {
        if (cToks.includes(t)) { covered++; continue; }
        if (t.length >= 4 && cToks.some((c2) => c2.startsWith(t) || t.startsWith(c2))) {
          covered++;
        }
      }
      const kScore = covered / kToks.length;
      // Require every Kaggle token accounted for. pos+rating+full-coverage
      // is strict enough to avoid false positives without needing
      // bidirectional balance.
      if (kScore >= 1.0) {
        scored.push({ c, score: kScore, covered, cToks });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
      unmatched.push({ name: k.name, rating: k.rating, position: k.position });
    } else if (scored.length === 1 || scored[0].score > scored[1].score + 0.1) {
      const w = scored[0];
      matches.push({
        kaggleId: k.id,
        kaggleName: k.name,
        futbinId: w.c.id,
        futbinName: w.c.name,
        futbinResourceId: w.c.attributes?.futbin_resource_id ?? null,
        rating: k.rating,
        score: +w.score.toFixed(2),
        shared: w.shared,
      });
    } else {
      ambiguous.push({
        kaggleId: k.id,
        kaggleName: k.name,
        rating: k.rating,
        top: scored.slice(0, 3).map((s) => ({
          name: s.c.name,
          score: +s.score.toFixed(2),
        })),
      });
    }
  }

  console.log(`\nmatches:   ${matches.length}`);
  console.log(`ambiguous: ${ambiguous.length}`);
  console.log(`unmatched: ${unmatched.length}`);

  // Bucket unmatched by rating band for readability.
  const ubands = { "90+": 0, "85-89": 0, "80-84": 0, "75-79": 0, "70-74": 0, "<70": 0 };
  for (const u of unmatched) {
    const b = u.rating >= 90 ? "90+" : u.rating >= 85 ? "85-89" : u.rating >= 80 ? "80-84" : u.rating >= 75 ? "75-79" : u.rating >= 70 ? "70-74" : "<70";
    ubands[b]++;
  }
  console.log("\ntruly-missing rating bands:");
  for (const [b, n] of Object.entries(ubands)) console.log(`  ${b.padEnd(6)} ${n}`);

  console.log("\ntruly-missing (top 20 by rating):");
  for (const u of unmatched.slice(0, 20)) console.log(`  r${u.rating}  ${(u.position ?? "").padEnd(3)}  ${u.name}`);

  console.log("\nmatches sample (top 10 by score):");
  const topM = [...matches].sort((a,b) => b.score - a.score).slice(0, 10);
  for (const m of topM) console.log(`  r${m.rating}  ${m.score}  ${m.kaggleName} → ${m.futbinName}`);

  const out = { matches, ambiguous, unmatched };
  const outPath = path.resolve(__dirname, "futbin_gap_fuzzy.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
})();
