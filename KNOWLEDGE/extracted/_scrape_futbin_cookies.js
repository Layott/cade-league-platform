#!/usr/bin/env node
/* eslint-disable no-console */
//
// Futbin cookie-injected full-catalogue scraper.
//
// Why this exists (2026-04-22):
//   Prior scrapers (_scrape_futbin_playwright.js + _scrape_futgg_images.js) only
//   covered ~19% of the FC26 catalogue because:
//     a) Futbin blocks plain Playwright behind a Cloudflare JS challenge that
//        auto-solves unreliably.
//     b) The existing scrapers only update rows that already exist in
//        fc26_players; they do NOT insert new rows for promo variants
//        (FUT Birthday, TOTY, Hero, Icon Ultimate, etc). A single player like
//        Ronaldo has a base gold + 6-10 promo cards — each has its own Futbin
//        resourceId — and we were only ever touching the base card.
//
// How this one is different:
//   1. Reads Cloudflare-warmed cookies from
//      KNOWLEDGE/extracted/.futbin_cookies.json (gitignored). User solves the
//      challenge once in their real browser, pastes cf_clearance + __cf_bm
//      (and any other futbin.com cookies). We replay them.
//   2. After warmup, if still blocked, exit(1) with loud instructions — do
//      NOT fall through to broken data.
//   3. Canonical key is (source_dataset='futbin.com', source_row_id='futbin_<resourceId>').
//      Every Futbin variant gets its own row. Matches the fut.gg image scraper's
//      approach.
//   4. UPDATE when the canonical key exists OR (slug + rating + variant) matches.
//      INSERT otherwise with item_type=<variant-normalized>, attributes packed
//      with card_image_url, futbin_variant, futbin_id, price_source,
//      price_snapshot_at, ps_price, pc_price.
//
// Usage:
//   1. Open https://www.futbin.com/26/players in your normal Chrome browser
//      while Wall-E / Cloudflare is already cleared. Wait until the table
//      renders.
//   2. DevTools → Application → Cookies → https://www.futbin.com
//      Copy these cookies into KNOWLEDGE/extracted/.futbin_cookies.json as JSON:
//        [
//          { "name": "cf_clearance", "value": "...", "domain": ".futbin.com", "path": "/" },
//          { "name": "__cf_bm",      "value": "...", "domain": ".futbin.com", "path": "/" }
//        ]
//      Include anything else from futbin.com (PHPSESSID, nlbi_*, etc) if Futbin
//      is still 403'ing.
//   3. From repo root:   node KNOWLEDGE/extracted/_scrape_futbin_cookies.js
//   4. Script resumes from KNOWLEDGE/extracted/futbin_cookies_state.json on
//      re-run. Use --reset to start over.
//
// Notes:
//   - No image download. We only persist the Futbin CDN URL; browser fetches
//     directly. Plan 16 overlays point at attributes.card_image_url via the
//     existing <PlayerCard> component.
//   - Rate: 2.5-4s jittered per page. Backoff on 429/503 is 60s → 120s → 300s
//     then abort (state is saved, rerun resumes).

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

// ---- config ----------------------------------------------------------------

const COOKIES_PATH = path.resolve(__dirname, ".futbin_cookies.json");
const STATE_PATH = path.resolve(__dirname, "futbin_cookies_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futbin_cookies_unmatched.json");
const INSERTED_PATH = path.resolve(__dirname, "futbin_cookies_inserted.json");
const LIST_URL = (p) => `https://www.futbin.com/26/players?page=${p}`;
const HOME_URL = "https://www.futbin.com/";

const FUTBIN_DATASET = "futbin.com";

const DELAY_MIN_MS = 2500;
const DELAY_JITTER_MS = 1500; // → 2.5-4s per page
const BACKOFF_STEPS_MS = [60_000, 120_000, 300_000];
const SAVE_EVERY_ROWS = 50;

// ---- bootstrap -------------------------------------------------------------

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function loadCookies() {
  if (!fs.existsSync(COOKIES_PATH)) {
    console.error("");
    console.error("[FATAL] No cookie file found at:");
    console.error("  " + COOKIES_PATH);
    console.error("");
    console.error("Steps to create it:");
    console.error("  1. Open https://www.futbin.com/26/players in your REAL Chrome (not incognito).");
    console.error("  2. Wait for the table to render. Solve any Cloudflare challenge.");
    console.error("  3. DevTools → Application → Cookies → https://www.futbin.com");
    console.error("  4. Copy cf_clearance + __cf_bm (and any others futbin sets)");
    console.error("     into a JSON array at " + COOKIES_PATH + ":");
    console.error("     [");
    console.error("       { \"name\": \"cf_clearance\", \"value\": \"...\", \"domain\": \".futbin.com\", \"path\": \"/\" },");
    console.error("       { \"name\": \"__cf_bm\",      \"value\": \"...\", \"domain\": \".futbin.com\", \"path\": \"/\" }");
    console.error("     ]");
    console.error("  5. Re-run this script.");
    console.error("");
    process.exit(1);
  }
  const raw = fs.readFileSync(COOKIES_PATH, "utf8");
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    console.error("[FATAL] .futbin_cookies.json is not valid JSON:", e.message);
    process.exit(1);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error("[FATAL] .futbin_cookies.json must be a non-empty JSON array of cookie objects.");
    process.exit(1);
  }
  // Normalise: Playwright requires name+value+(url OR (domain+path)).
  return parsed.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || ".futbin.com",
    path: c.path || "/",
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? true,
    sameSite: c.sameSite || "Lax",
    ...(c.expires ? { expires: c.expires } : {}),
  }));
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastPage: 0, totalPages: null };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
  catch { return { lastPage: 0, totalPages: null }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

// ---- helpers ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MIN_MS + Math.floor(Math.random() * DELAY_JITTER_MS);
const stripD = (s) => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const slugify = (n) => stripD(n).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function parseCoins(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/[, ]/g, "");
  if (!s || /^(0|-|sbc|untradeable|untradable|n\/a|na)$/i.test(s)) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mul = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] : 1;
  return Math.round(n * mul);
}

// Map a Futbin variant label → item_type enum value stored on fc26_players.
// fc26_players.item_type is free-text (default 'normal'); we normalise anyway so
// filters stay sane. Keep it lowercase + underscored.
function normaliseVariant(variantRaw) {
  const v = (variantRaw || "").trim().toLowerCase();
  if (!v) return "normal";
  if (/^(gold\s*rare|gold\s*non-?rare|gold|silver|bronze|normal|rare)$/i.test(v)) return "normal";
  return v.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "normal";
}

// ---- extraction ------------------------------------------------------------
//
// Futbin's /26/players page shape (as of Apr 2026):
//   - table#repTb > tbody > tr.player_tr_1 (one per card)
//   - each tr has data-url="/26/player/<resourceId>/..."
//   - img.player_img_table or img inside .player-img-table carries CDN src
//   - PS price in td with class .platform-ps-only / data-price-num
//   - PC price in td with class .platform-pc-only
//   - revision/variant label inside .pcdisplay-rev / .player-rev
// The extractor is defensive — Futbin tweaks DOM often. We fall back through
// several selectors and keep raw snippets for debugging on miss.
async function extractListPage(page) {
  return page.evaluate(() => {
    const rows = [];
    const trs = document.querySelectorAll(
      "table#repTb tbody tr.player_tr_1, table.players_table tbody tr.player_tr_1, tr.player_tr_1, table.players_table tbody tr, tbody tr[data-url*='/26/player/']"
    );

    for (const tr of trs) {
      const dataUrl = tr.getAttribute("data-url") || "";
      const anchor =
        tr.querySelector("a[href*='/26/player/']") ||
        tr.querySelector("a.player_name_players_table, a.player-name");
      const href = anchor?.getAttribute("href") || dataUrl || "";
      const idMatch = href.match(/\/26\/player\/(\d+)(?:\/|$)/);
      if (!idMatch) continue;
      const futbinId = idMatch[1];

      const name =
        anchor?.textContent?.trim() ||
        tr.querySelector(".pcdisplay-name, .player-name, td.player a")?.textContent?.trim() ||
        "";
      if (!name) continue;

      const ratingEl = tr.querySelector(".pcdisplay-rat, .rating, td.rating, .player-rating");
      const rating = ratingEl ? parseInt(ratingEl.textContent.trim(), 10) : null;

      const positionEl = tr.querySelector(".pcdisplay-pos, .position, td.position, .player-position");
      const position = positionEl ? positionEl.textContent.trim() : null;

      const clubAnchor = tr.querySelector("a[href*='/clubs/']");
      const club = clubAnchor ? (clubAnchor.getAttribute("title") || clubAnchor.textContent.trim()) : null;

      const leagueAnchor = tr.querySelector("a[href*='/leagues/']");
      const league = leagueAnchor ? (leagueAnchor.getAttribute("title") || leagueAnchor.textContent.trim()) : null;

      const nationAnchor = tr.querySelector("a[href*='/nation/']");
      const nation = nationAnchor ? (nationAnchor.getAttribute("title") || nationAnchor.textContent.trim()) : null;

      // Variant label — Futbin shows this in the revision badge under the name.
      const revisionEl = tr.querySelector(".pcdisplay-rev, .player-revision, td.revision, .player-rev, .card-name-revision");
      let variantText = revisionEl ? revisionEl.textContent.trim() : "";
      if (!variantText) {
        // Fallback: derive from card color class (e.g. "tott_gold rare").
        const card = tr.querySelector("[class*='card-'], [class*='color-']");
        if (card) variantText = card.className.split(/\s+/).find((c) => /card-|color-/.test(c)) || "";
      }

      // Card image — Futbin CDN URL.
      const img =
        tr.querySelector("img.player_img_table, .player-img-table img, td.player img, img[src*='futbin.com/content/'], img[data-src*='futbin.com/content/']");
      const imgSrc = img ? (img.getAttribute("src") || img.getAttribute("data-src") || "") : "";

      // Prices — Futbin puts them in dedicated cells.
      const psCell =
        tr.querySelector(".platform-ps-only, td.platform-ps-only, [data-platform='ps']") ||
        tr.querySelector("td.ps-price, .ps-price");
      const pcCell =
        tr.querySelector(".platform-pc-only, td.platform-pc-only, [data-platform='pc']") ||
        tr.querySelector("td.pc-price, .pc-price");
      const psDataPrice = psCell?.getAttribute("data-price-num") || tr.getAttribute("data-price-ps") || null;
      const pcDataPrice = pcCell?.getAttribute("data-price-num") || tr.getAttribute("data-price-pc") || null;
      const psText = psCell?.textContent?.trim() || null;
      const pcText = pcCell?.textContent?.trim() || null;

      rows.push({
        futbinId, name, rating, position, club, league, nation,
        variantText, imgSrc, psDataPrice, pcDataPrice, psText, pcText,
      });
    }

    // Pagination — find the highest page number referenced.
    const pagerNums = Array.from(document.querySelectorAll("a[href*='?page=']"))
      .map((a) => {
        const m = (a.getAttribute("href") || "").match(/page=(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const totalPages = pagerNums.length ? Math.max(...pagerNums) : null;

    return { rows, totalPages };
  });
}

// ---- DB side ---------------------------------------------------------------

async function applyRow(sb, r, stats, unmatched, inserted) {
  if (!r.name || !r.rating) { stats.skippedNoName++; return; }
  const variant = normaliseVariant(r.variantText);
  const slug = slugify(r.name);
  const psPrice = parseCoins(r.psDataPrice) ?? parseCoins(r.psText);
  const pcPrice = parseCoins(r.pcDataPrice) ?? parseCoins(r.pcText);
  const coins = psPrice ?? pcPrice;
  const cardImageUrl = r.imgSrc && r.imgSrc.startsWith("http") ? r.imgSrc : null;

  // 1. Primary lookup: canonical (futbin.com, futbin_<resourceId>).
  const sourceRowId = `futbin_${r.futbinId}`;
  let { data: exact } = await sb
    .from("fc26_players")
    .select("id, attributes, name, rating")
    .eq("source_dataset", FUTBIN_DATASET)
    .eq("source_row_id", sourceRowId)
    .is("deleted_at", null)
    .maybeSingle();

  // 2. Fallback: (slug, rating) with matching variant in attributes.futbin_variant.
  //    Covers rows imported from Kaggle / fut.gg where we haven't keyed by Futbin yet.
  if (!exact) {
    const { data: byName } = await sb
      .from("fc26_players")
      .select("id, attributes, name, rating")
      .eq("slug", slug)
      .eq("rating", r.rating)
      .is("deleted_at", null)
      .limit(5);
    if (byName && byName.length) {
      // Prefer rows whose existing variant matches the incoming one.
      const best = byName.find((row) => {
        const existingVariant = (row.attributes?.futbin_variant || row.attributes?.futgg_variant || "").toLowerCase();
        return existingVariant && existingVariant.includes(variant.split("_")[0]);
      }) || byName.find((row) => !row.attributes?.futbin_variant && !row.attributes?.futgg_variant) || byName[0];
      exact = best;
    }
  }

  const nowIso = new Date().toISOString();

  if (exact) {
    const existingAttrs = (exact.attributes && typeof exact.attributes === "object") ? { ...exact.attributes } : {};
    existingAttrs.price_source = "futbin_live";
    existingAttrs.price_snapshot_at = nowIso;
    existingAttrs.futbin_id = r.futbinId;
    existingAttrs.futbin_variant = r.variantText || existingAttrs.futbin_variant || variant;
    if (psPrice != null) existingAttrs.ps_price = psPrice;
    if (pcPrice != null) existingAttrs.pc_price = pcPrice;
    if (cardImageUrl && !existingAttrs.card_image_url) existingAttrs.card_image_url = cardImageUrl;

    const updatePayload = {
      attributes: existingAttrs,
      updated_at: nowIso,
    };
    if (coins != null) updatePayload.value_coins_estimate = coins;

    const { error } = await sb.from("fc26_players").update(updatePayload).eq("id", exact.id);
    if (error) {
      stats.errors++;
      return;
    }
    stats.updated++;
    return;
  }

  // 3. INSERT — new variant row. item_type = normalised variant.
  const newAttrs = {
    price_source: "futbin_live",
    price_snapshot_at: nowIso,
    futbin_id: r.futbinId,
    futbin_variant: r.variantText || variant,
    card_image_url: cardImageUrl,
    ps_price: psPrice,
    pc_price: pcPrice,
  };
  const insertRow = {
    source_dataset: FUTBIN_DATASET,
    source_row_id: sourceRowId,
    name: r.name,
    slug,
    rating: r.rating,
    position: r.position || "CAM",
    club: r.club,
    league: r.league,
    nation: r.nation,
    attributes: newAttrs,
    item_type: variant,
    value_coins_estimate: coins,
  };
  const { error: insErr } = await sb.from("fc26_players").insert(insertRow);
  if (insErr) {
    // Duplicate on canonical key = benign, treat as update-miss.
    if (/duplicate|unique/i.test(insErr.message || "")) { stats.dupes++; return; }
    stats.errors++;
    return;
  }
  inserted.push({ futbinId: r.futbinId, name: r.name, rating: r.rating, variant });
  stats.inserted++;
}

// ---- main ------------------------------------------------------------------

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[FATAL] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const cookies = loadCookies();
  console.log(`[futbin-cookie] loaded ${cookies.length} cookies`);

  const state = process.argv.includes("--reset") ? { lastPage: 0, totalPages: null } : loadState();
  const unmatched = [];
  const inserted = [];
  const stats = {
    pages: 0,
    rows: 0,
    updated: 0,
    inserted: 0,
    dupes: 0,
    errors: 0,
    skippedNoName: 0,
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    extraHTTPHeaders: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="129", "Not=A?Brand";v="8", "Google Chrome";v="129"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    },
  });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  // ---- warmup ----
  console.log("[futbin-cookie] warmup …");
  try {
    const resp = await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    const status = resp?.status() ?? 0;
    const title = await page.title();
    const html = await page.content();
    const challenged =
      status === 403 ||
      /just a moment/i.test(title) ||
      /cf-chl-|challenge-platform|Attention Required!/i.test(html);
    if (challenged) {
      console.error("");
      console.error("[FATAL] Cloudflare challenge still present after cookie warmup.");
      console.error("        status=" + status + " title=\"" + title + "\"");
      console.error("");
      console.error("Your cf_clearance is either expired, tied to a different IP, or your User-Agent");
      console.error("mismatches the browser that generated it.");
      console.error("");
      console.error("Fix:");
      console.error("  1. Reopen https://www.futbin.com/26/players in the SAME browser profile you used");
      console.error("     the first time.");
      console.error("  2. DevTools → Application → Cookies → copy fresh cf_clearance + __cf_bm.");
      console.error("  3. Overwrite " + COOKIES_PATH + ".");
      console.error("  4. Make sure your machine is on the SAME IP as when the cookie was issued");
      console.error("     (Cloudflare binds cf_clearance to IP + UA).");
      console.error("  5. Re-run this script.");
      console.error("");
      await browser.close();
      process.exit(1);
    }
    console.log(`[futbin-cookie] warmup OK (status ${status}, title="${title}")`);
  } catch (e) {
    console.error("[FATAL] warmup failed:", e.message);
    await browser.close();
    process.exit(1);
  }

  // ---- page 1 → discover total pages ----
  let totalPages = state.totalPages || 0;
  const firstPage = Math.max(1, state.lastPage + 1);

  let consecutiveBlocks = 0;
  async function fetchPage(pnum) {
    await page.goto(LIST_URL(pnum), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_800);
    const html = await page.content();
    if (/Just a moment|cf-chl-|Attention Required!/i.test(html)) {
      return { blocked: true, rows: [], totalPages: null };
    }
    const { rows, totalPages: tp } = await extractListPage(page);
    return { blocked: false, rows, totalPages: tp };
  }

  console.log(`[futbin-cookie] resume from page ${firstPage}`);

  // Walk pages until empty or totalPages hit.
  let p = firstPage;
  let rowsSinceSave = 0;
  while (true) {
    if (totalPages && p > totalPages) break;
    if (!totalPages && p > 800) { console.log("[futbin-cookie] hit 800-page hard cap without finding end. stopping."); break; }

    try {
      const out = await fetchPage(p);
      if (out.blocked) {
        consecutiveBlocks++;
        const step = BACKOFF_STEPS_MS[Math.min(consecutiveBlocks - 1, BACKOFF_STEPS_MS.length - 1)];
        console.error(`[futbin-cookie] p${p}: Cloudflare re-challenged. backing off ${step / 1000}s (attempt ${consecutiveBlocks}/${BACKOFF_STEPS_MS.length}).`);
        if (consecutiveBlocks > BACKOFF_STEPS_MS.length) {
          console.error("[FATAL] Cloudflare persistently blocking. Aborting. State saved. Re-run after refreshing cookies.");
          break;
        }
        await sleep(step);
        continue; // retry same page
      }
      consecutiveBlocks = 0;

      if (out.totalPages && !totalPages) {
        totalPages = out.totalPages;
        state.totalPages = totalPages;
        console.log(`[futbin-cookie] discovered totalPages=${totalPages}`);
      }

      if (out.rows.length === 0) {
        console.log(`[futbin-cookie] p${p}: 0 rows — end of catalogue. stopping.`);
        break;
      }

      stats.rows += out.rows.length;
      stats.pages++;

      for (const r of out.rows) {
        await applyRow(sb, r, stats, unmatched, inserted);
        rowsSinceSave++;
        if (rowsSinceSave >= SAVE_EVERY_ROWS) {
          state.lastPage = p;
          saveState(state);
          fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched.slice(-500), null, 2));
          fs.writeFileSync(INSERTED_PATH, JSON.stringify(inserted.slice(-500), null, 2));
          rowsSinceSave = 0;
        }
      }

      state.lastPage = p;
      if (p % 5 === 0 || p <= 5) {
        console.log(
          `[futbin-cookie] p${p}${totalPages ? "/" + totalPages : ""}: +${out.rows.length} rows | upd=${stats.updated} ins=${stats.inserted} dup=${stats.dupes} err=${stats.errors}`
        );
      }
      if (p % 10 === 0) saveState(state);

      await sleep(jitter());
      p++;
    } catch (e) {
      console.error(`[err] p${p}:`, e.message);
      // Transient navigation error — soft-backoff then retry.
      await sleep(8_000);
      // Don't increment p; retry same page.
    }
  }

  saveState(state);
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched.slice(-500), null, 2));
  fs.writeFileSync(INSERTED_PATH, JSON.stringify(inserted.slice(-500), null, 2));

  console.log("");
  console.log("[futbin-cookie] DONE. stats:", stats);
  console.log("[futbin-cookie] state saved:", STATE_PATH);
  console.log("[futbin-cookie] inserts dump:", INSERTED_PATH);
  await browser.close();
}

main().catch((e) => {
  console.error("[fatal]", e.stack || e.message);
  process.exit(1);
});
