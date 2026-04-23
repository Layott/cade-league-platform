const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile_p1");

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true, viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  // Pick a page known to have mostly normal gold cards (around r85 range).
  await page.goto("https://www.futbin.com/26/players", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  const rows = await page.evaluate(() => {
    // Grab 10 rows across the top of the list + scroll further if possible
    return Array.from(document.querySelectorAll("tr.player-row")).slice(0, 15).map((r) => {
      const name = r.querySelector("a.table-player-name")?.textContent?.trim();
      const imgs = Array.from(r.querySelectorAll("img")).map((i) => ({ class: i.className, src: (i.getAttribute("src") || "").slice(0, 120) }));
      const cardBgImg = r.querySelector("img.playercard-s-26-bg")?.getAttribute("src") || null;
      const playerCardDiv = r.querySelector(".playercard-26");
      let divBg = null;
      if (playerCardDiv) {
        const s = getComputedStyle(playerCardDiv);
        divBg = s.backgroundImage;
      }
      return { name, cardBgImg, divBg, imgCount: imgs.length, imgs: imgs.slice(0, 4) };
    });
  });
  console.log(JSON.stringify(rows, null, 2));
  await ctx.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
