#!/usr/bin/env node
// Parallel page-range scraper. Spawns N Chromium instances each with its
// own persistent profile and page window, slices the requested range
// across them, and writes upserts to fc26_players in parallel.
//
// Usage:
//   node KNOWLEDGE/extracted/_scrape_futbin_parallel.js --from 1 --to 40 --workers 4
//
// Profile layout: `.futbin_chromium_profile_p{N}/` (separate dir per
// worker). First time each worker runs you'll need to solve Cloudflare
// in ITS window once — subsequent runs reuse the cached clearance cookie
// from that worker's profile.
//
// Diff-aware upsert via _lib_diff_upsert — unchanged rows are skipped.
// ALL scrapers share the cloud Supabase project; writes are safe
// (Postgres handles concurrent upserts via the partial unique index).
//
// Safety: max 6 workers. Futbin's CF heuristics start tagging >6
// concurrent sessions from the same IP. If you need more cards covered
// faster, run one batch, then another — not wider concurrency.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { diffUpsertFutbinRow } = require("./_lib_diff_upsert");

const LIST_URL = (p) => `https://www.futbin.com/26/players?page=${p}`;
const MAX_WORKERS = 6;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
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
      // Player portrait — specials use .playercard-26-special-img, normals
      // use .playercard-26 img[alt]; fallback to any <img> whose src points
      // at the /players/ path.
      const cardImgEl =
        row.querySelector(".playercard-26 img[alt]:not([alt=''])") ||
        row.querySelector(".playercard-26-special-img") ||
        row.querySelector("img[src*='/img/players/']");
      // Card frame — try class-based selectors first, then fall back to
      // ANY img whose src hits the /cards/tiny/ Futbin CDN path. This
      // catches silver/bronze rows that Futbin renders with a different
      // class than gold+special.
      const bgCandidates = [
        row.querySelector("img.playercard-s-26-bg"),
        row.querySelector("img[src*='/img/cards/tiny/']"),
        row.querySelector("img[src*='/img/cards/']"),
      ].filter(Boolean);
      let cardBgSrc = "";
      for (const el of bgCandidates) {
        const s = el.getAttribute("src") || el.getAttribute("data-src") || "";
        if (s) { cardBgSrc = s; break; }
      }
      const variantM = cardBgSrc.match(/\/cards\/[^/]+\/([^.?]+)\.(?:png|webp|jpg)/i);
      // Futbin nation / league / club — IDs are Futbin-internal integers
      // embedded in the CDN icon path (e.g. /img/nation/18.png). No raw
      // ISO code is exposed on the list page, so we capture the ID here
      // and resolve to names via a separate mapping (see
      // _find_futbin_nation_id.js).
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
        variant: variantM ? variantM[1].replace(/_/g, "-") : null,
        pricePs, pricePc, stats,
        weakFoot: intText("td.table-weak-foot"),
        skillMoves: intText("td.table-skills"),
        metaTag: row.querySelector(".futbin-rating-tag")?.textContent?.trim() || null,
        cardImageUrl: cardImgEl?.getAttribute("src") || null,
        cardBgUrl: cardBgSrc || null,
        nationId: pathId(nationImg?.getAttribute("src")),
        leagueId: pathId(leagueImg?.getAttribute("src")),
        clubId: pathId(clubImg?.getAttribute("src")),
      });
    }
    return out;
  });
}

async function worker(workerId, fromPage, toPage, sb, sharedStats) {
  const profileDir = path.resolve(__dirname, `.futbin_chromium_profile_p${workerId}`);
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, slowMo: 50,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();

  console.log(`[w${workerId}] warming ${profileDir}`);
  await page.goto("https://www.futbin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.goto(LIST_URL(fromPage), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);

  let probeRows = await extract(page);
  if (probeRows.length === 0) {
    const readline = require("readline");
    console.log(`\n[w${workerId}] === Cloudflare? Solve in worker ${workerId} window + press ENTER ===`);
    await new Promise((r) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`w${workerId} ready: `, () => { rl.close(); r(); });
    });
    probeRows = await extract(page);
  }

  async function processPage(pageRows, pageNum) {
    let pU = 0, pUpd = 0, pIns = 0, pNc = 0;
    for (const r of pageRows) {
      const coinsPs = parseCoins(r.pricePs);
      const coinsPc = parseCoins(r.pricePc);
      const slug = slugify(r.name);
      const { status } = await diffUpsertFutbinRow(sb, r, coinsPs, coinsPc, slug, sharedStats);
      if (status === "unchanged") pU++;
      else if (status === "updated") pUpd++;
      else if (status === "inserted") pIns++;
      else if (status === "skipped") pNc++;
    }
    console.log(`[w${workerId}] p${pageNum}: +${pIns} new  ~${pUpd} changed  =${pU} unchanged  (no-price=${pNc})`);
  }

  await processPage(probeRows, fromPage);
  for (let p = fromPage + 1; p <= toPage; p++) {
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
        console.error(`[w${workerId}] err p${p} attempt ${attempt}: ${e.message} — retry in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
    if (pageRows.length === 0) { console.log(`[w${workerId}] p${p}: 0 rows — end of range`); break; }
    await processPage(pageRows, p);
  }
  await ctx.close();
  console.log(`[w${workerId}] done`);
}

async function main() {
  loadEnv();
  const fromArg = process.argv.indexOf("--from");
  const toArg = process.argv.indexOf("--to");
  const workersArg = process.argv.indexOf("--workers");
  if (fromArg < 0 || toArg < 0 || workersArg < 0) {
    console.error("usage: --from N --to M --workers K   (max workers = 6)");
    process.exit(1);
  }
  const from = parseInt(process.argv[fromArg + 1], 10);
  const to = parseInt(process.argv[toArg + 1], 10);
  const workers = Math.min(MAX_WORKERS, parseInt(process.argv[workersArg + 1], 10));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) { console.error("bad --from/--to"); process.exit(1); }
  if (!Number.isFinite(workers) || workers < 1) { console.error("bad --workers"); process.exit(1); }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Slice the page range across N workers.
  const totalPages = to - from + 1;
  const perWorker = Math.ceil(totalPages / workers);
  const slices = [];
  for (let i = 0; i < workers; i++) {
    const start = from + i * perWorker;
    const end = Math.min(to, start + perWorker - 1);
    if (start <= to) slices.push({ workerId: i + 1, from: start, to: end });
  }
  console.log(`Slicing p${from}..p${to} across ${slices.length} workers:`);
  for (const s of slices) console.log(`  w${s.workerId}: p${s.from}..p${s.to}`);
  console.log();

  const sharedStats = { pages: 0, rows: 0, inserted: 0, updated: 0, unchanged: 0, noPrice: 0 };
  await Promise.all(slices.map((s) => worker(s.workerId, s.from, s.to, sb, sharedStats)));

  console.log("\n[parallel] done:", sharedStats);
}
main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
