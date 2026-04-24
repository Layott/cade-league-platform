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
// Futbin's official "latest added" feed. Newest cards first — ideal for
// a delta sweep. Diff-upsert + early-stop (2 consecutive all-unchanged
// pages) means we stop as soon as we've caught up to last run.
const LIST_URL = (p) => `https://www.futbin.com/latest?page=${p}`;

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
      // Player portrait — specials use .playercard-26-special-img, normals
      // use .playercard-26 img[alt]; fallback to any <img> whose src points
      // at the /players/ path.
      const cardImgEl =
        row.querySelector(".playercard-26 img[alt]:not([alt=''])") ||
        row.querySelector(".playercard-26-special-img") ||
        row.querySelector("img[src*='/img/players/']");

      // Card frame — broadest-fall path first targets the CDN URL directly
      // so we catch silver/bronze rows where Futbin doesn't use the
      // -bg classname.
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
      // Fallback: scan computed background-image on common wrappers.
      if (!cardBgSrc) {
        const wrap = row.querySelector(".playercard-26, .playercard-s-26, .playercard-s-26-bg");
        if (wrap) {
          const bg = getComputedStyle(wrap).backgroundImage;
          const m = bg && bg !== "none" ? bg.match(/url\(["']?([^"')]+)["']?\)/) : null;
          if (m) cardBgSrc = m[1];
        }
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
        // Kept for debug — show raw string even when the /cards/ regex misses.
        cardBgRaw: cardBgSrc || null,
        nationId: pathId(nationImg?.getAttribute("src")),
        leagueId: pathId(leagueImg?.getAttribute("src")),
        clubId: pathId(clubImg?.getAttribute("src")),
      });
    }
    return out;
  });
}

const STATE_PATH = path.resolve(__dirname, "futbin_new_state.json");

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
  catch { return { seenResourceIds: [], lastRunAt: null }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

async function main() {
  loadEnv();
  const maxArg = process.argv.indexOf("--max-pages");
  const maxPages = maxArg >= 0 ? parseInt(process.argv[maxArg + 1], 10) : 50;
  const reset = process.argv.includes("--reset");
  const state = reset ? { seenResourceIds: [], lastRunAt: null } : loadState();
  // Full seen-set from last run — used for per-page overlap check.
  // Back-compat: old state files used `lastTopResourceIds`.
  const horizonIds = new Set(state.seenResourceIds ?? state.lastTopResourceIds ?? []);
  if (horizonIds.size > 0) {
    console.log(`[new] horizon: ${horizonIds.size} resource_ids from last run (${state.lastRunAt})`);
  }
  // Stop when a page's overlap with the previous run's seen-set ≥ this %.
  const OVERLAP_STOP_PCT = 0.8;

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
  // Collect ALL resource_ids we encounter this run — becomes the horizon
  // for the NEXT run.
  const thisRunSeenIds = new Set();
  let stopReason = "";

  function recordIds(rows) {
    for (const r of rows) if (r.resourceId) thisRunSeenIds.add(String(r.resourceId));
  }

  function overlapPct(pageRows) {
    if (horizonIds.size === 0 || pageRows.length === 0) return 0;
    let hit = 0;
    for (const r of pageRows) if (horizonIds.has(String(r.resourceId))) hit++;
    return hit / pageRows.length;
  }

  async function processPage(pageRows, pageNum) {
    recordIds(pageRows);
    // Verbose debug on page 1 — show what the scraper actually saw for
    // the card-frame capture. Helps diagnose why FutCard renders a
    // black background when card_bg_url is still missing.
    if (pageNum === 1 && pageRows.length > 0) {
      console.log("\n[debug] first 5 rows of p1 — raw captures:");
      for (const r of pageRows.slice(0, 5)) {
        console.log(`  ${r.name.padEnd(35)} r${r.rating}  variant=${r.variant ?? "-"}`);
        console.log(`    portrait: ${r.cardImageUrl ?? "-"}`);
        console.log(`    bg raw:   ${r.cardBgRaw ?? "-"}`);
      }
      console.log();
    }
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
    const overlap = overlapPct(pageRows);
    const overlapLabel = horizonIds.size > 0
      ? `  overlap=${(overlap * 100).toFixed(0)}%`
      : "";
    console.log(`[new] p${pageNum}: ${pInserted} new  ${pUpdated} changed  ${pUnchanged} unchanged  (${pageRows.length} total)${overlapLabel}`);
    return overlap;
  }

  const firstOverlap = await processPage(probeRows, 1);
  stats.pages = 1; stats.rows = probeRows.length;

  if (firstOverlap >= OVERLAP_STOP_PCT) {
    stopReason = `page 1 overlap ${(firstOverlap * 100).toFixed(0)}% ≥ ${OVERLAP_STOP_PCT * 100}% — caught up immediately`;
  } else {
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
      if (pageRows.length === 0) { stopReason = `p${p} returned 0 rows — end of list`; break; }
      const overlap = await processPage(pageRows, p);
      stats.pages++; stats.rows += pageRows.length;
      if (overlap >= OVERLAP_STOP_PCT) {
        stopReason = `p${p} overlap ${(overlap * 100).toFixed(0)}% ≥ ${OVERLAP_STOP_PCT * 100}% — caught up`;
        break;
      }
    }
    if (!stopReason && stats.pages >= maxPages) {
      stopReason = `hit --max-pages=${maxPages}`;
    }
  }

  if (stopReason) console.log(`\n[new] stopped: ${stopReason}`);

  // Post-run DB audit — count futbin rows that now carry card_bg_url.
  // Helps confirm the hardened capture actually produced writeable URLs.
  try {
    const { count } = await sb
      .from("fc26_players")
      .select("*", { count: "exact", head: true })
      .eq("source_dataset", "futbin.com")
      .not("attributes->>card_bg_url", "is", null)
      .is("deleted_at", null);
    console.log(`[new] DB now has ${count} futbin rows with card_bg_url populated.`);
  } catch (e) {
    console.error(`[new] post-run audit failed: ${e.message}`);
  }

  // Persist the full seen-set so the NEXT run can compare against it.
  saveState({
    seenResourceIds: [...thisRunSeenIds],
    lastRunAt: new Date().toISOString(),
    lastStats: stats,
    lastStopReason: stopReason,
  });

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
