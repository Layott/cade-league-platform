#!/usr/bin/env node
// Futbin filter-band scraper — captures the ~12k cards that are absent
// from the default /26/players view. Iterates rating bands + promo-type
// filters so every bronze / silver / non-default-promo surfaces.
//
// Prereq: _scrape_futbin_headful.js has already warmed the persistent
// Chromium profile at .futbin_chromium_profile/. Re-uses the same
// extractor + upsert logic calibrated to the live EAFC 26 DOM.
//
// Usage (after main scrape finishes):
//   node KNOWLEDGE/extracted/_scrape_futbin_filters.js
//
// Resumable: futbin_filters_state.json tracks (band, page) completed.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const STATE_PATH = path.resolve(__dirname, "futbin_filters_state.json");
const INSERTED_PATH = path.resolve(__dirname, "futbin_filters_inserted.json");
const DELAY_MIN = 2500;
const DELAY_JIT = 2500;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { done: [] }; } };
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

// Filter bands. Futbin accepts rating_min + rating_max + version(s).
// We iterate rating bands across the full range AND iterate known promo
// versions. This catches specials (Icons, Heroes, TOTY/TOTS) Futbin
// hides from the default list, plus silvers/bronzes below the default
// cutoff.
const BANDS = [
  { key: "r95_99", q: "rating_min=95&rating_max=99" },
  { key: "r90_94", q: "rating_min=90&rating_max=94" },
  { key: "r85_89", q: "rating_min=85&rating_max=89" },
  { key: "r80_84", q: "rating_min=80&rating_max=84" },
  { key: "r75_79", q: "rating_min=75&rating_max=79" },
  { key: "r70_74", q: "rating_min=70&rating_max=74" },
  { key: "r65_69", q: "rating_min=65&rating_max=69" },
  { key: "r60_64", q: "rating_min=60&rating_max=64" },
  { key: "r55_59", q: "rating_min=55&rating_max=59" },
  { key: "r50_54", q: "rating_min=50&rating_max=54" },
  { key: "r45_49", q: "rating_min=45&rating_max=49" },
  // Promo versions — Futbin uses version[] multi-select. Try each.
  { key: "v_icon", q: "version=icon" },
  { key: "v_hero", q: "version=hero" },
  { key: "v_toty", q: "version=toty" },
  { key: "v_tots", q: "version=tots" },
  { key: "v_totw", q: "version=totw" },
  { key: "v_rttf", q: "version=rttf" },
  { key: "v_fb", q: "version=fut_birthday" },
];

const LIST_URL = (band, page) => `https://www.futbin.com/26/players?${band.q}&page=${page}`;

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
      const cardImgEl = row.querySelector(".playercard-26 img[alt]:not([alt=''])");
      const cardImageUrl = cardImgEl?.getAttribute("src") || null;
      const cardBgSrc = row.querySelector("img.playercard-s-26-bg")?.getAttribute("src") || "";
      const variantM = cardBgSrc.match(/\/cards\/[^/]+\/([^.?]+)\.(?:png|webp)/i);
      const variant = variantM ? variantM[1].replace(/_/g, "-") : null;
      const metaTag = row.querySelector(".futbin-rating-tag")?.textContent?.trim() || null;
      out.push({
        resourceId: hrefM[1], slug: hrefM[2], name, rating,
        position: row.querySelector("td.table-position, .playercard-s-26-pos")?.textContent?.trim() || null,
        variant, pricePs, pricePc, stats, weakFoot, skillMoves, metaTag, cardImageUrl,
      });
    }
    const pagers = Array.from(document.querySelectorAll("a[href*='page=']"))
      .map((a) => { const m = (a.getAttribute("href") || "").match(/page=(\d+)/); return m ? parseInt(m[1], 10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

async function upsertRows(sb, rows, stats, inserted) {
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
      await sb.from("fc26_players").update({ value_coins_estimate: coins, item_type: itemType, attributes: attrs, updated_at: new Date().toISOString() }).eq("id", exist.id);
      stats.updated++;
    } else {
      const { data: base } = await sb.from("fc26_players").select("id").eq("slug", slug).eq("rating", r.rating).is("deleted_at", null).limit(1);
      if (base && base.length > 0) {
        await sb.from("fc26_players").update({ value_coins_estimate: coins, attributes: attrs }).eq("id", base[0].id);
        stats.updated++;
      } else {
        await sb.from("fc26_players").insert({
          source_dataset: "futbin.com", source_row_id: sourceRowId,
          name: r.name, slug, rating: r.rating, position: r.position || "ST",
          item_type: itemType, value_coins_estimate: coins, attributes: attrs,
        });
        inserted.push({ name: r.name, rating: r.rating, variant: r.variant });
        stats.inserted++;
      }
    }
  }
}

async function scrapeBand(page, sb, band, state, stats, inserted) {
  if (state.done.includes(band.key)) {
    console.log(`[filters] ${band.key}: skipped (done)`);
    return;
  }
  let p = 1;
  let totalPages = null;
  let consecutiveZero = 0;
  while (true) {
    await sleep(jitter());
    let attempt = 0;
    let pageRows = null;
    let maxPageSeen = null;
    while (pageRows === null) {
      attempt++;
      try {
        await page.goto(LIST_URL(band, p), { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3000);
        const { rows, maxPage } = await extract(page);
        pageRows = rows;
        maxPageSeen = maxPage;
      } catch (e) {
        const backoff = Math.min(300000, 10000 * attempt);
        console.error(`[err] ${band.key} p${p} attempt ${attempt}: ${e.message} — retry in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
    if (p === 1 && maxPageSeen) totalPages = maxPageSeen;
    if (pageRows.length === 0) {
      consecutiveZero++;
      if (consecutiveZero >= 3) { console.log(`[${band.key}] p${p}: 0 rows — band end`); break; }
      p++;
      continue;
    }
    consecutiveZero = 0;
    stats.bandRows[band.key] = (stats.bandRows[band.key] || 0) + pageRows.length;
    await upsertRows(sb, pageRows, stats, inserted);
    if (p === 1 || p % 10 === 0) console.log(`[${band.key}] p${p}/${totalPages}: +${pageRows.length} | total upd=${stats.updated} ins=${stats.inserted}`);
    p++;
    if (totalPages && p > totalPages) break;
    if (p > 300) break;
  }
  state.done.push(band.key);
  saveState(state);
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? { done: [] } : loadState();
  if (!fs.existsSync(PROFILE_DIR)) {
    console.error("[filters] No Chromium profile — run headful first.");
    process.exit(1);
  }
  const stats = { bands: 0, updated: 0, inserted: 0, noPrice: 0, bandRows: {} };
  const inserted = [];
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();
  // Warm
  await page.goto("https://www.futbin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  for (const band of BANDS) {
    await scrapeBand(page, sb, band, state, stats, inserted);
    stats.bands++;
  }
  fs.writeFileSync(INSERTED_PATH, JSON.stringify(inserted, null, 2));
  console.log("[filters] done:", stats);
  await ctx.close();
}
main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
