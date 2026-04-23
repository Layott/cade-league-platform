#!/usr/bin/env node
// Dump the first 3 player-row inner HTML blocks from a live Futbin page.
// Uses an existing warmed Chromium profile so no fresh CF solve needed.
//
// Usage:
//   node KNOWLEDGE/extracted/_probe_futbin_row_html.js

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile_p1");

async function main() {
  if (!fs.existsSync(PROFILE_DIR)) {
    console.error("profile dir missing:", PROFILE_DIR);
    process.exit(1);
  }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.goto("https://www.futbin.com/26/players", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);

  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll("tr.player-row")).slice(0, 3);
    return trs.map((r) => r.outerHTML);
  });

  const out = path.resolve(__dirname, "_futbin_row_dump.html");
  fs.writeFileSync(out, rows.join("\n\n<!-- ROW BREAK -->\n\n"));
  console.log(`wrote ${rows.length} rows to ${out}`);
  await ctx.close();
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
