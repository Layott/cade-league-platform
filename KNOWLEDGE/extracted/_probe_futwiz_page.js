const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", viewport:{width:1440,height:900}, locale:"en-US" });
  const p = await c.newPage();

  // Try different pagination URL patterns.
  for (const url of [
    "https://www.futwiz.com/en/fc26/players",
    "https://www.futwiz.com/en/fc26/players?page=2",
    "https://www.futwiz.com/en/fc26/players/page/2",
    "https://www.futwiz.com/en/fc26/players/2",
  ]) {
    try {
      await p.goto(url, { waitUntil:"domcontentloaded", timeout:45000 });
      await p.waitForTimeout(3500);
      const stat = await p.evaluate(() => {
        const first = document.querySelector("a[href*='/fc26/player/']");
        const info = first?.getAttribute("data-card-info") || "";
        const lastA = Array.from(document.querySelectorAll("a")).map(a=>a.getAttribute("href")||"").filter(h=>h.includes("page=")||/\/\d+$/.test(h)).slice(0,10);
        return {
          playerCount: document.querySelectorAll("a[href*='/fc26/player/']").length,
          firstInfo: info.slice(0,200),
          pageLinks: lastA,
          title: document.title,
        };
      });
      console.log(url, "→", JSON.stringify(stat));
    } catch (e) { console.log(url, "err:", e.message); }
  }
  // Check if infinite-scroll triggers more
  await p.goto("https://www.futwiz.com/en/fc26/players", { waitUntil:"domcontentloaded", timeout:45000 });
  await p.waitForTimeout(3000);
  const before = await p.evaluate(() => document.querySelectorAll("a[href*='/fc26/player/']").length);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(3000);
  const after = await p.evaluate(() => document.querySelectorAll("a[href*='/fc26/player/']").length);
  console.log("scroll before:", before, "after:", after);
  await b.close();
})();
