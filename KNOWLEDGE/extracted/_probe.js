const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.goto("https://www.futbin.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(7000);
  await page.goto("https://www.futbin.com/26/players?page=1", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  const title = await page.title();
  console.log("title:", title);
  const html = await page.content();
  const fs = require("fs");
  const path = require("path");
  fs.writeFileSync(path.resolve(__dirname, "futbin_p1.html"), html);
  await page.screenshot({ path: path.resolve(__dirname, "futbin_p1.png"), fullPage: true });
  console.log("html size:", html.length);
  // Probe likely selectors
  const samples = await page.evaluate(() => {
    const sel = [
      "table", "tbody tr", "a[href*='/26/player/']",
      ".player_name_players_table", ".player-nameval",
      "[data-price-num]", ".price", "img.playercard",
    ];
    const out = {};
    for (const s of sel) out[s] = document.querySelectorAll(s).length;
    // First player row sample
    const firstA = document.querySelector("a[href*='/26/player/']");
    return { counts: out, firstHref: firstA?.getAttribute("href"), firstText: firstA?.textContent?.trim() };
  });
  console.log("probe:", JSON.stringify(samples, null, 2));
  await browser.close();
})();
