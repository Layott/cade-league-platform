#!/usr/bin/env node
// Fast delta scraper — Futbin's "latest released" page only.
//
// https://www.futbin.com/26/latest-released-players
//
// Use this when you just want to catch new promos / SBCs / drops since
// last run. Walks first N pages of the newest-first list, diff-upserts,
// stops after 2 consecutive pages that are 100% unchanged (caught up).
//
// Usage:
//   node KNOWLEDGE/extracted/_scrape_futbin_new.js
//   node KNOWLEDGE/extracted/_scrape_futbin_new.js --max-pages 20
//
// Prereq: _scrape_futbin_headful.js has warmed the Chromium profile at
// .futbin_chromium_profile/. Same CF-gate pattern.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { diffUpsertFutbinRow } = require("./_lib_diff_upsert");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const LIST_URL = (p) => `https://www.futbin.com/26/latest-released-players?page=${p}`;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const stripD = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const slugify = (n) => stripD(n || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 2500 + Math.floor(Math.random() * 2000);

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
      });
    }
    return out;
  });
}

async function main() {
  loadEnv();
  const maxArg = process.argv.indexOf("--max-pages");
  const maxPages = maxArg >= 0 ? parseInt(process.argv[maxArg + 1], 10) : 30;

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  if (!fs.existsSync(PROFILE_DIR)) { console.error("run headful scraper first to warm profile"); process.exit(1); }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, slowMo: 50,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();

  // Warm + first probe.
  await page.goto("https://www.futbin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.goto(LIST_URL(1), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(10000);

  let probeRows = await extract(page);
  if (probeRows.length === 0) {
    const readline = require("readline");
    console.log("\n=== Cloudflare challenge? Solve in window + press ENTER ===");
    await new Promise((r) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("ready: ", () => { rl.close(); r(); });
    });
    probeRows = await extract(page);
  }

  const stats = { pages: 0, rows: 0, inserted: 0, updated: 0, unchanged: 0, noPrice: 0 };
  const inserted = [];
  const updates = [];
  let consecutiveAllUnchanged = 0;

  async function processPage(pageRows, pageNum) {
    let pUnchanged = 0, pUpdated = 0, pInserted = 0;
    for (const r of pageRows) {
      const coinsPs = parseCoins(r.pricePs);
      const coinsPc = parseCoins(r.pricePc);
      const slug = slugify(r.name);
      const { status, diff } = await diffUpsertFutbinRow(sb, r, coinsPs, coinsPc, slug, stats);
      if (status === "unchanged") pUnchanged++;
      else if (status === "updated") { pUpdated++; updates.push({ name: r.name, rating: r.rating, diff }); }
      else if (status === "inserted") { pInserted++; inserted.push({ name: r.name, rating: r.rating, variant: r.variant }); }
    }
    console.log(`[new] p${pageNum}: ${pInserted} new  ${pUpdated} changed  ${pUnchanged} unchanged  (${pageRows.length} total)`);
    return pInserted + pUpdated === 0;
  }

  const firstAllUnchanged = await processPage(probeRows, 1);
  stats.pages = 1; stats.rows = probeRows.length;
  if (firstAllUnchanged) consecutiveAllUnchanged++;

  for (let p = 2; p <= maxPages; p++) {
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
    if (pageRows.length === 0) { console.log(`[new] p${p}: 0 rows — end of list`); break; }
    const allUnchanged = await processPage(pageRows, p);
    stats.pages++; stats.rows += pageRows.length;
    if (allUnchanged) {
      consecutiveAllUnchanged++;
      if (consecutiveAllUnchanged >= 2) {
        console.log(`[new] 2 consecutive unchanged pages — stopping (caught up).`);
        break;
      }
    } else {
      consecutiveAllUnchanged = 0;
    }
  }

  console.log("\n[new] done:", stats);
  if (inserted.length) console.log(`\n${inserted.length} new cards:`);
  for (const i of inserted) console.log(`  + r${i.rating}  ${i.name}  (${i.variant})`);
  if (updates.length) console.log(`\n${updates.length} updated cards:`);
  for (const u of updates.slice(0, 20)) console.log(`  ~ r${u.rating}  ${u.name}  [${u.diff.join(", ")}]`);
  if (updates.length > 20) console.log(`  ... (${updates.length - 20} more)`);

  fs.writeFileSync(path.resolve(__dirname, "futbin_new_inserted.json"), JSON.stringify(inserted, null, 2));
  fs.writeFileSync(path.resolve(__dirname, "futbin_new_updates.json"), JSON.stringify(updates, null, 2));
  await ctx.close();
}
main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
