#!/usr/bin/env node
// Dump the first 3 player rows' outerHTML + all price-like text candidates
// from Futbin /26/players?page=1. Uses the persistent Chromium profile.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const OUT_PATH = path.resolve(__dirname, "_futbin_row_probe.json");

(async () => {
  if (!fs.existsSync(PROFILE_DIR)) {
    console.error("Profile missing — run _scrape_futbin_headful.js first.");
    process.exit(1);
  }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // visible so Cloudflare stays happy
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto("https://www.futbin.com/26/players?page=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);

  const rowSample = await page.evaluate(() => {
    // Same row discovery as main scraper
    let rows = Array.from(document.querySelectorAll("tr.player_tr_1, tr.player_tr_2"));
    if (rows.length === 0) rows = Array.from(document.querySelectorAll("table.players_table tbody tr, table#repTb tbody tr"));
    if (rows.length === 0) rows = Array.from(document.querySelectorAll("a[href*='/26/player/']"));

    const first3 = rows.slice(0, 3).map((row) => {
      const outer = row.outerHTML.slice(0, 4000);

      // Hunt ALL elements whose text looks like a coin value (e.g. "70,000", "1.5M", "11K").
      const priceLikes = [];
      for (const el of row.querySelectorAll("*")) {
        const t = (el.textContent || "").trim();
        if (/^[\d,.]+\s*[KMB]?$/.test(t) && t.length > 0 && t.length < 12) {
          priceLikes.push({
            tag: el.tagName,
            cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 120),
            attrs: Array.from(el.attributes).map((a) => `${a.name}="${String(a.value).slice(0, 60)}"`).slice(0, 8),
            text: t,
          });
        }
      }
      // Also hunt data-* attributes on row + children that might carry the price.
      const dataAttrs = [];
      for (const el of [row, ...row.querySelectorAll("*")]) {
        for (const a of el.attributes || []) {
          if (/^data-.*price|^data-.*coin|^data-.*value/i.test(a.name)) {
            dataAttrs.push({ tag: el.tagName, attr: a.name, value: String(a.value).slice(0, 80) });
          }
        }
      }
      return { outer, priceLikes: priceLikes.slice(0, 30), dataAttrs: dataAttrs.slice(0, 30) };
    });
    return first3;
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(rowSample, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Rows sampled: ${rowSample.length}`);
  if (rowSample[0]) {
    console.log("\nFirst row price-like candidates:");
    for (const p of rowSample[0].priceLikes) console.log(`  ${p.tag}.${p.cls.slice(0,60)} = "${p.text}"`);
    console.log("\nFirst row data-* price/coin attributes:");
    for (const d of rowSample[0].dataAttrs) console.log(`  ${d.tag}[${d.attr}] = "${d.value}"`);
  }
  await ctx.close();
})();
