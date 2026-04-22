#!/usr/bin/env node
// Phase A — per-card detail-page backfill via fut.gg search.
// For each fc26_players row without price_source='futgg_live', hit
// /players/?search=<name>&rating_min=<r>&rating_max=<r>, take first match,
// update value_coins_estimate + attributes.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const STATE_PATH = path.resolve(__dirname, "futgg_a_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futgg_a_unmatched.json");
const DELAY = 2500;
const TOP_N = 5000;
const MIN_RATING = 70; // squad-building threshold: ignore <70

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { offset: 0, processedIds: [] }; } };
const saveState = (s) => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
const stripD = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const slugify = (n) => stripD(n||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCoins(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (/^(-|0|sbc|untradeable|n\/a|extinct)$/i.test(s)) return null;
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1));
}

async function extractFirstMatch(page, targetName, targetRating) {
  return page.evaluate(({ targetName, targetRating }) => {
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
      const img = a.querySelector("img[alt]");
      const alt = img?.getAttribute("alt") || "";
      const altM = alt.match(/^(.+?)\s+-\s+(\d+)\s+-\s+(.+)$/);
      if (!altM) continue;
      const displayName = altM[1].trim();
      const rating = parseInt(altM[2], 10);
      const variant = altM[3].trim();
      const tokens = (a.innerText || "").split(/\s+/).map(s => s.trim()).filter(Boolean);
      const priceTokens = tokens.filter(t => /^[\d.]+[KMB]$/i.test(t));
      out.push({ eaId, cardId, displayName, rating, variant, priceTokens });
    }
    // Prefer exact name + rating + base-looking variant. Fall back down progressively.
    const target = targetName.toLowerCase();
    const isBaseLike = (v) => !/\b(icon|hero|toty|tots|totw|tott|rttf|fantasy|winter|radioactive|trailblazers|evo|centurions|fut birthday|golazo|flashback|rulebreaker|showdown|ones to watch|ottw|road to|moments|special)\b/i.test(v || "");
    const exactBase = out.find(c => c.rating === targetRating && c.displayName.toLowerCase() === target && isBaseLike(c.variant));
    if (exactBase) return exactBase;
    const exact = out.find(c => c.rating === targetRating && c.displayName.toLowerCase() === target);
    if (exact) return exact;
    const nearBase = out.find(c => c.rating === targetRating && c.displayName.toLowerCase().includes(target) && isBaseLike(c.variant));
    if (nearBase) return nearBase;
    const near = out.find(c => c.rating === targetRating && c.displayName.toLowerCase().includes(target));
    if (near) return near;
    const rated = out.find(c => c.rating === targetRating && isBaseLike(c.variant));
    return rated || out.find(c => c.rating === targetRating) || null;
  }, { targetName, targetRating });
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? { offset: 0, processedIds: [] } : loadState();
  const processedSet = new Set(state.processedIds || []);
  const unmatched = [];
  const stats = { attempted: 0, matched: 0, noMatch: 0, noPrice: 0, errors: 0, skipped: 0 };

  // Pull candidates DESC by rating, rating>=MIN_RATING, filter client-side for missing live price.
  const PAGE = 1000;
  const rows = [];
  for (let off = 0; rows.length < TOP_N * 2; off += PAGE) {
    const { data: chunk, error } = await sb
      .from("fc26_players")
      .select("id, name, rating, position, attributes")
      .is("deleted_at", null)
      .gte("rating", MIN_RATING)
      .order("rating", { ascending: false })
      .range(off, off + PAGE - 1);
    if (error) { console.error("[fatal] query:", error.message); process.exit(1); }
    if (!chunk || chunk.length === 0) break;
    for (const row of chunk) {
      const src = row.attributes && typeof row.attributes === "object" ? row.attributes.price_source : null;
      if (src !== "futgg_live") rows.push(row);
    }
    if (chunk.length < PAGE) break;
    if (rows.length >= TOP_N) break;
  }
  rows.splice(TOP_N);
  console.log(`[phase=A] backlog size=${rows.length} rating>=${MIN_RATING} (capped at ${TOP_N})`);
  if (rows.length === 0) { console.log("[phase=A] nothing to do."); return; }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }, locale: "en-US",
  });
  const page = await ctx.newPage();

  const deadlineMs = Date.now() + (3 * 60 * 60 * 1000); // 3h cap
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (processedSet.has(r.id)) { stats.skipped++; continue; }
    if (Date.now() > deadlineMs) { console.log(`[phase=A] deadline hit at row ${i}`); break; }
    stats.attempted++;
    const enc = encodeURIComponent(r.name);
    const url = `https://www.fut.gg/players/?search=${enc}&rating_min=${r.rating}&rating_max=${r.rating}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1800);
      const hit = await extractFirstMatch(page, r.name, r.rating);
      if (!hit) {
        stats.noMatch++;
        unmatched.push({ id: r.id, name: r.name, rating: r.rating, reason: "no_result" });
      } else {
        const coins = hit.priceTokens.length ? parseCoins(hit.priceTokens[hit.priceTokens.length - 1]) : null;
        if (!coins || coins < 150) {
          stats.noPrice++;
          unmatched.push({ id: r.id, name: r.name, rating: r.rating, reason: "no_price", hit: hit.displayName });
        } else {
          const attrs = (r.attributes && typeof r.attributes === "object") ? { ...r.attributes } : {};
          attrs.price_source = "futgg_live";
          attrs.price_snapshot_at = new Date().toISOString();
          attrs.futgg_ea_id = hit.eaId;
          attrs.futgg_card_id = hit.cardId;
          attrs.futgg_variant = hit.variant;
          const { error: upErr } = await sb
            .from("fc26_players")
            .update({ value_coins_estimate: coins, attributes: attrs, updated_at: new Date().toISOString() })
            .eq("id", r.id);
          if (upErr) { stats.errors++; }
          else { stats.matched++; }
        }
      }
      processedSet.add(r.id);
      if (stats.attempted % 50 === 0) {
        state.processedIds = Array.from(processedSet);
        state.offset = i;
        saveState(state);
        console.log(`[phase=A] i=${i} attempted=${stats.attempted} matched=${stats.matched} nm=${stats.noMatch} np=${stats.noPrice} err=${stats.errors}`);
      }
    } catch (e) {
      console.error(`[err] id=${r.id} name=${r.name}:`, e.message);
      stats.errors++;
      await sleep(4000);
    }
    await sleep(DELAY);
  }

  state.processedIds = Array.from(processedSet);
  saveState(state);
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2));
  console.log("[phase=A] done:", stats);
  await browser.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
