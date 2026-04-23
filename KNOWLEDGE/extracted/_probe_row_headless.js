const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PROFILE_DIR = path.resolve(__dirname, ".futbin_chromium_profile_p1");

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.goto("https://www.futbin.com/26/players", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.player-row"));
    if (rows.length === 0) {
      return { error: "no player-row elements", title: document.title, bodyStart: document.body.innerHTML.slice(0, 500) };
    }
    // Dump first 3 rows' outerHTML + a decomposed view of where the card frame art lives.
    return rows.slice(0, 3).map((r) => {
      const allImgs = Array.from(r.querySelectorAll("img")).map((i) => ({
        class: i.className,
        src: i.getAttribute("src"),
      }));
      const allBgDivs = Array.from(r.querySelectorAll("div, span")).filter((el) => {
        const s = getComputedStyle(el).backgroundImage;
        return s && s !== "none";
      }).map((el) => ({
        tag: el.tagName.toLowerCase(),
        class: el.className,
        bg: getComputedStyle(el).backgroundImage,
      }));
      return {
        outerHTML: r.outerHTML.slice(0, 2500),
        allImgs,
        allBgDivs,
      };
    });
  });

  fs.writeFileSync(path.resolve(__dirname, "_futbin_row_dump.json"), JSON.stringify(info, null, 2));
  console.log("wrote _futbin_row_dump.json");
  if (info.error) console.log("probe error:", info.error);
  else console.log("sample imgs on first row:", JSON.stringify(info[0].allImgs, null, 2));
  await ctx.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
