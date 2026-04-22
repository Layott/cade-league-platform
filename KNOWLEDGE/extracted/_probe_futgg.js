const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  const page = await ctx.newPage();
  // 1. fut.gg
  try {
    await page.goto("https://www.fut.gg/players/?page=1", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const html = await page.content();
    fs.writeFileSync(path.resolve(__dirname, "futgg_p1.html"), html);
    console.log("[fut.gg] size:", html.length, "title:", await page.title());
    const counts = await page.evaluate(() => {
      return {
        playerCards: document.querySelectorAll("[href*='/player/']").length,
        priceTags: document.querySelectorAll("[class*='price'], [class*='coin']").length,
        tableRows: document.querySelectorAll("tr").length,
      };
    });
    console.log("[fut.gg] counts:", JSON.stringify(counts));
  } catch (e) {
    console.error("[fut.gg] err:", e.message);
  }
  // 2. futwiz
  try {
    await page.goto("https://www.futwiz.com/en/fc26/players", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const html = await page.content();
    fs.writeFileSync(path.resolve(__dirname, "futwiz_p1.html"), html);
    console.log("[futwiz] size:", html.length, "title:", await page.title());
    const counts = await page.evaluate(() => ({
      playerCards: document.querySelectorAll("[href*='/player/']").length,
      priceTags: document.querySelectorAll("[class*='price']").length,
      tableRows: document.querySelectorAll("tr").length,
    }));
    console.log("[futwiz] counts:", JSON.stringify(counts));
  } catch (e) {
    console.error("[futwiz] err:", e.message);
  }
  await browser.close();
})();
