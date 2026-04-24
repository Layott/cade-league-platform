#!/usr/bin/env node
// Headful Futbin scraper — opens a VISIBLE Chromium window.
//
// Cloudflare's JS challenge is easier to pass when the browser is
// headful (real window, real compositor, real GPU) vs headless. This
// script opens Chromium, navigates to Futbin, pauses 20s so the user
// can see the page load + manually solve any Cloudflare interstitial
// if one appears, then proceeds with paginated scrape.
//
// Usage (from repo root, with Sharp VPN up):
//   node KNOWLEDGE/extracted/_scrape_futbin_headful.js
//
// When the browser window opens:
//   1. Wait for Futbin home to fully load.
//   2. If you see a Cloudflare "Verify you are human" box, tick it.
//   3. Return to the terminal and press ENTER.
//   4. Leave the browser window open until the terminal says "done".

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const STATE_PATH = path.resolve(__dirname, "futbin_headful_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futbin_headful_unmatched.json");
const INSERTED_PATH = path.resolve(__dirname, "futbin_headful_inserted.json");
const DEBUG_HTML_PATH = path.resolve(__dirname, "_futbin_headful_p1.html");
const LIST_URL = (p) => `https://www.futbin.com/26/players?page=${p}`;
const HOME_URL = "https://www.futbin.com/";
const DELAY_MIN = 2500;
const DELAY_JIT = 2500;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { lastPage: 0 }; } };
const saveState = (s) => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
const stripD = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const slugify = (n) => stripD(n || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MIN + Math.floor(Math.random() * DELAY_JIT);

function parseCoins(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (/^(-|0|sbc|untradeable|n\/a|extinct)$/i.test(s)) return null;
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1));
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

// Extractor calibrated to live Futbin EAFC 26 DOM (Apr 2026).
// Each row is a <tr class="player-row"> containing the card anchor
// plus a dozen <td> columns: rating / skills / weak-foot / PAC / SHO /
// PAS / DRI / DEF / PHY / price-ps / price-pc / popularity / etc.
async function extractListPage(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.player-row"));
    const out = [];
    for (const row of rows) {
      // Card anchor carries href + card art. May be nested <a class="player-row-playercard">.
      const cardAnchor = row.querySelector("a.player-row-playercard, a[href*='/26/player/']");
      const href = cardAnchor?.getAttribute("href") || "";
      const hrefM = href.match(/\/26\/player\/(\d+)\/([^/?#]+)/);
      if (!hrefM) continue;
      const resourceId = hrefM[1];
      const slug = hrefM[2];

      // Name — the table-name column holds a separate anchor.
      const nameAnchor = row.querySelector("a.table-player-name");
      const titleAttrHolder = row.querySelector("[title]");
      const name = nameAnchor?.textContent?.trim()
        || titleAttrHolder?.getAttribute("title")?.trim()
        || null;

      // Rating
      const ratingText = row.querySelector("td.table-rating .rating-square, td.table-rating")?.textContent?.trim();
      const rating = ratingText ? parseInt(ratingText, 10) : null;

      // Prices: PS + PC (XboX often mirrors PS on Futbin's list).
      const pricePs = row.querySelector("td.table-price.platform-ps-only .price")?.textContent?.trim() || null;
      const pricePc = row.querySelector("td.table-price.platform-pc-only .price")?.textContent?.trim() || null;

      // Main attrs
      const intText = (sel) => {
        const t = row.querySelector(sel)?.textContent?.trim();
        const n = t ? parseInt(t, 10) : NaN;
        return Number.isFinite(n) ? n : null;
      };
      const stats = {
        pac: intText("td.table-pace .table-key-stats, td.table-pace"),
        sho: intText("td.table-shooting .table-key-stats, td.table-shooting"),
        pas: intText("td.table-passing .table-key-stats, td.table-passing"),
        dri: intText("td.table-dribbling .table-key-stats, td.table-dribbling"),
        def: intText("td.table-defending .table-key-stats, td.table-defending"),
        phy: intText("td.table-physicality .table-key-stats, td.table-physicality"),
      };
      const weakFoot = intText("td.table-weak-foot");
      const skillMoves = intText("td.table-skills");
      const popularityText = row.querySelector("td.table-popularity")?.textContent?.trim();
      const popularity = popularityText ? parseInt(popularityText.replace(/[^\d]/g, ""), 10) : null;

      // Futbin meta-rating ("95.1" tier tag)
      const metaTag = row.querySelector(".futbin-rating-tag")?.textContent?.trim() || null;

      // Player portrait — specials use .playercard-26-special-img, normals
      // use .playercard-26 img[alt]; fallback to any <img> whose src points
      // at the /img/players/ path. Matches the broadened selector shipped
      // in 86e4aba across the other scrapers.
      const cardImgEl =
        row.querySelector(".playercard-26 img[alt]:not([alt=''])") ||
        row.querySelector(".playercard-26-special-img") ||
        row.querySelector("img[src*='/img/players/']");
      const cardImageUrl = cardImgEl?.getAttribute("src") || null;

      // Card frame — class-based selectors first, then fall back to any
      // <img> whose src hits the /img/cards/tiny/ Futbin CDN path. The
      // class-only selector used here pre-86e4aba missed silvers/bronzes
      // (different class). Keeps parity with _scrape_futbin_new.js +
      // _scrape_futbin_parallel.js.
      const bgCandidates = [
        row.querySelector("img.playercard-s-26-bg"),
        row.querySelector(".playercard-s-26-bg img"),
        row.querySelector("img[src*='/img/cards/tiny/']"),
        row.querySelector("img[src*='/img/cards/']"),
      ].filter(Boolean);
      let cardBgSrc = "";
      for (const el of bgCandidates) {
        const s = el.getAttribute("src") || el.getAttribute("data-src") || "";
        if (s) { cardBgSrc = s; break; }
      }
      // Variant pattern: /cards/tiny/5_toty.png → "5-toty". Same regex
      // the other scrapers use — accept png/webp/jpg.
      const variantM = cardBgSrc.match(/\/cards\/[^/]+\/([^.?]+)\.(?:png|webp|jpg)/i);
      const variant = variantM ? variantM[1].replace(/_/g, "-") : null;

      // Position — Futbin list page sometimes lacks a dedicated position column.
      // When present it's under td.table-position or inside the card's alt-pos row.
      const positionText = row.querySelector("td.table-position, .table-position-pos, .playercard-s-26-pos")?.textContent?.trim() || null;

      // Nation + club from icon <img alt>
      const nationImg = row.querySelector("img[alt='Nation']");
      const clubImg = row.querySelector("img[alt='Club'], img[alt*='Club']");
      // Futbin stores nation/club names on the card anchor title attribute in some views — fall back blank.

      // Futbin-internal IDs — CDN icons are keyed by Futbin's internal
      // registry. Capture the ID from the path; names are resolved via
      // a separate mapping (Nigeria check keys off nation_id).
      const nationIconEl = row.querySelector("img.nation, img[src*='/img/nation/']");
      const leagueIconEl = row.querySelector("img[src*='/img/league/']");
      const clubIconEl = row.querySelector("img[src*='/img/clubs/']");
      const pathId = (src) => {
        const m = (src || "").match(/\/img\/(?:nation|league|clubs)\/(?:dark\/|light\/)?(\d+)\.(?:png|webp|jpg)/i);
        return m ? parseInt(m[1], 10) : null;
      };
      const nationId = pathId(nationIconEl?.getAttribute("src"));
      const leagueId = pathId(leagueIconEl?.getAttribute("src"));
      const clubId = pathId(clubIconEl?.getAttribute("src"));

      if (!name || !rating) continue;
      out.push({
        resourceId,
        slug,
        name,
        rating,
        position: positionText,
        variant,
        pricePs,
        pricePc,
        stats,
        weakFoot,
        skillMoves,
        popularity,
        metaTag,
        cardImageUrl,
        cardBgUrl: cardBgSrc || null,
        nationImg: nationImg?.getAttribute("src") || null,
        clubImg: clubImg?.getAttribute("src") || null,
        nationId,
        leagueId,
        clubId,
      });
    }

    // Discover total pages
    const pagers = Array.from(document.querySelectorAll("a[href*='?page='], a[href*='/page/']"))
      .map((a) => { const m = (a.getAttribute("href") || "").match(/page[=/](\d+)/); return m ? parseInt(m[1], 10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

async function upsertRows(sb, rows, stats, inserted, unmatched) {
  for (const r of rows) {
    const coinsPs = parseCoins(r.pricePs);
    const coinsPc = parseCoins(r.pricePc);
    const coins = coinsPs || coinsPc;
    if (!coins) { stats.noPrice++; continue; }
    const normalizedSlug = slugify(r.name);
    const sourceRowId = `futbin_${r.resourceId}`;

    const { data: exist } = await sb
      .from("fc26_players")
      .select("id, attributes, item_type")
      .eq("source_dataset", "futbin.com")
      .eq("source_row_id", sourceRowId)
      .is("deleted_at", null)
      .maybeSingle();

    const attrs = exist?.attributes && typeof exist.attributes === "object" ? { ...exist.attributes } : {};
    attrs.price_source = "futbin_live";
    attrs.price_snapshot_at = new Date().toISOString();
    attrs.futbin_resource_id = r.resourceId;
    attrs.futbin_variant = r.variant || "normal";
    attrs.platform_prices = { ps: coinsPs, pc: coinsPc };
    if (r.stats) attrs.mains = r.stats;
    if (r.weakFoot != null) attrs.weak_foot = r.weakFoot;
    if (r.skillMoves != null) attrs.skill_moves = r.skillMoves;
    if (r.popularity != null) attrs.popularity = r.popularity;
    if (r.metaTag) attrs.futbin_meta_rating = r.metaTag;
    if (r.cardImageUrl) attrs.card_image_url = r.cardImageUrl.startsWith("http") ? r.cardImageUrl : `https://www.futbin.com${r.cardImageUrl}`;
    if (r.cardBgUrl) attrs.card_bg_url = r.cardBgUrl.startsWith("http") ? r.cardBgUrl : `https://www.futbin.com${r.cardBgUrl}`;
    // Futbin-internal IDs (nation / league / club). Keyed by Futbin's
    // private registry — names resolved via a separate mapping.
    if (r.nationId != null) attrs.futbin_nation_id = r.nationId;
    if (r.leagueId != null) attrs.futbin_league_id = r.leagueId;
    if (r.clubId != null) attrs.futbin_club_id = r.clubId;

    // item_type bucket from variant string.
    const vLower = (r.variant || "").toLowerCase();
    let itemType = "normal";
    if (/\bicon\b/.test(vLower)) itemType = "icon";
    else if (/\btoty\b/.test(vLower)) itemType = "toty";
    else if (/\btots\b|team-of-the-season/.test(vLower)) itemType = "tots";
    else if (/\btotw\b|\bin-form\b|\bif\b/.test(vLower)) itemType = "totw";
    else if (/\bhero(es)?\b/.test(vLower)) itemType = "hero";
    else if (/\brttf\b|road-to/.test(vLower)) itemType = "rttf";
    else if (!/^(\d+-)?(gold|silver|bronze|rare|common|normal)$/.test(vLower)) itemType = "special";

    if (exist) {
      await sb.from("fc26_players")
        .update({ value_coins_estimate: coins, item_type: itemType, attributes: attrs, updated_at: new Date().toISOString() })
        .eq("id", exist.id);
      stats.updated++;
    } else {
      // Always insert as its own futbin.com row. No slug+rating merge —
      // Futbin is the source of truth; Kaggle/fut.gg rows stay untouched.
      await sb.from("fc26_players").insert({
        source_dataset: "futbin.com",
        source_row_id: sourceRowId,
        name: r.name,
        slug: normalizedSlug,
        rating: r.rating,
        position: r.position || "ST",
        item_type: itemType,
        value_coins_estimate: coins,
        attributes: attrs,
      });
      inserted.push({ name: r.name, rating: r.rating, variant: r.variant });
      stats.inserted++;
    }
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? { lastPage: 0 } : loadState();
  const stats = { pages: 0, rows: 0, updated: 0, inserted: 0, noPrice: 0 };
  const inserted = [];
  const unmatched = [];

  console.log("[headful] launching visible Chromium. If Cloudflare shows a challenge, click through.");
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  console.log("[headful] navigating to Futbin home for Cloudflare warmup...");
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.goto(LIST_URL(Math.max(1, state.lastPage + 1)), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(10000);

  console.log("");
  console.log("=============================================================");
  console.log("  Look at the browser window. Is the player list visible?");
  console.log("  - If YES (you see cards / table with prices) → press ENTER.");
  console.log("  - If NO (Cloudflare challenge showing) → solve it, then ENTER.");
  console.log("=============================================================");
  await waitForEnter("Press ENTER when ready: ");

  // Probe the current page to confirm list is visible.
  const { rows: probeRows, maxPage } = await extractListPage(page);
  if (probeRows.length === 0) {
    const html = await page.content();
    fs.writeFileSync(DEBUG_HTML_PATH, html);
    console.error(`[headful] still 0 rows after manual gate. HTML dumped to ${DEBUG_HTML_PATH}. Share this file for selector fix.`);
    await browser.close();
    process.exit(1);
  }

  console.log(`[headful] OK, ${probeRows.length} rows on current page. Total pages ≈ ${maxPage || "unknown"}.`);
  await upsertRows(sb, probeRows, stats, inserted, unmatched);
  state.lastPage = Math.max(1, state.lastPage + 1);
  stats.pages++; stats.rows += probeRows.length;
  saveState(state);

  const totalPages = maxPage || 600;
  // Retry-on-failure: every page keeps retrying until it returns ≥1 row OR
  // we've concluded "catalogue end" (≥3 consecutive zero-row pages).
  let consecutiveZero = 0;
  for (let p = state.lastPage + 1; p <= totalPages; p++) {
    await sleep(jitter());
    let attempt = 0;
    let succeeded = false;
    let pageRows = [];
    while (!succeeded) {
      attempt++;
      try {
        await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3500);
        const { rows } = await extractListPage(page);
        pageRows = rows;
        succeeded = true;
      } catch (e) {
        const backoff = Math.min(300000, 10000 * attempt); // 10s, 20s, 30s, ... cap 5min
        console.error(`[err] p${p} attempt ${attempt}: ${e.message} — retrying in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
    if (pageRows.length === 0) {
      consecutiveZero++;
      console.log(`[headful] p${p}: 0 rows (${consecutiveZero}/3)`);
      if (consecutiveZero >= 3) { console.log(`[headful] catalogue end at p${p}`); break; }
      continue;
    }
    consecutiveZero = 0;
    stats.pages++; stats.rows += pageRows.length;
    await upsertRows(sb, pageRows, stats, inserted, unmatched);
    state.lastPage = p;
    if (p % 10 === 0) saveState(state);
    if (p % 5 === 0 || p < 5) {
      console.log(`[headful] p${p}/${totalPages}: +${pageRows.length} | upd=${stats.updated} ins=${stats.inserted} np=${stats.noPrice}`);
    }
  }

  saveState(state);
  fs.writeFileSync(INSERTED_PATH, JSON.stringify(inserted, null, 2));
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2));
  console.log("[headful] done:", stats);
  console.log("[headful] You can close the browser window now.");
  await browser.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
