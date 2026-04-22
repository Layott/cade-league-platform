#!/usr/bin/env node
// fut.gg EAFC26 price scraper — Playwright.
// Source: https://www.fut.gg/players/?page=N, ~286 pages × ~60 cards.
// Cards are <a href="/players/<eaId>-<slug>/26-<cardId>/"> wrappers;
// img alt attribute carries "<Name> - <OVR> - <Variant>"; inline
// text has "POS | metarating | price".
//
// Matches cards to public.fc26_players by (lowercased-name-slug, rating,
// position). Special-version cards (Icon / Hero / Promos) that don't exist
// in our base catalogue → dropped silently, counted in stats.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const STATE_PATH = path.resolve(__dirname, "futgg_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futgg_unmatched.json");
const LIST_URL = (p) => `https://www.fut.gg/players/?page=${p}`;
const DELAY_MIN = 1800;
const DELAY_JITTER = 1500;

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
const slugify = (n) => stripD(n||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MIN + Math.floor(Math.random() * DELAY_JITTER);

function parseCoins(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (/^(-|0|sbc|untradeable|n\/a|extinct)$/i.test(s)) return null;
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1));
}

async function extractPage(page) {
  return page.evaluate(() => {
    const out = [];
    const anchors = document.querySelectorAll("a[href^='/players/']");
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      const hrefM = href.match(/\/players\/(\d+)-([^/]+)\/26-(\d+)\//);
      if (!hrefM) continue;
      const eaId = hrefM[1];
      const slug = hrefM[2];
      const cardId = hrefM[3];
      const img = a.querySelector("img[alt]");
      const alt = img?.getAttribute("alt") || "";
      const altM = alt.match(/^(.+?)\s+-\s+(\d+)\s+-\s+(.+)$/);
      if (!altM) continue;
      const displayName = altM[1].trim();
      const rating = parseInt(altM[2], 10);
      const variant = altM[3].trim();
      // Inline text layout: POS <metarating> <price> (sometimes more prices when card has PS+PC)
      const tokens = (a.innerText || "").split(/\s+/).map(s => s.trim()).filter(Boolean);
      // Position is first alpha token (RM/ST/CAM/etc)
      const positionToken = tokens.find(t => /^[A-Z]{2,3}$/.test(t) && t.length <= 3);
      // Prices are tokens matching [\d.]+[KMB]? at end
      const priceTokens = tokens.filter(t => /^[\d.]+[KMB]$/i.test(t));
      out.push({ eaId, urlSlug: slug, cardId, displayName, rating, variant, position: positionToken || null, priceTokens });
    }
    const pagers = Array.from(document.querySelectorAll("a[href*='?page=']"))
      .map(a => { const m = (a.getAttribute("href")||"").match(/page=(\d+)/); return m ? parseInt(m[1],10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

// Classify a fut.gg variant string into our item_type taxonomy.
// Returns { isBase, itemType } — itemType is the DB column value we write.
function classifyVariant(v) {
  if (!v) return { isBase: false, itemType: "special" };
  const s = v.toLowerCase();
  if (/\bicon\b/.test(s)) return { isBase: false, itemType: "icon" };
  if (/\bhero\b/.test(s)) return { isBase: false, itemType: "hero" };
  if (/\b(toty|team of the year)\b/.test(s)) return { isBase: false, itemType: "toty" };
  if (/\b(tots|team of the season)\b/.test(s)) return { isBase: false, itemType: "tots" };
  if (/\b(totw|team of the week|tott|tottw)\b/.test(s)) return { isBase: false, itemType: "totw" };
  if (/\brttf\b|road to the final/.test(s)) return { isBase: false, itemType: "rttf" };
  // Every other non-base promo — fantasy, future, winter, radioactive, ucl
  // road-to-finals, etc. — bucket as 'special'. Base variants: everything
  // that doesn't match a known promo family. Club names can include words
  // like "Real", "Manchester", etc — treat as base.
  const specialFamilies = /\b(fantasy|winter|holiday|future|radioactive|trailblazers|ultimate|evo|centurions|record breaker|best of|fut birthday|party bag|nations|tournament|golazo|coop|shapeshift|versus|legends|awards|ones? to watch|ottw|cover star|flashback|player of the month|league sbc|icon moments|hero moments|rulebreakers|showdown|thunderstruck|out of position|make your mark|special)\b/i;
  if (specialFamilies.test(s)) return { isBase: false, itemType: "special" };
  return { isBase: true, itemType: "normal" };
}

const FUTGG_DATASET = "https://www.fut.gg/";

async function match(sb, rows, stats, unmatched) {
  for (const r of rows) {
    if (!r.rating || !r.displayName) continue;
    const { isBase, itemType } = classifyVariant(r.variant);
    const coins = r.priceTokens.length ? parseCoins(r.priceTokens[r.priceTokens.length - 1]) : null;
    if (!coins || coins < 150) { stats.noPrice++; continue; }

    const slug = slugify(r.displayName);
    const futggSourceRowId = `futgg_26_${r.cardId}`;

    // For non-base variants (icon / hero / TOTY / etc.), look for an existing
    // row keyed by the fut.gg card_id first. If absent, INSERT a new row —
    // special cards aren't in the base Kaggle dump.
    if (!isBase) {
      const { data: exist } = await sb
        .from("fc26_players")
        .select("id, attributes")
        .eq("source_dataset", FUTGG_DATASET)
        .eq("source_row_id", futggSourceRowId)
        .is("deleted_at", null)
        .maybeSingle();
      const attrs = (exist?.attributes && typeof exist.attributes === "object") ? { ...exist.attributes } : {};
      attrs.price_source = "futgg_live";
      attrs.price_snapshot_at = new Date().toISOString();
      attrs.futgg_ea_id = r.eaId;
      attrs.futgg_card_id = r.cardId;
      attrs.futgg_variant = r.variant;
      if (exist) {
        const { error } = await sb
          .from("fc26_players")
          .update({ value_coins_estimate: coins, attributes: attrs, updated_at: new Date().toISOString() })
          .eq("id", exist.id);
        if (error) { stats.errors++; continue; }
        stats.specialUpdated++;
      } else {
        const { error } = await sb.from("fc26_players").insert({
          source_dataset: FUTGG_DATASET,
          source_row_id: futggSourceRowId,
          name: r.displayName,
          slug,
          rating: r.rating,
          position: r.position || "ST",
          item_type: itemType,
          value_coins_estimate: coins,
          attributes: attrs,
        });
        if (error) {
          // INSERT may fail if the row was created concurrently; retry via update path.
          stats.errors++;
          continue;
        }
        stats.specialInserted++;
      }
      continue;
    }

    // Base variant — update an existing fc26_players row.
    let { data: matches } = await sb
      .from("fc26_players")
      .select("id, name, rating, position, attributes")
      .eq("slug", slug)
      .eq("rating", r.rating)
      .is("deleted_at", null);
    if ((!matches || matches.length === 0) && r.displayName.length >= 3) {
      const { data: m2 } = await sb
        .from("fc26_players")
        .select("id, name, rating, position, attributes")
        .ilike("name", `%${r.displayName}%`)
        .eq("rating", r.rating)
        .is("deleted_at", null)
        .limit(3);
      matches = m2 || [];
    }
    if (!matches || matches.length === 0) {
      unmatched.push({ slug, name: r.displayName, rating: r.rating, variant: r.variant });
      stats.unmatched++;
      continue;
    }
    let chosen = matches[0];
    if (matches.length > 1 && r.position) {
      const better = matches.find((m) => m.position === r.position);
      if (better) chosen = better;
    }
    const attrs = (chosen.attributes && typeof chosen.attributes === "object") ? { ...chosen.attributes } : {};
    attrs.price_source = "futgg_live";
    attrs.price_snapshot_at = new Date().toISOString();
    attrs.futgg_ea_id = r.eaId;
    attrs.futgg_card_id = r.cardId;
    attrs.futgg_variant = r.variant;
    const { error } = await sb
      .from("fc26_players")
      .update({ value_coins_estimate: coins, attributes: attrs, updated_at: new Date().toISOString() })
      .eq("id", chosen.id);
    if (error) { stats.errors++; continue; }
    stats.updated++;
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? { lastPage: 0 } : loadState();
  const unmatched = [];
  const stats = { pages: 0, rows: 0, updated: 0, specialUpdated: 0, specialInserted: 0, unmatched: 0, noPrice: 0, errors: 0 };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }, locale: "en-US",
  });
  const page = await ctx.newPage();

  let totalPages = 286;
  for (let p = state.lastPage + 1; p <= totalPages; p++) {
    if (p > state.lastPage + 1 || p === 1) await sleep(jitter());
    try {
      await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2800);
      const { rows, maxPage } = await extractPage(page);
      if (maxPage && p === 1) { totalPages = maxPage; console.log(`[futgg] discovered totalPages=${totalPages}`); }
      if (rows.length === 0) { console.log(`[futgg] p${p}: 0 rows — stopping.`); break; }
      stats.rows += rows.length; stats.pages++;
      await match(sb, rows, stats, unmatched);
      state.lastPage = p;
      if (p % 10 === 0) saveState(state);
      if (p % 5 === 0 || p < 5) {
        console.log(`[futgg] p${p}/${totalPages}: +${rows.length} | base=${stats.updated} +special_upd=${stats.specialUpdated} +special_ins=${stats.specialInserted} un=${stats.unmatched} np=${stats.noPrice}`);
      }
    } catch (e) {
      console.error(`[err] p${p}:`, e.message);
      await sleep(8000);
    }
  }

  saveState(state);
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2));
  console.log("[futgg] done:", stats);
  await browser.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
