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

// Selector-tolerant extraction — tries several paths Futbin has used
// across the EAFC 26 redesign to future-proof.
async function extractListPage(page) {
  return page.evaluate(() => {
    // Approach 1 — classic <tr class="player_tr_1|2"> layout
    let rows = Array.from(document.querySelectorAll("tr.player_tr_1, tr.player_tr_2"));
    // Approach 2 — generic tbody tr inside players_table / #repTb
    if (rows.length === 0) {
      rows = Array.from(document.querySelectorAll("table.players_table tbody tr, table#repTb tbody tr"));
    }
    // Approach 3 — modern card-grid (data-card-info / player-anchor based)
    if (rows.length === 0) {
      rows = Array.from(document.querySelectorAll("a[href*='/26/player/']"));
    }

    const out = [];
    for (const row of rows) {
      // href
      const anchor = row.tagName === "A" ? row : row.querySelector("a[href*='/26/player/']");
      const href = anchor ? anchor.getAttribute("href") || "" : "";
      const hrefM = href.match(/\/26\/player\/(\d+)\/([^/?#]+)/);
      const resourceId = hrefM ? hrefM[1] : null;
      const slug = hrefM ? hrefM[2] : null;

      // name
      const nameEl =
        row.querySelector(".player_name_players_table") ||
        row.querySelector(".table-player-name") ||
        row.querySelector("[class*='player-name']") ||
        anchor;
      const name = nameEl ? (nameEl.getAttribute("data-original-title") || nameEl.textContent.trim()) : null;

      // rating
      const ratingEl =
        row.querySelector(".pcdisplay-rat") ||
        row.querySelector(".rating") ||
        row.querySelector("[class*='rating']");
      const rating = ratingEl ? parseInt(ratingEl.textContent.trim(), 10) : null;

      // position
      const posEl =
        row.querySelector(".pcdisplay-pos") ||
        row.querySelector(".position") ||
        row.querySelector("[class*='pos']");
      const position = posEl ? posEl.textContent.trim() : null;

      // revision / variant
      const revEl =
        row.querySelector(".pcdisplay-rev") ||
        row.querySelector(".revision") ||
        row.querySelector("[class*='version']");
      const variant = revEl ? revEl.textContent.trim() : null;

      // price PS
      const pricePsEl =
        row.querySelector(".platform-ps-only") ||
        row.querySelector("[data-price-ps]") ||
        row.querySelector("[class*='ps-price']");
      let pricePs = null;
      if (pricePsEl) {
        pricePs = pricePsEl.getAttribute("data-price-ps") || pricePsEl.getAttribute("data-price-num") || pricePsEl.textContent.trim();
      }

      // card image
      const imgEl = row.querySelector("img.playercard, img[src*='players_html'], img[src*='/card/']");
      const cardImageUrl = imgEl ? imgEl.getAttribute("src") : null;

      // nation, club
      const nationEl = row.querySelector("[class*='nation']");
      const clubEl = row.querySelector("[class*='club']");

      if (resourceId && name && rating) {
        out.push({
          resourceId,
          slug,
          name,
          rating,
          position,
          variant,
          pricePs,
          cardImageUrl,
          nation: nationEl ? nationEl.textContent.trim() || nationEl.getAttribute("title") : null,
          club: clubEl ? clubEl.textContent.trim() || clubEl.getAttribute("title") : null,
        });
      }
    }

    // Discover total pages
    const pagers = Array.from(document.querySelectorAll("a[href*='?page='], a[href*='/page/']"))
      .map((a) => { const m = (a.getAttribute("href") || "").match(/page[=/](\d+)/); return m ? parseInt(m[1], 10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

async function upsertRows(sb, rows, stats, inserted, unmatched) {
  for (const r of rows) {
    const coins = parseCoins(r.pricePs);
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
    if (r.cardImageUrl) attrs.card_image_url = r.cardImageUrl.startsWith("http") ? r.cardImageUrl : `https://www.futbin.com${r.cardImageUrl}`;

    if (exist) {
      await sb.from("fc26_players")
        .update({ value_coins_estimate: coins, attributes: attrs, updated_at: new Date().toISOString() })
        .eq("id", exist.id);
      stats.updated++;
    } else {
      // Try to match an existing base card by (slug, rating) before inserting.
      const { data: base } = await sb
        .from("fc26_players")
        .select("id, attributes")
        .eq("slug", normalizedSlug)
        .eq("rating", r.rating)
        .is("deleted_at", null)
        .limit(1);
      if (base && base.length > 0) {
        const existingAttrs = base[0].attributes && typeof base[0].attributes === "object" ? { ...base[0].attributes, ...attrs } : attrs;
        await sb.from("fc26_players")
          .update({ value_coins_estimate: coins, attributes: existingAttrs, updated_at: new Date().toISOString() })
          .eq("id", base[0].id);
        stats.updated++;
      } else {
        await sb.from("fc26_players").insert({
          source_dataset: "futbin.com",
          source_row_id: sourceRowId,
          name: r.name,
          slug: normalizedSlug,
          rating: r.rating,
          position: r.position || "ST",
          item_type: r.variant ? "special" : "normal",
          value_coins_estimate: coins,
          attributes: attrs,
        });
        inserted.push({ name: r.name, rating: r.rating, variant: r.variant });
        stats.inserted++;
      }
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
  for (let p = state.lastPage + 1; p <= totalPages; p++) {
    await sleep(jitter());
    try {
      await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      const { rows } = await extractListPage(page);
      if (rows.length === 0) { console.log(`[headful] p${p}: 0 rows — likely end.`); break; }
      stats.pages++; stats.rows += rows.length;
      await upsertRows(sb, rows, stats, inserted, unmatched);
      state.lastPage = p;
      if (p % 10 === 0) saveState(state);
      if (p % 5 === 0 || p < 5) {
        console.log(`[headful] p${p}/${totalPages}: +${rows.length} | upd=${stats.updated} ins=${stats.inserted} np=${stats.noPrice}`);
      }
    } catch (e) {
      console.error(`[err] p${p}: ${e.message}`);
      await sleep(10000);
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
