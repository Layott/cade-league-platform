#!/usr/bin/env node
// Phase B — fut.gg EAFC26 rating-band + promo-filter sweep.
// Walks /players/?rating_min=X&rating_max=Y&page=N and /players/?card_type=<promo>&page=N
// (plus a few alternate param names) until 0 rows per band.
//
// Models on _scrape_futgg.js (Phase 1). Same extraction logic + same INSERT/UPDATE
// against public.fc26_players.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const STATE_PATH = path.resolve(__dirname, "futgg_b_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futgg_b_unmatched.json");
const DELAY_MIN = 1800;
const DELAY_JITTER = 1500;

const RATING_BANDS = [
  [99, 99], [95, 98], [90, 94], [85, 89], [80, 84], [75, 79],
  [70, 74], [65, 69], [60, 64], [55, 59], [45, 54],
];

// Known promo families. We'll try each of these slugs against multiple param names.
// First run per-param probe to discover which is valid.
const PROMO_SLUGS = [
  "icon", "hero", "toty", "tots", "totw", "rttf",
  "fut_birthday", "fantasy", "winter_wildcards", "road_to_glory",
  "trailblazers", "ones_to_watch", "centurions", "flashback",
  "ucl_rttk", "golazo", "showdown", "rulebreakers",
  "thunderstruck", "future_stars", "record_breakers",
];
const PARAM_CANDIDATES = ["card_type", "promo", "rarity", "version"];

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return {}; } };
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
    const seen = new Set();
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      const hrefM = href.match(/\/players\/(\d+)-([^/]+)\/26-(\d+)\//);
      if (!hrefM) continue;
      const cardId = hrefM[3];
      if (seen.has(cardId)) continue;
      seen.add(cardId);
      const eaId = hrefM[1];
      const slug = hrefM[2];
      const img = a.querySelector("img[alt]");
      const alt = img?.getAttribute("alt") || "";
      const altM = alt.match(/^(.+?)\s+-\s+(\d+)\s+-\s+(.+)$/);
      if (!altM) continue;
      const displayName = altM[1].trim();
      const rating = parseInt(altM[2], 10);
      const variant = altM[3].trim();
      const tokens = (a.innerText || "").split(/\s+/).map(s => s.trim()).filter(Boolean);
      const positionToken = tokens.find(t => /^[A-Z]{2,3}$/.test(t) && t.length <= 3);
      const priceTokens = tokens.filter(t => /^[\d.]+[KMB]$/i.test(t));
      out.push({ eaId, urlSlug: slug, cardId, displayName, rating, variant, position: positionToken || null, priceTokens });
    }
    const pagers = Array.from(document.querySelectorAll("a[href*='?page=']"))
      .concat(Array.from(document.querySelectorAll("a[href*='&page=']")))
      .map(a => { const m = (a.getAttribute("href")||"").match(/page=(\d+)/); return m ? parseInt(m[1],10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

function classifyVariant(v) {
  if (!v) return { isBase: false, itemType: "special" };
  const s = v.toLowerCase();
  if (/\bicon\b/.test(s)) return { isBase: false, itemType: "icon" };
  if (/\bhero\b/.test(s)) return { isBase: false, itemType: "hero" };
  if (/\b(toty|team of the year)\b/.test(s)) return { isBase: false, itemType: "toty" };
  if (/\b(tots|team of the season)\b/.test(s)) return { isBase: false, itemType: "tots" };
  if (/\b(totw|team of the week|tott|tottw)\b/.test(s)) return { isBase: false, itemType: "totw" };
  if (/\brttf\b|road to the final/.test(s)) return { isBase: false, itemType: "rttf" };
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
        if (error) { stats.errors++; continue; }
        stats.specialInserted++;
      }
      continue;
    }

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

async function walkBand(browser, page, sb, bandKey, urlFn, state, stats, unmatched, maxPagesHint, ratingLo, ratingHi) {
  const prev = state[bandKey] || { lastPage: 0, done: false };
  if (prev.done) { console.log(`[band=${bandKey}] already done, skip`); return; }
  let startPage = prev.lastPage + 1;
  let totalPages = maxPagesHint || 500;
  let emptyStreak = 0;
  let outOfBandStreak = 0;
  for (let p = startPage; p <= totalPages; p++) {
    await sleep(jitter());
    try {
      const url = urlFn(p);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2800);
      const { rows, maxPage } = await extractPage(page);
      if (maxPage && maxPage > totalPages) totalPages = maxPage;
      if (rows.length === 0) {
        emptyStreak++;
        console.log(`[band=${bandKey}] p${p}: 0 rows (streak=${emptyStreak})`);
        if (emptyStreak >= 2) break;
        continue;
      }
      emptyStreak = 0;
      // Early-exit when fut.gg filter leaks: if we asked for [lo,hi] but most
      // rows on this page are outside that band, the site ran out of matches
      // and is padding with unrelated cards. Abort band.
      let inBand = rows.length;
      if (ratingLo !== undefined && ratingHi !== undefined) {
        inBand = rows.filter((r) => r.rating >= ratingLo && r.rating <= ratingHi).length;
        if (inBand === 0) {
          outOfBandStreak++;
          console.log(`[band=${bandKey}] p${p}: 0 in-band / ${rows.length} total (streak=${outOfBandStreak})`);
          if (outOfBandStreak >= 2) break;
          continue;
        }
        outOfBandStreak = 0;
        // Filter rows to in-band only before matching, to avoid polluting stats.
        rows.splice(0, rows.length, ...rows.filter((r) => r.rating >= ratingLo && r.rating <= ratingHi));
      }
      stats.rows += rows.length;
      stats.pages++;
      await match(sb, rows, stats, unmatched);
      state[bandKey] = { lastPage: p, done: false };
      if (p % 3 === 0) saveState(state);
      if (p % 2 === 0 || p < 3) {
        console.log(`[band=${bandKey}] p${p}/${totalPages}: +${rows.length} in-band (${inBand}/${inBand + (rows.length - inBand)}) | base=${stats.updated} su=${stats.specialUpdated} si=${stats.specialInserted} un=${stats.unmatched} np=${stats.noPrice}`);
      }
    } catch (e) {
      console.error(`[err] band=${bandKey} p${p}:`, e.message);
      await sleep(8000);
    }
  }
  state[bandKey] = { ...state[bandKey], done: true };
  saveState(state);
  console.log(`[band=${bandKey}] done.`);
}

async function probePromoParam(page) {
  // Try each param name with 'icon' — pick the one that returns fut.gg cards.
  // Icon is the safest probe because it's a well-known high-visibility family.
  for (const param of PARAM_CANDIDATES) {
    const url = `https://www.fut.gg/players/?${param}=icon&page=1`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2800);
      const { rows } = await extractPage(page);
      const iconRows = rows.filter((r) => /icon/i.test(r.variant));
      console.log(`[probe] param=${param}: rows=${rows.length} iconRows=${iconRows.length}`);
      if (iconRows.length > 5 && iconRows.length > rows.length * 0.5) {
        return param;
      }
    } catch (e) {
      console.error(`[probe-err] param=${param}:`, e.message);
    }
    await sleep(jitter());
  }
  return null;
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? {} : loadState();
  const unmatched = [];
  const stats = { pages: 0, rows: 0, updated: 0, specialUpdated: 0, specialInserted: 0, unmatched: 0, noPrice: 0, errors: 0 };
  console.log(`[phase=B] start. state keys: ${Object.keys(state).length}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }, locale: "en-US",
  });
  const page = await ctx.newPage();

  // --- Rating bands ---
  for (const [lo, hi] of RATING_BANDS) {
    const bandKey = `rating_${lo}_${hi}`;
    await walkBand(
      browser, page, sb, bandKey,
      (p) => `https://www.fut.gg/players/?rating_min=${lo}&rating_max=${hi}&page=${p}`,
      state, stats, unmatched, 100, lo, hi,
    );
  }

  // --- Promo filters ---
  // Probe for the right param name first (only if not already cached).
  let promoParam = state.__promoParam || null;
  if (!promoParam) {
    promoParam = await probePromoParam(page);
    if (promoParam) {
      state.__promoParam = promoParam;
      saveState(state);
      console.log(`[phase=B] promoParam discovered: ${promoParam}`);
    } else {
      console.log(`[phase=B] no working promo param found — skipping promo sweep.`);
    }
  } else {
    console.log(`[phase=B] promoParam cached: ${promoParam}`);
  }

  if (promoParam) {
    for (const slug of PROMO_SLUGS) {
      const bandKey = `promo_${promoParam}_${slug}`;
      await walkBand(
        browser, page, sb, bandKey,
        (p) => `https://www.fut.gg/players/?${promoParam}=${slug}&page=${p}`,
        state, stats, unmatched, 50,
      );
    }
  }

  saveState(state);
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2));
  console.log("[phase=B] done:", stats);
  await browser.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
