#!/usr/bin/env node
// Targeted re-scrape of a specific page range on /26/players.
// Usage:
//   node KNOWLEDGE/extracted/_scrape_futbin_range.js --from 30 --to 39

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const LIST_URL = (p) => `https://www.futbin.com/26/players?page=${p}`;

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

async function upsert(sb, rows, stats) {
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
    const v = (r.variant || "").toLowerCase();
    let itemType = "normal";
    if (/icon/.test(v)) itemType = "icon";
    else if (/hero/.test(v)) itemType = "hero";
    else if (/toty/.test(v)) itemType = "toty";
    else if (/tots/.test(v)) itemType = "tots";
    else if (/totw/.test(v)) itemType = "totw";
    else if (/rttf|road-to/.test(v)) itemType = "rttf";
    else if (r.variant && !/^(gold|silver|bronze|common|rare|normal|5_gold|4_silver|3_bronze|if)$/.test(v)) itemType = "special";
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
        stats.inserted++;
      }
    }
  }
}

async function main() {
  loadEnv();
  const fromArg = process.argv.indexOf("--from");
  const toArg = process.argv.indexOf("--to");
  if (fromArg < 0 || toArg < 0) { console.error("usage: --from N --to M"); process.exit(1); }
  const from = parseInt(process.argv[fromArg + 1], 10);
  const to = parseInt(process.argv[toArg + 1], 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) { console.error("bad --from/--to"); process.exit(1); }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (!fs.existsSync(PROFILE_DIR)) { console.error("run headful scraper first to warm profile"); process.exit(1); }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();

  // Warm via home.
  await page.goto("https://www.futbin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  const stats = { pages: 0, rows: 0, updated: 0, inserted: 0, noPrice: 0 };
  console.log(`[range] scraping p${from}..p${to}`);

  for (let p = from; p <= to; p++) {
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
    console.log(`[range] p${p}: ${pageRows.length} rows`);
    stats.pages++; stats.rows += pageRows.length;
    await upsert(sb, pageRows, stats);
  }

  console.log("[range] done:", stats);
  await ctx.close();
}
main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
