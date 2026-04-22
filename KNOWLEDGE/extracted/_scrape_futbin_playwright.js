#!/usr/bin/env node
// Futbin EAFC26 scraper — Playwright edition.
//
// Plain node fetch returns 403 from Cloudflare (bot-fight / TLS fingerprint).
// Playwright drives real Chromium so JS runs and Cloudflare passes.
//
// Usage: node KNOWLEDGE/extracted/_scrape_futbin_playwright.js
// Resume state: KNOWLEDGE/extracted/futbin_scrape_state.json
// Unmatched: KNOWLEDGE/extracted/futbin_unmatched.json
//
// On first run, Playwright opens a visible Chromium (headful). After the
// first page clears Cloudflare, subsequent pages are cached-session so it's
// fast. Kill the browser at exit.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const STATE_PATH = path.resolve(__dirname, "futbin_scrape_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futbin_unmatched.json");
const LIST_URL = (p) => `https://www.futbin.com/26/players?page=${p}`;
const BATCH_FLUSH_EVERY = 50;
const DELAY_MIN_MS = 1500;
const DELAY_JITTER_MS = 2000;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastPage: 0, processed: 0 };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { lastPage: 0, processed: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

function stripDiacritics(s) { return s.normalize("NFKD").replace(/[̀-ͯ]/g, ""); }
function slugify(name) {
  return stripDiacritics(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCoins(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (/^(-|0|sbc|untradeable|n\/a)$/i.test(s)) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mul = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] : 1;
  return Math.round(n * mul);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitter() { return DELAY_MIN_MS + Math.floor(Math.random() * DELAY_JITTER_MS); }

async function extractListPage(page) {
  // Futbin renders the player list inside a table with data rows. Each row's
  // price cells carry the current PS price in `.price.platform-ps-only` OR
  // as text inside specific tds. We dispatch to the page's DOM.
  return page.evaluate(() => {
    const rows = [];
    const trs = document.querySelectorAll("table.players_table tbody tr, table#repTb tbody tr, .players_table tbody tr, tbody tr.player_tr_1, tbody tr.player_tr_2");
    for (const tr of trs) {
      const nameEl = tr.querySelector("a.player_name_players_table, a.player-name, td.player a, .player-nameval a, a[href*='/26/player/']");
      if (!nameEl) continue;
      const name = nameEl.textContent.trim();
      const href = nameEl.getAttribute("href") || "";
      const idMatch = href.match(/\/26\/player\/(\d+)/);
      const futbinId = idMatch ? idMatch[1] : null;

      const ratingEl = tr.querySelector(".pcdisplay-rat, .rating, td.rating");
      const rating = ratingEl ? parseInt(ratingEl.textContent.trim(), 10) : null;

      const positionEl = tr.querySelector(".pcdisplay-pos, .position, td.position");
      const position = positionEl ? positionEl.textContent.trim() : null;

      const clubEl = tr.querySelector("a[href*='/clubs/']") || tr.querySelector(".club");
      const club = clubEl ? clubEl.textContent.trim() || clubEl.getAttribute("title") : null;

      const leagueEl = tr.querySelector("a[href*='/leagues/']") || tr.querySelector(".league");
      const league = leagueEl ? leagueEl.textContent.trim() || leagueEl.getAttribute("title") : null;

      const nationEl = tr.querySelector("a[href*='/nation/']") || tr.querySelector(".nation");
      const nation = nationEl ? nationEl.textContent.trim() || nationEl.getAttribute("title") : null;

      // Prices can live in multiple cells. Collect all data attributes + text.
      const priceCell = tr.querySelector(".platform-ps-only, .platform-pc-only, .price.platform-ps-only, td.ps-price, td[data-platform='ps'], .table-prices .ps");
      const priceText = priceCell ? priceCell.textContent.trim() : null;
      const dataPrice = tr.getAttribute("data-price-ps") || tr.querySelector("[data-price-num]")?.getAttribute("data-price-num") || null;

      const revisionEl = tr.querySelector(".pcdisplay-rev, .player-revision, td.revision");
      const revision = revisionEl ? revisionEl.textContent.trim() : "normal";

      rows.push({ futbinId, name, rating, position, club, league, nation, priceText, dataPrice, revision });
    }
    // Also probe pagination for total pages on page 1.
    const last = document.querySelector("a.last, a[rel='last'], .pagination a:last-of-type");
    const lastHref = last?.getAttribute("href") || "";
    const totalPagesMatch = lastHref.match(/page=(\d+)/);
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : null;
    return { rows, totalPages };
  });
}

async function matchAndUpdate(sb, frows, stats, unmatched) {
  for (const fr of frows) {
    if (!fr.name || !fr.rating) continue;
    const coins = parseCoins(fr.dataPrice) ?? parseCoins(fr.priceText);
    if (!coins || coins <= 0) { stats.noPrice++; continue; }
    if (fr.revision && fr.revision.toLowerCase() !== "normal" && fr.revision.toLowerCase() !== "gold") {
      // Only match base/normal cards for now — non-normal revisions would need per-row revision tracking.
      stats.skippedRevision++;
      continue;
    }
    const slug = slugify(fr.name);
    // First exact slug + rating
    let { data: matches } = await sb
      .from("fc26_players")
      .select("id, name, rating, position, club")
      .eq("slug", slug)
      .eq("rating", fr.rating)
      .is("deleted_at", null);
    if ((!matches || matches.length === 0) && fr.name) {
      // Trigram fuzzy via RPC if available; else basic ilike
      const like = fr.name.replace(/[%_]/g, "").trim();
      if (like.length >= 3) {
        const { data: m2 } = await sb
          .from("fc26_players")
          .select("id, name, rating, position, club")
          .ilike("name", `%${like}%`)
          .eq("rating", fr.rating)
          .is("deleted_at", null)
          .limit(3);
        matches = m2 || [];
      }
    }
    if (!matches || matches.length === 0) {
      unmatched.push(fr);
      stats.unmatched++;
      continue;
    }
    // Prefer position + club match when multiple rows tie.
    let chosen = matches[0];
    if (matches.length > 1) {
      const better = matches.find((m) =>
        (!fr.position || m.position === fr.position) &&
        (!fr.club || (m.club || "").toLowerCase() === fr.club.toLowerCase())
      );
      if (better) chosen = better;
    }
    const { error } = await sb
      .from("fc26_players")
      .update({
        value_coins_estimate: coins,
        attributes: null, // we'll fetch current + merge below
        updated_at: new Date().toISOString(),
      })
      .eq("id", chosen.id);
    if (error) { stats.errors++; continue; }
    // Merge attributes.price_source / snapshot_at — need second call since we
    // nulled attributes above. Simpler: skip the null + use rpc-like merge.
    // Fallback: fetch current attributes then update with merged value.
    const { data: cur } = await sb
      .from("fc26_players")
      .select("attributes")
      .eq("id", chosen.id)
      .single();
    const attrs = (cur?.attributes && typeof cur.attributes === "object") ? cur.attributes : {};
    attrs.price_source = "futbin_live";
    attrs.price_snapshot_at = new Date().toISOString();
    attrs.futbin_id = fr.futbinId ?? null;
    await sb.from("fc26_players").update({ attributes: attrs, value_coins_estimate: coins }).eq("id", chosen.id);
    stats.updated++;
  }
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing Supabase env");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const state = process.argv.includes("--reset") ? { lastPage: 0, processed: 0 } : loadState();
  const unmatched = [];
  const stats = { pages: 0, rows: 0, updated: 0, unmatched: 0, noPrice: 0, skippedRevision: 0, errors: 0 };

  console.log(`[futbin] resume from page ${state.lastPage}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--disable-web-security"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="129", "Not=A?Brand";v="8", "Google Chrome";v="129"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    },
  });
  const page = await context.newPage();

  // Warmup — home page first to clear Cloudflare JS challenge.
  console.log("[futbin] warmup …");
  try {
    await page.goto("https://www.futbin.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    // Wait up to 15s for any cf challenge to auto-complete.
    await page.waitForTimeout(8000);
  } catch (e) {
    console.error("[fatal] warmup failed:", e.message);
    await browser.close();
    process.exit(1);
  }

  // Fetch page 1 to discover totalPages.
  let totalPages = 0;
  {
    const p = Math.max(1, state.lastPage + 1);
    console.log(`[futbin] page ${p} …`);
    try {
      await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3000);
      const { rows, totalPages: tp } = await extractListPage(page);
      if (tp) totalPages = tp;
      stats.rows += rows.length;
      stats.pages++;
      await matchAndUpdate(sb, rows, stats, unmatched);
      state.lastPage = p;
      state.processed = stats.updated;
      saveState(state);
      console.log(`[futbin] p${p}: ${rows.length} rows, ${stats.updated} updated total`);
    } catch (e) {
      console.error(`[err] p${p}:`, e.message);
    }
  }

  const MAX_PAGES = totalPages || 800;
  for (let p = state.lastPage + 1; p <= MAX_PAGES; p++) {
    await sleep(jitter());
    try {
      await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      const { rows } = await extractListPage(page);
      if (rows.length === 0) { console.log(`[futbin] p${p}: 0 rows — likely end of catalogue. stopping.`); break; }
      stats.rows += rows.length;
      stats.pages++;
      await matchAndUpdate(sb, rows, stats, unmatched);
      state.lastPage = p;
      state.processed = stats.updated;
      if (p % 10 === 0) saveState(state);
      if ((p % 5 === 0) || p < 5) {
        console.log(`[futbin] p${p}/${MAX_PAGES}: +${rows.length} rows. total updated=${stats.updated} unmatched=${stats.unmatched} noPrice=${stats.noPrice}`);
      }
    } catch (e) {
      console.error(`[err] p${p}:`, e.message);
      // Soft backoff on error
      await sleep(15000);
    }
  }

  saveState(state);
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2));
  console.log("[futbin] done. stats:", stats);
  await browser.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
