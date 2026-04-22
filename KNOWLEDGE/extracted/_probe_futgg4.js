const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36" });
  const p = await c.newPage();
  await p.goto("https://www.fut.gg/players/?page=1", { waitUntil:"domcontentloaded", timeout:45000 });
  await p.waitForTimeout(5000);
  // Walk up DOM from each price cell to find the player card wrapper
  const cards = await p.evaluate(() => {
    const priceEls = Array.from(document.querySelectorAll("div")).filter(d => /^[\d.,]+\s*[KMB]?$/i.test(d.textContent.trim()) && d.textContent.trim().length < 12 && d.textContent.trim().length > 0);
    const seen = new Set();
    const results = [];
    for (const el of priceEls.slice(0, 8)) {
      // Walk up 5 levels to find the player card wrapper
      let cur = el;
      let cardWrap = null;
      for (let i = 0; i < 8; i++) {
        cur = cur.parentElement;
        if (!cur) break;
        if (cur.tagName === "A" && (cur.getAttribute("href")||"").includes("/players/")) { cardWrap = cur; break; }
        if (cur.getAttribute("data-player-id") || cur.getAttribute("data-eaid")) { cardWrap = cur; break; }
      }
      if (!cardWrap || seen.has(cardWrap)) continue;
      seen.add(cardWrap);
      results.push({
        price: el.textContent.trim(),
        cardHref: cardWrap.getAttribute("href") || null,
        cardText: (cardWrap.innerText||"").split("\n").slice(0,12).join(" | "),
        outer: cardWrap.outerHTML.slice(0, 1500),
      });
    }
    return results;
  });
  console.log(JSON.stringify(cards, null, 2).slice(0, 4000));
  await b.close();
})();
