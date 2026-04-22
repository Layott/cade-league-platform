const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", viewport:{width:1440,height:900} });
  const p = await c.newPage();

  for (const url of [
    "https://www.fut.gg/players/",
    "https://www.fut.gg/players/?page=2",
    "https://www.fut.gg/players/?page=50",
  ]) {
    await p.goto(url, { waitUntil:"domcontentloaded", timeout:45000 });
    await p.waitForTimeout(5000);
    const info = await p.evaluate(() => {
      const cards = document.querySelectorAll("[href*='/player/']");
      const first = cards[0];
      const sample = first ? { href: first.getAttribute("href"), outer: first.outerHTML.slice(0,800) } : null;
      const pricePattern = Array.from(document.querySelectorAll("*")).filter(e => {
        const t = (e.textContent||"").trim();
        return /^[\d.,]+\s*[KMB]?$/i.test(t) && t.length < 15 && t.length > 0;
      }).length;
      // Futgg uses Inertia / Next — maybe price info is in JSON blob
      const next = document.querySelector("#__NEXT_DATA__");
      return {
        cardCount: cards.length,
        title: document.title,
        sample,
        pricePattern,
        hasNextData: !!next,
        nextDataSize: next ? next.textContent.length : 0,
      };
    });
    console.log(url, "→", JSON.stringify(info, null, 2).slice(0, 1200));
    console.log("-----");
  }
  await b.close();
})();
