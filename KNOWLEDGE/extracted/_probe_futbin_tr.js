#!/usr/bin/env node
// Walk from each card anchor up to the closest <tr> and dump its full
// outerHTML. That's where the price columns actually live.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const OUT_PATH = path.resolve(__dirname, "_futbin_tr_probe.json");

(async () => {
  if (!fs.existsSync(PROFILE_DIR)) { console.error("run headful first"); process.exit(1); }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto("https://www.futbin.com/26/players?page=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(10000);

  const out = await page.evaluate(() => {
    // Find the first card anchor and walk up to the row container.
    const cardAnchor = document.querySelector("a.player-row-playercard, a[href*='/26/player/']");
    if (!cardAnchor) return { err: "no anchors" };
    let row = cardAnchor.closest("tr");
    if (!row) row = cardAnchor.closest("li");
    if (!row) row = cardAnchor.closest("div.row, div[class*='row']");
    if (!row) return { err: "no row ancestor", cardOuter: cardAnchor.outerHTML.slice(0, 3000) };

    const fullOuter = row.outerHTML;
    // All text nodes that match a coin / price shape, inside the row.
    const priceLikes = [];
    for (const el of row.querySelectorAll("*")) {
      const t = (el.textContent || "").trim();
      if (/^[\d,.]+\s*[KMB]?$/.test(t) && t.length > 0 && t.length < 12) {
        priceLikes.push({
          tag: el.tagName,
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 200),
          parent: el.parentElement ? el.parentElement.className?.toString().slice(0, 120) : null,
          text: t,
        });
      }
    }
    // Any element mentioning ps / xbox / pc / price keywords in class names
    const priceClasses = Array.from(row.querySelectorAll("*"))
      .map((e) => typeof e.className === "string" ? e.className : "")
      .filter((c) => /price|ps|xbox|pc|platform|coins?/i.test(c))
      .slice(0, 30);
    // Data attributes
    const dataAttrs = [];
    for (const el of [row, ...row.querySelectorAll("*")]) {
      for (const a of el.attributes || []) {
        if (/^data-/.test(a.name)) dataAttrs.push({ tag: el.tagName, attr: a.name, value: String(a.value).slice(0, 80) });
      }
    }
    return { fullOuter: fullOuter.slice(0, 15000), priceLikes, priceClasses, dataAttrs: dataAttrs.slice(0, 40) };
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`wrote ${OUT_PATH}`);
  console.log("priceLikes count:", (out.priceLikes || []).length);
  if (out.priceLikes) for (const p of out.priceLikes) console.log(` ${p.tag}.${p.cls.slice(0, 60)} = "${p.text}"`);
  console.log("priceClasses sample:", (out.priceClasses || []).slice(0, 10));
  await ctx.close();
})();
