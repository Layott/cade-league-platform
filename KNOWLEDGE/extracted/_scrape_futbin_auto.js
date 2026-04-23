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
    let rows = Array.from(document.querySelectorAll("tr.player_tr_1, tr.player_tr_2"));
    if (rows.length === 0) rows = Array.from(document.querySelectorAll("table.players_table tbody tr, table#repTb tbody tr"));
    if (rows.length === 0) rows = Array.from(document.querySelectorAll("a[href*='/26/player/']"));
    const out = [];
    for (const row of rows) {
      const anchor = row.tagName === "A" ? row : row.querySelector("a[href*='/26/player/']");
      const href = anchor ? anchor.getAttribute("href") || "" : "";
      const hrefM = href.match(/\/26\/player\/(\d+)\/([^/?#]+)/);
      if (!hrefM) continue;
      const nameEl = row.querySelector(".player_name_players_table") || row.querySelector(".table-player-name") || row.querySelector("[class*='player-name']") || anchor;
      const name = nameEl ? (nameEl.getAttribute("data-original-title") || nameEl.textContent.trim()) : null;
      const ratingEl = row.querySelector(".pcdisplay-rat") || row.querySelector(".rating") || row.querySelector("[class*='rating']");
      const rating = ratingEl ? parseInt(ratingEl.textContent.trim(), 10) : null;
      const posEl = row.querySelector(".pcdisplay-pos") || row.querySelector(".position") || row.querySelector("[class*='pos']");
      const revEl = row.querySelector(".pcdisplay-rev") || row.querySelector(".revision") || row.querySelector("[class*='version']");
      const pricePsEl = row.querySelector(".platform-ps-only") || row.querySelector("[data-price-ps]") || row.querySelector("[class*='ps-price']");
      const pricePs = pricePsEl ? (pricePsEl.getAttribute("data-price-ps") || pricePsEl.getAttribute("data-price-num") || pricePsEl.textContent.trim()) : null;
      const imgEl = row.querySelector("img.playercard, img[src*='players_html'], img[src*='/card/']");
      if (!name || !rating) continue;
      out.push({
        resourceId: hrefM[1],
        slug: hrefM[2],
        name,
        rating,
        position: posEl ? posEl.textContent.trim() : null,
        variant: revEl ? revEl.textContent.trim() : null,
        pricePs,
        cardImageUrl: imgEl ? imgEl.getAttribute("src") : null,
      });
    }
    const pagers = Array.from(document.querySelectorAll("a[href*='?page=']"))
      .map((a) => { const m = (a.getAttribute("href") || "").match(/page=(\d+)/); return m ? parseInt(m[1], 10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

async function upsertRows(sb, rows, stats, newCards) {
  for (const r of rows) {
    const coins = parseCoins(r.pricePs);
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
    if (r.cardImageUrl) attrs.card_image_url = r.cardImageUrl.startsWith("http") ? r.cardImageUrl : `https://www.futbin.com${r.cardImageUrl}`;
    if (exist) {
      await sb.from("fc26_players").update({ value_coins_estimate: coins, attributes: attrs, updated_at: new Date().toISOString() }).eq("id", exist.id);
      stats.updated++;
    } else {
      const { data: base } = await sb.from("fc26_players")
        .select("id").eq("slug", slug).eq("rating", r.rating).is("deleted_at", null).limit(1);
      if (base && base.length > 0) {
        await sb.from("fc26_players").update({ value_coins_estimate: coins, attributes: attrs }).eq("id", base[0].id);
        stats.updated++;
      } else {
        await sb.from("fc26_players").insert({
          source_dataset: "futbin.com", source_row_id: sourceRowId,
          name: r.name, slug, rating: r.rating, position: r.position || "ST",
          item_type: r.variant ? "special" : "normal",
          value_coins_estimate: coins, attributes: attrs,
        });
        newCards.push({ name: r.name, rating: r.rating, variant: r.variant, resourceId: r.resourceId });
        stats.inserted++;
      }
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

  for (let p = state.lastPage + 1; p <= totalPages; p++) {
    await sleep(jitter());
    try {
      await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      const { rows } = await extract(page);
      if (rows.length === 0) { console.log(`[auto] p${p}: 0 rows — stopping.`); break; }
      stats.pages++; stats.rows += rows.length;
      await upsertRows(sb, rows, stats, newCards);
      state.lastPage = p;
      if (p % 10 === 0) saveState(state);
      if (p % 20 === 0 || p < 3) console.log(`[auto] p${p}/${totalPages}: upd=${stats.updated} ins=${stats.inserted} np=${stats.noPrice}`);
    } catch (e) {
      console.error(`[err] p${p}: ${e.message}`);
      await sleep(10000);
    }
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
