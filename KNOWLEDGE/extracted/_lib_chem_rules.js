// Shared Futbin chem-rules fetcher.
//
// Futbin embeds the global `Fut26ChemistryData` JSON on every saved squad
// page (e.g. `https://www.futbin.com/26/squad/460`). The JSON contains:
//   - `rareTypeRules` — { [rareTypeId]: { club, league, nation, ... } }
//   - `heroClubId.value`  — pseudo-club ID for Heroes (e.g. 114605)
//   - `iconClubId.value`  — pseudo-club ID for Icons  (e.g. 112658)
//
// This is global state — same JSON on every squad page. We only need ONE
// fetch per scrape run to keep our chem.ts rule table in sync. The
// scrapers (`_scrape_futbin_headful.js`, `_scrape_futbin_new.js`,
// `_scrape_futbin_parallel.js`) call `fetchAndPersistChemRules(...)` once
// before exit. The function is idempotent — safe to re-run.
//
// On every successful fetch the helper:
//   1. Persists the rules to `public.fc_chemistry_rules` (single row,
//      keyed `'fut26'`).
//   2. Writes a mirror file at `apps/web/src/lib/chemistry-rules.json`
//      so chem.ts can import it at compile time (avoids a DB hit on
//      every chem calc).
//   3. Logs a delta vs the prior file so drift is visible in scrape logs.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const JSON_OUT_PATH = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "lib",
  "chemistry-rules.json",
);
const SAMPLE_SQUAD_URLS = [
  "https://www.futbin.com/26/squad/460",
  "https://www.futbin.com/26/squad/977076",
  "https://www.futbin.com/26/squad/369",
];

// Pure helper — extract Fut26ChemistryData JSON from a Futbin saved
// squad HTML page. The chem data is embedded inside an inline <script>
// tag carrying the squad's hydration payload. We brace-match starting at
// the `chemistryData` key to lift the object intact.
function extractChemRulesFromHtml(html) {
  if (!html || typeof html !== "string") return null;
  const idx = html.indexOf("chemistryData");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") {
      if (start < 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const raw = html.slice(start, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Normalise the extracted Futbin payload into our DB row shape. Strips
// the `{value: <int>}` wrapper that Futbin uses for typed scalar fields.
function normaliseRules(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rareTypeRules = raw.rareTypeRules;
  if (!rareTypeRules || typeof rareTypeRules !== "object") return null;
  const heroClubId =
    raw.heroClubId && typeof raw.heroClubId === "object"
      ? raw.heroClubId.value ?? null
      : null;
  const iconClubId =
    raw.iconClubId && typeof raw.iconClubId === "object"
      ? raw.iconClubId.value ?? null
      : null;
  // Reduce contribution objects to flat shape that mirrors our chem.ts
  // ChemistryBonus type. Futbin: {contribution: 1, wildcard: true} →
  // ours: {leagueSymbols: 0, leagueSymbolsAllLeagues: true} when the
  // wildcard flag is set; otherwise {leagueSymbols: <contribution>}.
  const out = {};
  for (const [rareId, rule] of Object.entries(rareTypeRules)) {
    if (!rule || typeof rule !== "object") continue;
    const club = rule.club || {};
    const league = rule.league || {};
    const nation = rule.nation || {};
    const bonus = {};
    if (typeof club.contribution === "number") bonus.clubSymbols = club.contribution;
    if (league.wildcard === true) {
      bonus.leagueSymbols = 0;
      bonus.leagueSymbolsAllLeagues = true;
    } else if (typeof league.contribution === "number") {
      bonus.leagueSymbols = league.contribution;
    }
    if (typeof nation.contribution === "number") bonus.nationSymbols = nation.contribution;
    if (rule.alwaysFullChemistry === true) bonus.fullChemInPosition = true;
    out[rareId] = bonus;
  }
  return { rareTypeRules: out, heroClubId, iconClubId };
}

// Fetch via an EXISTING Playwright page (so the scraper's already-warm
// browser context handles Cloudflare). Returns the extracted rules
// object or null on miss. Caller is responsible for navigating away
// before resuming the scrape (the page state is shared).
async function fetchChemRulesViaPlaywright(page) {
  for (const url of SAMPLE_SQUAD_URLS) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      const html = await page.content();
      const raw = extractChemRulesFromHtml(html);
      const norm = normaliseRules(raw);
      if (norm && Object.keys(norm.rareTypeRules).length > 0) {
        norm.sourceUrl = url;
        return norm;
      }
    } catch {
      // try next URL
    }
  }
  return null;
}

// Persist to DB. Single-row upsert keyed on game_key='fut26'.
async function persistChemRulesToDb(sb, normalised) {
  if (!sb || !normalised) return { ok: false, reason: "missing args" };
  try {
    const { error } = await sb
      .from("fc_chemistry_rules")
      .upsert(
        {
          game_key: "fut26",
          rare_type_rules: normalised.rareTypeRules,
          hero_club_id: normalised.heroClubId,
          icon_club_id: normalised.iconClubId,
          source_url: normalised.sourceUrl ?? null,
          last_scraped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "game_key" },
      );
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

// Write mirror to apps/web/src/lib/chemistry-rules.json. chem.ts imports
// this at build-time so unit tests + Vercel build don't need a DB hit.
function writeChemRulesJson(normalised) {
  if (!normalised) return { ok: false, reason: "no rules" };
  let prevRaw = null;
  try {
    prevRaw = fs.readFileSync(JSON_OUT_PATH, "utf8");
  } catch {
    /* first write */
  }
  const payload = {
    gameKey: "fut26",
    rareTypeRules: normalised.rareTypeRules,
    heroClubId: normalised.heroClubId,
    iconClubId: normalised.iconClubId,
    sourceUrl: normalised.sourceUrl ?? null,
    lastScrapedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(JSON_OUT_PATH, json, "utf8");
  // Diff vs previous (ignore lastScrapedAt churn).
  let drift = "first-write";
  if (prevRaw) {
    try {
      const prev = JSON.parse(prevRaw);
      const norm = (obj) => ({ ...obj, lastScrapedAt: undefined });
      drift =
        JSON.stringify(norm(prev)) === JSON.stringify(norm(payload))
          ? "unchanged"
          : "changed";
    } catch {
      drift = "prev-parse-fail";
    }
  }
  return { ok: true, drift, path: JSON_OUT_PATH };
}

// Top-level orchestrator — call once per scrape run.
//
//   const { chromium } = require("playwright");
//   const browser = await chromium.launch({ headless: false });
//   const ctx = await browser.newContext();
//   const page = await ctx.newPage();
//   ...scrape player catalog...
//   const result = await fetchAndPersistChemRules({ page, sb });
//   console.log("[chem-rules]", result);
//   await browser.close();
//
// Best-effort: errors are SWALLOWED + reported in the result object.
// A failed chem-rules fetch must NEVER abort an in-progress player
// catalog scrape.
async function fetchAndPersistChemRules({ page, sb }) {
  if (!page) return { ok: false, reason: "no page" };
  const rules = await fetchChemRulesViaPlaywright(page);
  if (!rules) return { ok: false, reason: "extract miss across all sample URLs" };
  const fileWrite = writeChemRulesJson(rules);
  let dbWrite = { ok: false, reason: "no sb" };
  if (sb) dbWrite = await persistChemRulesToDb(sb, rules);
  return {
    ok: true,
    rareTypeCount: Object.keys(rules.rareTypeRules).length,
    heroClubId: rules.heroClubId,
    iconClubId: rules.iconClubId,
    sourceUrl: rules.sourceUrl,
    fileWrite,
    dbWrite,
  };
}

module.exports = {
  extractChemRulesFromHtml,
  normaliseRules,
  fetchChemRulesViaPlaywright,
  persistChemRulesToDb,
  writeChemRulesJson,
  fetchAndPersistChemRules,
  JSON_OUT_PATH,
  SAMPLE_SQUAD_URLS,
};
