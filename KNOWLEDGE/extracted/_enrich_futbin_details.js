#!/usr/bin/env node
// One-time Futbin detail-page enrichment.
//
// Walks every fc26_players row whose source_dataset='futbin.com' (the
// ~1,339 specials inserted from the list-page scrape) and visits that
// card's individual Futbin detail page to harvest:
//   * 6 main attrs (PAC/SHO/PAS/DRI/DEF/PHY) — GK variants for keepers
//   * All sub-attributes (Finishing, Vision, etc — 30+ per card)
//   * Weak foot / Skill moves / Preferred foot / Body type
//   * Playstyles + Playstyles+
//   * Chem styles available
//   * AcceleRATE type (Controlled / Explosive / Lengthy)
//   * Height / Weight / Age
//   * PS + Xbox + PC prices (all three platforms)
//   * SBC / Evolution / Untradeable flags
//
// Writes into `fc26_players.attributes` jsonb, preserving existing keys.
//
// Usage (after the headful warmup populates the Cloudflare profile):
//   node KNOWLEDGE/extracted/_enrich_futbin_details.js [--reset] [--rating-min N]
//
// Resumable: state file KNOWLEDGE/extracted/futbin_enrich_state.json tracks
// the last card id processed. Rerun picks up where it left off.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const STATE_PATH = path.resolve(__dirname, "futbin_enrich_state.json");
const FAILURES_PATH = path.resolve(__dirname, "futbin_enrich_failures.json");

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { done: [] }; } };
const saveState = (s) => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
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

// Detail-page extractor. Futbin has shifted this DOM several times — use
// tolerant selector chains. Each field falls through multiple candidates.
async function extractDetail(page) {
  return page.evaluate(() => {
    const text = (sel) => {
      for (const s of sel) {
        const e = document.querySelector(s);
        if (e) return e.textContent.trim();
      }
      return null;
    };
    const intt = (t) => { const n = parseInt((t || "").replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : null; };

    // 6 main attrs
    const mains = {};
    for (const k of ["PAC","SHO","PAS","DRI","DEF","PHY"]) {
      const el = document.querySelector(`#sub-${k.toLowerCase()} .subvaluesticks .ig-sub-number, .player-stat-${k.toLowerCase()} .player-stat-number, [data-stat='${k}']`);
      if (el) mains[k.toLowerCase()] = intt(el.textContent);
    }
    // Fallback: hunt attribute boxes by label
    if (Object.keys(mains).length < 6) {
      const labels = document.querySelectorAll(".player-stat-title, .mainstat-title, [class*='stat-name']");
      labels.forEach((lab) => {
        const name = lab.textContent.trim().toUpperCase();
        if (["PAC","SHO","PAS","DRI","DEF","PHY"].includes(name)) {
          const num = lab.parentElement?.querySelector(".player-stat-number, [class*='stat-number']");
          if (num) mains[name.toLowerCase()] = intt(num.textContent);
        }
      });
    }

    // Sub-attrs: scan any element with both a label + numeric value inside attribute panels.
    const subs = {};
    const panels = document.querySelectorAll(".sub-attributes, .player-attributes, [class*='sub-stat']");
    panels.forEach((panel) => {
      panel.querySelectorAll("[class*='sub']").forEach((e) => {
        const label = e.querySelector("[class*='label'], [class*='name']")?.textContent?.trim();
        const val = e.querySelector("[class*='value'], [class*='number']")?.textContent?.trim();
        if (label && val) subs[label.toLowerCase().replace(/\s+/g, "_")] = intt(val);
      });
    });

    // Prices (3 platforms)
    const prices = {};
    for (const plat of ["ps","xbox","pc"]) {
      const pEl = document.querySelector(`.platform-${plat}-only, [class*='price-${plat}'], [data-price-${plat}]`);
      if (pEl) {
        const raw = pEl.getAttribute(`data-price-${plat}`) || pEl.textContent.trim();
        prices[plat] = raw;
      }
    }
    // Fallback: LC-price / BIN
    const lc = document.querySelector(".lowest-current-price, [class*='lc-price']")?.textContent?.trim();
    if (lc) prices.lc = lc;

    // Meta
    const meta = {
      weakFoot: intt(text([".player-weakfoot", ".weak-foot-number", "[class*='weakfoot']"])),
      skillMoves: intt(text([".player-skillmoves", ".skill-moves-number", "[class*='skillmoves']"])),
      preferredFoot: text([".player-preferred-foot", "[class*='foot']"]),
      bodyType: text([".player-bodytype", "[class*='body-type']"]),
      heightCm: intt(text([".player-height", "[class*='height']"])),
      weightKg: intt(text([".player-weight", "[class*='weight']"])),
      age: intt(text([".player-age", "[class*='age']"])),
      accelerateType: text([".player-accelerate, [class*='accelerate']"]),
    };

    // Playstyles + Playstyles+
    const playstyles = Array.from(document.querySelectorAll(".playstyle-name, [class*='playstyle'] [class*='name']"))
      .map((e) => e.textContent.trim()).filter(Boolean);

    // Chem styles list (cards usually list their top-3 best chem styles)
    const chemStyles = Array.from(document.querySelectorAll(".chemstyle-name, [class*='chem-style'] [class*='name']"))
      .map((e) => e.textContent.trim()).filter(Boolean);

    // Card art
    const cardImg = document.querySelector("img.playercard, img[src*='players_html'], img[src*='/card/'], img[class*='card']");
    const cardImageUrl = cardImg ? cardImg.getAttribute("src") : null;

    // SBC / Evolution / Untradeable flags
    const bodyText = document.body?.textContent?.toLowerCase() || "";
    const flags = {
      sbcOnly: bodyText.includes("sbc only") || bodyText.includes("obtained from: sbc"),
      evolution: bodyText.includes("evolution") && bodyText.includes("requirements"),
      untradeable: bodyText.includes("untradeable"),
    };

    return { mains, subs, prices, meta, playstyles, chemStyles, cardImageUrl, flags };
  });
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const state = process.argv.includes("--reset") ? { done: [] } : loadState();
  const ratingMinArg = process.argv.indexOf("--rating-min");
  const ratingMin = ratingMinArg >= 0 ? parseInt(process.argv[ratingMinArg + 1], 10) : 0;

  if (!fs.existsSync(PROFILE_DIR)) {
    console.error("[enrich] Missing Chromium profile. Run the headful scraper first:");
    console.error("         node KNOWLEDGE/extracted/_scrape_futbin_headful.js");
    process.exit(1);
  }

  // Fetch the working set.
  const { data: rows, error } = await sb
    .from("fc26_players")
    .select("id, name, rating, attributes")
    .eq("source_dataset", "futbin.com")
    .gte("rating", ratingMin)
    .is("deleted_at", null)
    .order("rating", { ascending: false });
  if (error) { console.error("[enrich] DB read failed:", error.message); process.exit(1); }

  const todo = (rows || []).filter((r) => !state.done.includes(r.id));
  console.log(`[enrich] ${rows?.length ?? 0} futbin-sourced rows; ${todo.length} remaining to enrich.`);

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();

  // Warm
  try {
    await page.goto("https://www.futbin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
  } catch (e) {
    console.error("[enrich] warmup failed:", e.message);
    await ctx.close();
    process.exit(1);
  }

  const failures = [];
  let i = 0;
  const t0 = Date.now();
  for (const row of todo) {
    i++;
    const attrs = (row.attributes && typeof row.attributes === "object") ? row.attributes : {};
    const rid = attrs.futbin_resource_id;
    const slug = (attrs.futgg_slug || attrs.slug || row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "");
    if (!rid) { failures.push({ id: row.id, reason: "no futbin_resource_id" }); continue; }
    const url = `https://www.futbin.com/26/player/${rid}/${slug}`;

    await sleep(jitter());
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      const detail = await extractDetail(page);

      const newAttrs = {
        ...attrs,
        enrich_at: new Date().toISOString(),
        futbin_detail_url: url,
        mains: detail.mains,
        subs: detail.subs,
        platform_prices: detail.prices,
        meta: detail.meta,
        playstyles: detail.playstyles,
        chem_styles: detail.chemStyles,
        flags: detail.flags,
      };
      if (detail.cardImageUrl && !newAttrs.card_image_url) {
        newAttrs.card_image_url = detail.cardImageUrl.startsWith("http") ? detail.cardImageUrl : `https://www.futbin.com${detail.cardImageUrl}`;
      }
      // If PS price was parsed, update value_coins_estimate opportunistically.
      const coins = parseCoins(detail.prices.ps) || parseCoins(detail.prices.lc);
      const patch = { attributes: newAttrs, updated_at: new Date().toISOString() };
      if (coins) patch.value_coins_estimate = coins;

      await sb.from("fc26_players").update(patch).eq("id", row.id);
      state.done.push(row.id);
      if (i % 25 === 0) saveState(state);
      if (i % 10 === 0 || i < 3) {
        const rate = (i / ((Date.now() - t0) / 1000)).toFixed(2);
        console.log(`[enrich] ${i}/${todo.length} (${rate}/s): ${row.name} r${row.rating}`);
      }
    } catch (e) {
      failures.push({ id: row.id, name: row.name, url, reason: e.message });
      console.error(`[err] ${row.name}: ${e.message}`);
      await sleep(10000);
    }
  }

  saveState(state);
  fs.writeFileSync(FAILURES_PATH, JSON.stringify(failures, null, 2));
  console.log(`[enrich] done. enriched=${state.done.length} failures=${failures.length}`);
  await ctx.close();
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
