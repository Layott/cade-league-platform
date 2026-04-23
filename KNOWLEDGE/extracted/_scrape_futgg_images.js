#!/usr/bin/env node
// fut.gg image + variant backfill — walks /players/?page=N and captures the
// card's CDN image URL + the full variant label for every card anchor.
//
// For each card on the page we pull:
//   - href  →  /players/<eaId>-<slug>/26-<cardId>/
//   - img   →  src = https://game-assets.fut.gg/cdn-cgi/image/…/26-<cardId>.<hash>.webp
//   - alt   →  "<DisplayName> - <OVR> - <Variant>"
//
// The hash segment is content-addressed and cannot be guessed, so we must
// capture it from the DOM. We then match each card row to an existing
// fc26_players row by (source_row_id = futgg_26_<cardId>) — keyed from the
// Plan 30 scraper that ran earlier. Falls back to (slug + rating) if the
// source_row_id is absent (covers rows imported from Kaggle only). Updates
// attributes.card_image_url + attributes.futgg_variant; preserves all other
// attribute keys. Idempotent — skips rows that already carry both keys.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const STATE_PATH = path.resolve(__dirname, "futgg_images_state.json");
const UNMATCHED_PATH = path.resolve(__dirname, "futgg_images_unmatched.json");
const LIST_URL = (p) => `https://www.fut.gg/players/?page=${p}`;
const DELAY_MIN = 1800;
const DELAY_JITTER = 1200;
const FUTGG_DATASET = "https://www.fut.gg/";

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const loadState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { lastPage: 0 }; }
};
const saveState = (s) => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
const stripD = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const slugify = (n) => stripD(n || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MIN + Math.floor(Math.random() * DELAY_JITTER);

// Normalise the CDN URL. fut.gg wraps the asset in an /cdn-cgi/image/ prefix
// that applies on-the-fly resizing; we keep the raw URL as served so the
// browser can request whatever size it wants.
function normaliseImageUrl(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s.startsWith("http")) return null;
  return s;
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
      if (!img) continue;
      const alt = img.getAttribute("alt") || "";
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      const srcset = img.getAttribute("srcset") || "";
      const altM = alt.match(/^(.+?)\s+-\s+(\d+)\s+-\s+(.+)$/);
      if (!altM) continue;
      const displayName = altM[1].trim();
      const rating = parseInt(altM[2], 10);
      const variant = altM[3].trim();
      out.push({ eaId, urlSlug: slug, cardId, displayName, rating, variant, src, srcset });
    }
    const pagers = Array.from(document.querySelectorAll("a[href*='?page=']"))
      .map(a => { const m = (a.getAttribute("href") || "").match(/page=(\d+)/); return m ? parseInt(m[1], 10) : 0; });
    return { rows: out, maxPage: pagers.length ? Math.max(...pagers) : null };
  });
}

async function backfill(sb, rows, stats, unmatched) {
  for (const r of rows) {
    const imageUrl = normaliseImageUrl(r.src);
    if (!imageUrl || !r.variant) { stats.noImage++; continue; }

    // Primary lookup: source_row_id set by Plan 30 scraper.
    const futggSourceRowId = `futgg_26_${r.cardId}`;
    let { data: exist } = await sb
      .from("fc26_players")
      .select("id, attributes")
      .eq("source_dataset", FUTGG_DATASET)
      .eq("source_row_id", futggSourceRowId)
      .is("deleted_at", null)
      .maybeSingle();

    // Fallback: (slug + rating) — covers rows imported from Kaggle whose
    // source_row_id never got stamped with the fut.gg card id.
    if (!exist) {
      const slug = slugify(r.displayName);
      const { data: byName } = await sb
        .from("fc26_players")
        .select("id, attributes")
        .eq("slug", slug)
        .eq("rating", r.rating)
        .is("deleted_at", null)
        .limit(1);
      if (byName && byName.length > 0) exist = byName[0];
    }

    if (!exist) {
      unmatched.push({ cardId: r.cardId, name: r.displayName, rating: r.rating, variant: r.variant });
      stats.unmatched++;
      continue;
    }

    const attrs = (exist.attributes && typeof exist.attributes === "object") ? { ...exist.attributes } : {};

    // Idempotent: skip if both keys already set AND the image URL is present.
    if (attrs.card_image_url && attrs.futgg_variant) { stats.alreadyHad++; continue; }

    attrs.card_image_url = imageUrl;
    attrs.futgg_variant = r.variant;
    attrs.futgg_card_id = r.cardId;

    const { error } = await sb
      .from("fc26_players")
      .update({ attributes: attrs, updated_at: new Date().toISOString() })
      .eq("id", exist.id);
    if (error) { stats.errors++; continue; }
    stats.updated++;
  }
}

async function main() {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const state = process.argv.includes("--reset") ? { lastPage: 0 } : loadState();
  const unmatched = [];
  const stats = { pages: 0, rows: 0, updated: 0, alreadyHad: 0, unmatched: 0, noImage: 0, errors: 0 };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  const page = await ctx.newPage();

  let totalPages = 165;
  for (let p = state.lastPage + 1; p <= totalPages; p++) {
    if (p > state.lastPage + 1 || p === 1) await sleep(jitter());
    try {
      await page.goto(LIST_URL(p), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2500);
      const { rows, maxPage } = await extractPage(page);
      if (maxPage && p === 1) {
        totalPages = maxPage;
        console.log(`[futgg-img] discovered totalPages=${totalPages}`);
      }
      if (rows.length === 0) { console.log(`[futgg-img] p${p}: 0 rows — stopping.`); break; }
      stats.rows += rows.length;
      stats.pages++;
      await backfill(sb, rows, stats, unmatched);
      state.lastPage = p;
      if (p % 10 === 0) saveState(state);
      if (p % 5 === 0 || p < 5) {
        console.log(`[futgg-img] p${p}/${totalPages}: +${rows.length} | upd=${stats.updated} had=${stats.alreadyHad} un=${stats.unmatched} ni=${stats.noImage} err=${stats.errors}`);
      }
    } catch (e) {
      console.error(`[err] p${p}:`, e.message);
      await sleep(8000);
    }
  }

  saveState(state);
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify(unmatched.slice(0, 500), null, 2));
  console.log("[futgg-img] done:", stats);
  await browser.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
