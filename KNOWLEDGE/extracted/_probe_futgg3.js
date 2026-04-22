const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36" });
  const p = await c.newPage();
  await p.goto("https://www.fut.gg/players/", { waitUntil:"domcontentloaded", timeout:45000 });
  await p.waitForTimeout(5000);
  const info = await p.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll("a")).map(a=>a.getAttribute("href")||"").filter(h=>h.length>0);
    const unique = [...new Set(allLinks)].slice(0, 20);
    // Hunt for player cards by text content pattern
    const sample = Array.from(document.querySelectorAll("*")).filter(e => {
      const t = (e.textContent||"").trim();
      return /^[\d.,]+\s*K$/i.test(t) || /^[\d.,]+\s*M$/i.test(t);
    }).slice(0, 5).map(e => ({
      tag: e.tagName,
      cls: e.className?.slice(0,100),
      text: e.textContent.trim(),
      parentCls: e.parentElement?.className?.slice(0,100),
      parentTag: e.parentElement?.tagName,
    }));
    // Look for pagination link patterns
    const pagers = allLinks.filter(h => /page=|\/page\//.test(h)).slice(0, 10);
    return { links: unique, priceCells: sample, pagers };
  });
  console.log(JSON.stringify(info, null, 2).slice(0, 2500));
  await b.close();
})();
