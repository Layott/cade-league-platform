#!/usr/bin/env node
// Futbin auto-refresh scraper.
//
// Design:
//   * Launches a PERSISTENT Chromium profile (`.futbin_chromium_profile/`
//     under KNOWLEDGE/extracted/). Cookies + localStorage survive across
//     runs, so once Cloudflare has trusted this profile the first time
//     (via the headful script), subsequent runs can proceed HEADLESS.
//   * Starts headless. Probes page 1 for player rows. If 0 rows OR
//     Cloudflare challenge detected, abort with a clear message asking
//     the user to run the headful script to re-warm the profile.
//   * On success, walks all pages, upserts prices + card images + variants
//     into fc26_players.
//   * Logs new-card inserts to KNOWLEDGE/extracted/futbin_auto_new.json —
//     the set of cards this run discovered that weren't in the DB yet
//     (icons / heroes / new promos / fresh EA drops).
//
// Usage:
//   node KNOWLEDGE/extracted/_scrape_futbin_auto.js [--reset]
//
// Schedule with Windows Task Scheduler — see TASK_SCHEDULER_SETUP.md.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const STATE_PATH = path.resolve(__dirname, "futbin_auto_state.json");
const NEW_CARDS_PATH = path.resolve(__dirname, "futbin_auto_new.json");
const RUN_LOG_PATH = path.resolve(__dirname, "futbin_auto_runlog.json");
const LIST_URL = (p) => `https://www.futbin.com/26/players?page=${p}`;
const HOME_URL = "https://www.futbin.com/";

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
const jitter = () => 2500 + Math.floor(Math.random() * 2500);

function parseCoins(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (/^(-|0|sbc|untradeable|n\/a|extinct)$/i.test(s)) return null;
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1));
}

async function extract(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.player-row"));
    const out = [];
    for (const row of rows) {
      const cardAnchor = row.querySelector("a.player-row-playercard, a[href*='/26/player/']");
      const href = cardAnchor?.getAttribute("href") || "";
      const hrefM = href.match(/\/26\/player\/(\d+)\/([^/?#]+)/);
      if (!hrefM) continue;
      const nameAnchor = row.querySelector("a.table-player-name");
      const name = nameAnchor?.textContent?.trim() || row.querySelector("[title]")?.getAttribute("title")?.trim() || null;
      const ratingText = row.querySelector("td.table-rating .rating-square, td.table-rating")?.textContent?.trim();
      const rating = ratingText ? parseInt(ratingText, 10) : null;
      if (!name || !rating) continue;
      const pricePs = row.querySelector("td.table-price.platform-ps-only .price")?.textContent?.trim() || null;
      const pricePc = row.querySelector("td.table-price.platform-pc-only .price")?.textContent?.trim() || null;
      const intText = (sel) => { const t = row.querySelector(sel)?.textContent?.trim(); const n = t ? parseInt(t, 10) : NaN; return Number.isFinite(n) ? n : null; };
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
      // Broadened selectors match the parallel + delta + headful scrapers
      // (86e4aba + this commit). Class-only misses silvers + bronzes.
      const cardImgEl =
        row.querySelector(".playercard-26 img[alt]:not([alt=''])") ||
        row.querySelector(".playercard-26-special-img") ||
        row.querySelector("img[src*='/img/players/']");
      const cardImageUrl = cardImgEl?.getAttribute("src") || null;
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
      const variantM = cardBgSrc.match(/\/cards\/[^/]+\/([^.?]+)\.(?:png|webp|jpg)/i);
      const variant = variantM ? variantM[1].replace(/_/g, "-") : null;
      const metaTag = row.querySelector(".futbin-rating-tag")?.textContent?.trim() || null;
      // Futbin-internal nation / league / club IDs — parsed from the
      // CDN icon URLs since the list page doesn't expose raw ISO codes.
      const nationImg = row.querySelector("img.nation, img[src*='/img/nation/']");
      const leagueImg = row.querySelector("img[src*='/img/league/']");
      const clubImg = row.querySelector("img[src*='/img/clubs/']");
      const pathId = (src) => {
        const m = (src || "").match(/\/img\/(?:nation|league|clubs)\/(?:dark\/|light\/)?(\d+)\.(?:png|webp|jpg)/i);
        return m ? parseInt(m[1], 10) : null;
      };
      out.push({
        resourceId: hrefM[1], slug: hrefM[2], name, rating,
        position: row.querySelector("td.table-position, .playercard-s-26-pos")?.textContent?.trim() || null,
        variant, pricePs, pricePc, stats, weakFoot, skillMoves, metaTag, cardImageUrl,
        cardBgUrl: cardBgSrc || null,
        nationId: pathId(nationImg?.getAttribute("src")),
        leagueId: pathId(leagueImg?.getAttribute("src")),
        clubId: pathId(clubImg?.getAttribute("src")),
      });
    }
    const pagers = Array.from(document.querySelectorAll("a[href*='?page=']"))
      .map((a) => { const m = (a.getAttribute("href") || "").match(/page=(\d+)/); return m ? parseInt(m[1], 10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

async function upsertRows(sb, rows, stats, newCards) {
  for (const r of rows) {
    const coinsPs = parseCoins(r.pricePs);
    const coinsPc = parseCoins(r.pricePc);
    const coins = coinsPs || coinsPc;
    if (!coins) { stats.noPrice++; continue; }
    const slug = slugify(r.name);
    const sourceRowId = `futbin_${r.resourceId}`;
    const { data: exist } = await sb.from("fc26_players")
      .select("id, attributes")
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
    if (r.metaTag) attrs.futbin_meta_rating = r.metaTag;
    if (r.cardImageUrl) attrs.card_image_url = r.cardImageUrl.startsWith("http") ? r.cardImageUrl : `https://www.futbin.com${r.cardImageUrl}`;
    if (r.cardBgUrl) attrs.card_bg_url = r.cardBgUrl.startsWith("http") ? r.cardBgUrl : `https://www.futbin.com${r.cardBgUrl}`;
    // Futbin-internal IDs — capture for Nigerian-check / league filters.
    if (r.nationId != null) attrs.futbin_nation_id = r.nationId;
    if (r.leagueId != null) attrs.futbin_league_id = r.leagueId;
    if (r.clubId != null) attrs.futbin_club_id = r.clubId;
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
      // 2026-05-10 — RTTF / TOTW / SBC / live-promo cards have MUTABLE
      // ratings + positions on Futbin. RTTF cards advance as the team
      // progresses (Eberechi Eze RTTF bumped 91 → 93 after Arsenal's
      // UCL run; pre-fix update only wrote price+attributes so the
      // bumped rating never landed in DB). Forward rating + position
      // on the update path so live-mutating cards stay in sync.
      const updatePayload = {
        rating: r.rating,
        position: r.position || "ST",
        value_coins_estimate: coins,
        item_type: itemType,
        attributes: attrs,
        updated_at: new Date().toISOString(),
      };
      await sb.from("fc26_players").update(updatePayload).eq("id", exist.id);
      stats.updated++;
    } else {
      // Always insert as its own futbin.com row. No Kaggle merge.
      await sb.from("fc26_players").insert({
        source_dataset: "futbin.com", source_row_id: sourceRowId,
        name: r.name, slug, rating: r.rating, position: r.position || "ST",
        item_type: itemType,
        value_coins_estimate: coins, attributes: attrs,
      });
      newCards.push({ name: r.name, rating: r.rating, variant: r.variant, resourceId: r.resourceId });
      stats.inserted++;
    }
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? { lastPage: 0 } : loadState();
  const stats = { pages: 0, rows: 0, updated: 0, inserted: 0, noPrice: 0, startedAt: new Date().toISOString() };
  const newCards = [];

  if (!fs.existsSync(PROFILE_DIR)) {
    console.error("[auto] Profile dir missing. Run the headful script first to warm Cloudflare:");
    console.error("       node KNOWLEDGE/extracted/_scrape_futbin_headful.js");
    process.exit(1);
  }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();

  // Warm + probe
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.goto(LIST_URL(1), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  const probe = await extract(page);
  if (probe.rows.length === 0) {
    console.error("[auto] page 1 returned 0 rows — persistent profile's Cloudflare clearance expired.");
    console.error("       Run the headful script to refresh: node KNOWLEDGE/extracted/_scrape_futbin_headful.js");
    await ctx.close();
    process.exit(2);
  }

  const totalPages = probe.maxPage || 600;
  console.log(`[auto] probe OK. ${probe.rows.length} rows on p1. total≈${totalPages}.`);
  await upsertRows(sb, probe.rows, stats, newCards);
  stats.pages = 1; stats.rows = probe.rows.length;
  state.lastPage = 1; saveState(state);

  let consecutiveZero = 0;
  for (let p = state.lastPage + 1; p <= totalPages; p++) {
    await sleep(jitter());
    let attempt = 0;
    let pageRows = null;
    while (pageRows === null) {
      attempt++;
      try {
        await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3500);
        const { rows } = await extract(page);
        pageRows = rows;
      } catch (e) {
        const backoff = Math.min(300000, 10000 * attempt);
        console.error(`[err] p${p} attempt ${attempt}: ${e.message} — retry in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
    if (pageRows.length === 0) {
      consecutiveZero++;
      if (consecutiveZero >= 3) { console.log(`[auto] catalogue end at p${p}`); break; }
      continue;
    }
    consecutiveZero = 0;
    stats.pages++; stats.rows += pageRows.length;
    await upsertRows(sb, pageRows, stats, newCards);
    state.lastPage = p;
    if (p % 10 === 0) saveState(state);
    if (p % 20 === 0 || p < 3) console.log(`[auto] p${p}/${totalPages}: upd=${stats.updated} ins=${stats.inserted} np=${stats.noPrice}`);
  }

  state.lastPage = 0; saveState(state); // reset for next nightly run
  stats.finishedAt = new Date().toISOString();
  fs.writeFileSync(NEW_CARDS_PATH, JSON.stringify(newCards, null, 2));
  // Append run log for monitoring
  let runlog = [];
  try { runlog = JSON.parse(fs.readFileSync(RUN_LOG_PATH, "utf8")); } catch {}
  runlog.push(stats);
  fs.writeFileSync(RUN_LOG_PATH, JSON.stringify(runlog.slice(-60), null, 2));
  console.log("[auto] done:", stats);
  console.log(`[auto] new cards inserted: ${newCards.length} → ${NEW_CARDS_PATH}`);
  await ctx.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
