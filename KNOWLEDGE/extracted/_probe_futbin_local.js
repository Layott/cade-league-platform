#!/usr/bin/env node
// Dump the live Futbin /26/players?page=1 HTML + a selector sniff.
// Run this on the user's local machine (VPN up) so we can see the real
// DOM and write an extractor that matches.
//
// Usage: node KNOWLEDGE/extracted/_probe_futbin_local.js
//
// Output:
//   KNOWLEDGE/extracted/_futbin_probe_p1.html  (full HTML of page 1)
//   KNOWLEDGE/extracted/_futbin_probe_p1.png   (full-page screenshot)
//   stdout: selector sniff — how many of each candidate selector matches.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  console.log("[probe] warming home page...");
  await page.goto("https://www.futbin.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(10000);
  console.log("[probe] home title:", await page.title());

  console.log("[probe] fetching /26/players?page=1 ...");
  await page.goto("https://www.futbin.com/26/players?page=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(15000);

  const title = await page.title();
  const html = await page.content();
  const htmlOut = path.resolve(__dirname, "_futbin_probe_p1.html");
  const pngOut = path.resolve(__dirname, "_futbin_probe_p1.png");
  fs.writeFileSync(htmlOut, html);
  await page.screenshot({ path: pngOut, fullPage: true });

  console.log(`[probe] title: "${title}"`);
  console.log(`[probe] html size: ${html.length} bytes`);
  console.log(`[probe] wrote: ${htmlOut}`);
  console.log(`[probe] wrote: ${pngOut}`);

  const sel = await page.evaluate(() => {
    const pick = (q) => document.querySelectorAll(q).length;
    const sniff = {
      anchor_player: pick("a[href*='/26/player/']"),
      anchor_player_any: pick("a[href*='/player/']"),
      players_table: pick("table.players_table"),
      repTb: pick("table#repTb"),
      tr_player1: pick("tr.player_tr_1"),
      tr_player2: pick("tr.player_tr_2"),
      tbody_tr: pick("tbody tr"),
      data_price_ps: pick("[data-price-ps]"),
      data_price_num: pick("[data-price-num]"),
      pcdisplay_rat: pick(".pcdisplay-rat"),
      pcdisplay_pos: pick(".pcdisplay-pos"),
      pcdisplay_rev: pick(".pcdisplay-rev"),
      price_platform_ps: pick(".platform-ps-only, .price.platform-ps-only"),
      td_player: pick("td.player"),
      img_playercard: pick("img.playercard, img[src*='players_html']"),
      div_data_react: pick("div[data-react-root], #root, #__next"),
      total_tables: pick("table"),
      total_anchors: pick("a"),
    };
    // First anchor sample for reverse-engineering
    const first = document.querySelector("a[href*='/26/player/']") || document.querySelector("a[href*='/player/']");
    const sample = first ? { href: first.getAttribute("href"), outer: first.outerHTML.slice(0, 1000) } : null;
    return { sniff, sample };
  });

  console.log("[probe] selector sniff:");
  for (const [k, v] of Object.entries(sel.sniff)) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }
  if (sel.sample) {
    console.log("[probe] first player anchor:");
    console.log("   href:", sel.sample.href);
    console.log("   outer:", sel.sample.outer);
  } else {
    console.log("[probe] NO player anchors found on the page.");
  }
  await browser.close();
})();
