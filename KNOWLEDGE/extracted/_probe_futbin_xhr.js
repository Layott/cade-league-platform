#!/usr/bin/env node
// Intercept Futbin's XHR price calls.
// Loads /26/players?page=1, waits 15s for lazy hydration, logs every
// network request whose URL contains "price" or "Prices" or has a
// JSON response with coin-like shape. Dumps to _futbin_xhr.json.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile");
const OUT_PATH = path.resolve(__dirname, "_futbin_xhr.json");

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

  const calls = [];
  page.on("response", async (resp) => {
    try {
      const url = resp.url();
      const ct = resp.headers()["content-type"] || "";
      if (!/json/.test(ct) && !/price/i.test(url)) return;
      // Only grab JSON responses from futbin
      if (!/futbin/.test(url)) return;
      const status = resp.status();
      let body = null;
      try { body = await resp.text(); } catch {}
      calls.push({
        url, status, ct,
        bodyPreview: body ? body.slice(0, 1500) : null,
        bodySize: body ? body.length : 0,
      });
    } catch {}
  });

  await page.goto("https://www.futbin.com/26/players?page=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  console.log("waiting 15s for price hydration...");
  await page.waitForTimeout(15000);

  // Also probe what the prices look like NOW (after hydration) in the DOM
  const after = await page.evaluate(() => {
    let rows = Array.from(document.querySelectorAll("tr.player_tr_1, tr.player_tr_2"));
    if (rows.length === 0) rows = Array.from(document.querySelectorAll("a[href*='/26/player/']"));
    return rows.slice(0, 2).map((r) => r.outerHTML.slice(0, 3500));
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify({ calls, firstRowsAfterWait: after }, null, 2));
  console.log(`xhr calls captured: ${calls.length}`);
  console.log("top-10 candidate URLs:");
  for (const c of calls.slice(0, 10)) {
    console.log(`  [${c.status}] ${c.url}  (${c.bodySize}B)`);
    if (c.bodyPreview && /price|Price|ps|pc/i.test(c.bodyPreview)) {
      console.log(`     preview: ${c.bodyPreview.slice(0, 250).replace(/\s+/g, " ")}`);
    }
  }
  console.log(`\nFull dump at: ${OUT_PATH}`);
  await ctx.close();
})();
