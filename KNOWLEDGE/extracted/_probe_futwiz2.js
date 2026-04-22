const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", viewport:{width:1440,height:900}, locale:"en-US" });
  const page = await ctx.newPage();
  await page.goto("https://www.futwiz.com/en/fc26/players", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  const sample = await page.evaluate(() => {
    const firstLink = document.querySelector("a[href*='/player/']");
    const firstTile = firstLink?.closest("div, tr, li, article");
    const fields = {};
    if (firstTile) {
      fields.outerHTML = firstTile.outerHTML.slice(0, 2500);
      fields.text = firstTile.innerText.slice(0, 500);
    }
    // Hunt for any visible price pattern
    const priceEls = Array.from(document.querySelectorAll("*")).filter(e => {
      const t = e.innerText || "";
      return /^[0-9,]+\s*(coins)?$/i.test(t.trim()) && t.length < 20 && t.length > 1;
    }).slice(0, 5);
    fields.priceSamples = priceEls.map(e => ({tag: e.tagName, cls: e.className, text: e.innerText.trim()}));
    // Pagination
    const lastLink = document.querySelector("a[href*='page=']:last-of-type, .pagination a:last-of-type");
    fields.lastHref = lastLink?.getAttribute("href");
    // Is there a price attribute anywhere
    const priceAttrEls = document.querySelectorAll("[data-price], [data-coins], [data-value]");
    fields.priceAttrCount = priceAttrEls.length;
    return fields;
  });
  console.log(JSON.stringify(sample, null, 2));
  await browser.close();
})();
