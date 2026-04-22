#!/usr/bin/env node
// Futwiz EAFC26 scraper — Playwright.
// Source of truth: data-card-info JSON attribute on each player anchor,
// plus the two trailing M/K price values in the card tile's innerText
// (console + PC quotes).
//
// Matches Futwiz cards to fc26_players by (common_name + rating +
// primary_position), writes value_coins_estimate + attributes.futwiz_id.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const STATE_PATH = path.resolve(__dirname, "futwiz_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futwiz_unmatched.json");
const LIST_URL = (p) => `https://www.futwiz.com/en/fc26/players?page=${p}`;
const DELAY_MIN = 2500;
const DELAY_JITTER = 2000;

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { lastPage: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }
function stripDiacritics(s) { return s.normalize("NFKD").replace(/[̀-ͯ]/g, ""); }
function slugify(n) { return stripDiacritics(n||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,""); }

function parseCoins(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^(-|0|sbc|untradeable|n\/a)$/i.test(s)) return null;
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MIN + Math.floor(Math.random() * DELAY_JITTER);

async function extractPage(page) {
  return page.evaluate(() => {
    const out = { rows: [], lastPage: null };
    const anchors = document.querySelectorAll("a[href*='/fc26/player/']");
    for (const a of anchors) {
      const info = a.getAttribute("data-card-info");
      if (!info) continue;
      let parsed;
      try { parsed = JSON.parse(info.replace(/&quot;/g, '"')); } catch { continue; }
      const name = parsed.common_name || "";
      const rating = parsed.rating;
      if (!name || !rating) continue;
      const lineId = parsed.line_id;
      const cardId = parsed.card_id;
      // Pull all numeric/coin-looking strings from the card's text.
      const txt = (a.innerText || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
      // Position is typically index 1 (after rating).
      const position = txt[1] || null;
      // Prices are the last 1-2 tokens that match coin pattern (M/K).
      const coinRe = /^[\d.]+\s*[KMB]?$/i;
      const coinTokens = txt.filter((t) => coinRe.test(t) && /[KMB]/i.test(t));
      // Filter out rating/stat numbers (pure digits without suffix).
      // Final two tokens are console/PC prices.
      const priceTokens = coinTokens.slice(-2);
      out.rows.push({
        futwizLineId: lineId, futwizCardId: cardId,
        name, rating, position,
        priceConsole: priceTokens[0] || null,
        pricePc: priceTokens[1] || priceTokens[0] || null,
        href: a.getAttribute("href") || null,
      });
    }
    // Discover total pages from pagination.
    const lastA = Array.from(document.querySelectorAll("a[href*='?page=']"))
      .map((a) => {
        const m = (a.getAttribute("href") || "").match(/page=(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      });
    if (lastA.length) out.lastPage = Math.max(...lastA);
    return out;
  });
}

async function match(sb, frows, stats, unmatched) {
  for (const fr of frows) {
    const coins = parseCoins(fr.priceConsole) || parseCoins(fr.pricePc);
    if (!coins || coins < 100) { stats.noPrice++; continue; }
    const slug = slugify(fr.name);
    let { data: matches } = await sb
      .from("fc26_players")
      .select("id, name, rating, position, attributes")
      .eq("slug", slug)
      .eq("rating", fr.rating)
      .is("deleted_at", null);
    if ((!matches || matches.length === 0) && fr.name.length >= 3) {
      const { data: m2 } = await sb
        .from("fc26_players")
        .select("id, name, rating, position, attributes")
        .ilike("name", `%${fr.name}%`)
        .eq("rating", fr.rating)
        .is("deleted_at", null)
        .limit(3);
      matches = m2 || [];
    }
    if (!matches || matches.length === 0) { unmatched.push(fr); stats.unmatched++; continue; }
    let chosen = matches[0];
    if (matches.length > 1 && fr.position) {
      const better = matches.find((m) => m.position === fr.position);
      if (better) chosen = better;
    }
    const attrs = (chosen.attributes && typeof chosen.attributes === "object") ? {...chosen.attributes} : {};
    attrs.price_source = "futwiz_live";
    attrs.price_snapshot_at = new Date().toISOString();
    attrs.futwiz_line_id = fr.futwizLineId;
    attrs.futwiz_card_id = fr.futwizCardId;
    const { error } = await sb
      .from("fc26_players")
      .update({ value_coins_estimate: coins, attributes: attrs, updated_at: new Date().toISOString() })
      .eq("id", chosen.id);
    if (error) { stats.errors++; console.error("upd err:", error.message); continue; }
    stats.updated++;
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? { lastPage: 0 } : loadState();
  const unmatched = [];
  const stats = { pages: 0, rows: 0, updated: 0, unmatched: 0, noPrice: 0, errors: 0 };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }, locale: "en-US",
  });
  const page = await ctx.newPage();

  // p1 probe for totalPages.
  let totalPages = 0;
  {
    const p = Math.max(1, state.lastPage + 1);
    console.log(`[futwiz] p${p} (initial) …`);
    await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    const { rows, lastPage: tp } = await extractPage(page);
    totalPages = tp || 500;
    stats.rows += rows.length;
    stats.pages++;
    await match(sb, rows, stats, unmatched);
    state.lastPage = p; saveState(state);
    console.log(`[futwiz] p${p}: ${rows.length} rows | updated=${stats.updated} unmatched=${stats.unmatched} total≈${totalPages}`);
  }

  for (let p = state.lastPage + 1; p <= totalPages; p++) {
    await sleep(jitter());
    try {
      await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2500);
      const { rows } = await extractPage(page);
      if (rows.length === 0) { console.log(`[futwiz] p${p}: 0 rows — stopping.`); break; }
      stats.rows += rows.length; stats.pages++;
      await match(sb, rows, stats, unmatched);
      state.lastPage = p;
      if (p % 10 === 0) saveState(state);
      if (p % 5 === 0 || p < 5) {
        console.log(`[futwiz] p${p}/${totalPages}: +${rows.length} | updated=${stats.updated} unmatched=${stats.unmatched} noPrice=${stats.noPrice}`);
      }
    } catch (e) {
      console.error(`[err] p${p}:`, e.message);
      await sleep(10000);
    }
  }

  saveState(state);
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2));
  console.log("[futwiz] done:", stats);
  await browser.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
