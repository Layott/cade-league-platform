#!/usr/bin/env node
// Reverse Futbin scraper — walks pages backward from --start-page.
// Runs in parallel to the forward scrape to halve total wall time.
// Uses a separate state file + separate Chromium profile dir so it
// doesn't fight with the forward run.
//
// Usage (in a NEW terminal, Sharp VPN on):
//   node KNOWLEDGE/extracted/_scrape_futbin_reverse.js --start-page 803
//
// Add `--floor N` to stop at page N (default 1).
// Add `--reset` to wipe reverse state + start over.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile_reverse");
const STATE_PATH = path.resolve(__dirname, "futbin_reverse_state.json");
const INSERTED_PATH = path.resolve(__dirname, "futbin_reverse_inserted.json");
const LIST_URL = (p) => `https://www.futbin.com/26/players?page=${p}`;
const HOME_URL = "https://www.futbin.com/";
const DELAY_MIN = 3000;
const DELAY_JIT = 2500;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { lastPage: null }; } };
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

function waitEnter(prompt) {
  return new Promise((r) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); r(); });
  });
}

async function extract(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.player-row"));
    const out = [];
    for (const row of rows) {
      const cardAnchor = row.querySelector("a.player-row-playercard, a[href*='/26/player/']");
      const hrefM = (cardAnchor?.getAttribute("href") || "").match(/\/26\/player\/(\d+)\/([^/?#]+)/);
      if (!hrefM) continue;
      const name = row.querySelector("a.table-player-name")?.textContent?.trim() || null;
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
      const cardImgEl = row.querySelector(".playercard-26 img[alt]:not([alt=''])");
      const cardBgSrc = row.querySelector("img.playercard-s-26-bg")?.getAttribute("src") || "";
      const variantM = cardBgSrc.match(/\/cards\/[^/]+\/([^.?]+)\.(?:png|webp)/i);
      out.push({
        resourceId: hrefM[1], slug: hrefM[2], name, rating,
        position: row.querySelector("td.table-position, .playercard-s-26-pos")?.textContent?.trim() || null,
        variant: variantM ? variantM[1].replace(/_/g, "-") : null,
        pricePs, pricePc, stats,
        weakFoot: intText("td.table-weak-foot"),
        skillMoves: intText("td.table-skills"),
        metaTag: row.querySelector(".futbin-rating-tag")?.textContent?.trim() || null,
        cardImageUrl: cardImgEl?.getAttribute("src") || null,
        cardBgUrl: cardBgSrc || null,
      });
    }
    return out;
  });
}

async function upsert(sb, rows, stats, inserted) {
  for (const r of rows) {
    const coinsPs = parseCoins(r.pricePs);
    const coinsPc = parseCoins(r.pricePc);
    const coins = coinsPs || coinsPc;
    if (!coins) { stats.noPrice++; continue; }
    const slug = slugify(r.name);
    const sourceRowId = `futbin_${r.resourceId}`;
    const { data: exist } = await sb.from("fc26_players")
      .select("id, attributes")
      .eq("source_dataset", "futbin.com").eq("source_row_id", sourceRowId)
      .is("deleted_at", null).maybeSingle();
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
    const v = (r.variant || "").toLowerCase();
    let itemType = "normal";
    if (/\bicon\b/.test(v)) itemType = "icon";
    else if (/\btoty\b/.test(v)) itemType = "toty";
    else if (/\btots\b|team-of-the-season/.test(v)) itemType = "tots";
    else if (/\btotw\b|\bin-form\b|\bif\b/.test(v)) itemType = "totw";
    else if (/\bhero(es)?\b/.test(v)) itemType = "hero";
    else if (/\brttf\b|road-to/.test(v)) itemType = "rttf";
    else if (!/^(\d+-)?(gold|silver|bronze|rare|common|normal)$/.test(v)) itemType = "special";
    if (exist) {
      await sb.from("fc26_players").update({ value_coins_estimate: coins, item_type: itemType, attributes: attrs, updated_at: new Date().toISOString() }).eq("id", exist.id);
      stats.updated++;
    } else {
      // Always insert as its own futbin.com row. No Kaggle merge.
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

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const startArg = process.argv.indexOf("--start-page");
  const floorArg = process.argv.indexOf("--floor");
  const startDefault = 800;
  const startPage = startArg >= 0 ? parseInt(process.argv[startArg + 1], 10) : startDefault;
  const floor = floorArg >= 0 ? parseInt(process.argv[floorArg + 1], 10) : 1;
  if (!Number.isFinite(startPage) || startPage < 1) { console.error("bad --start-page"); process.exit(1); }

  const state = process.argv.includes("--reset") ? { lastPage: startPage + 1 } : loadState();
  if (!state.lastPage) state.lastPage = startPage + 1;

  const stats = { pages: 0, rows: 0, updated: 0, inserted: 0, noPrice: 0 };
  const inserted = [];

  console.log(`[reverse] starting from p${state.lastPage - 1} down to p${floor}.`);
  console.log("[reverse] launching visible Chromium — solve Cloudflare if it shows, then press ENTER.");

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 50,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.goto(LIST_URL(state.lastPage - 1), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(10000);

  console.log("\n=============================================================");
  console.log(`  Browser on Futbin page ${state.lastPage - 1}?`);
  console.log("  YES (list visible) → ENTER");
  console.log("  NO (CF challenge)  → solve, then ENTER");
  console.log("=============================================================");
  await waitEnter("ready: ");

  let consecutiveZero = 0;
  for (let p = state.lastPage - 1; p >= floor; p--) {
    await sleep(jitter());
    let attempt = 0;
    let pageRows = null;
    while (pageRows === null) {
      attempt++;
      try {
        await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3500);
        pageRows = await extract(page);
      } catch (e) {
        const backoff = Math.min(300000, 10000 * attempt);
        console.error(`[err] p${p} attempt ${attempt}: ${e.message} — retry in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
    if (pageRows.length === 0) {
      consecutiveZero++;
      console.log(`[reverse] p${p}: 0 rows (${consecutiveZero}/3)`);
      if (consecutiveZero >= 3) { console.log(`[reverse] hit floor/empty range at p${p}`); break; }
      continue;
    }
    consecutiveZero = 0;
    stats.pages++; stats.rows += pageRows.length;
    await upsert(sb, pageRows, stats, inserted);
    state.lastPage = p;
    if (p % 10 === 0) saveState(state);
    if (p % 5 === 0) {
      console.log(`[reverse] p${p}: +${pageRows.length} | upd=${stats.updated} ins=${stats.inserted} np=${stats.noPrice}`);
    }
  }

  saveState(state);
  fs.writeFileSync(INSERTED_PATH, JSON.stringify(inserted, null, 2));
  console.log("[reverse] done:", stats);
  await ctx.close();
}
main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
