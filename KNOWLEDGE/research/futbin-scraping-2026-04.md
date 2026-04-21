# Futbin scraping feasibility — 2026-04 research

Question: can CADE scrape Futbin (or peers) for **player card visuals** + **player data** to automate squad validation?

## TL;DR

**Don't scrape Futbin directly.** Three reasons: (1) Futbin's ToS forbids commercial reuse + reserves EA card visuals to EA, (2) Futbin sits behind Cloudflare + returned 403 to a non-browser fetch in this research, (3) Futbin entered an official EA "community fansite agreement" in 2025 — they're now an EA-blessed partner, so any unlicensed scraper is effectively scraping EA's licensed data and the legal posture worsened.

**Recommended path:** ingest one of the **community-maintained Kaggle FC 26 player datasets** for static metadata (rating / position / nation / club / value) + **build CADE's own card template** (rebuild EA's card look in our brand colours so we never copy EA art) + **keep manual squad-screenshot flow** for live FUT-coin prices (the only thing Kaggle dumps don't track in real time).

---

## Source-by-source findings

### Futbin (https://www.futbin.com)

- **robots.txt:** allows Google + AmazonAdBot fully. Everyone else: `Disallow: /*?*` blocks every URL with a query string + blocks `/players/*?*` + `/*/players/*?*`. Implication: filtered/paginated player browsing forbidden to non-Google bots.
- **ToS:** "FUTBIN owns the FUTBIN branding and published materials, with the exception of FIFA and EA Sports assets, which are the property of their respective owners." Personal-use download only. "Must not modify the paper or digital copies… must not use any illustrations, photographs, video or audio sequences or any graphics separately from any accompanying text." Commercial scraping = breach.
- **Anti-bot:** direct WebFetch on `https://www.futbin.com/26/player/74/lionel-messi` returned **HTTP 403** without browser headers. Cloudflare challenge active.
- **EA partnership (2025, Sportico):** EA + Futbin signed a "community fansite agreement" sharing official game data. EA: *"We're pleased to have a community fansite agreement in place with Futbin along with several other community websites, which allows them to provide data to our community of players."* Futbin is now licensed; circumventing them with a scraper risks coordinated takedown.
- **Apify "Futbin Player Details Scraper":** third-party paid actor, $9/1000 results. Last updated ~19d ago. Anti-blocking proxy bundled. Outsources risk + cost. Acceptable as escape hatch but not recommended primary.

### FUT.GG (https://www.fut.gg)

- **robots.txt:** explicitly `Disallow: /api/*`, `Disallow: /accounts/*`, `Disallow: /admin/*`, `Disallow: /tier-list/free/`. Player pages NOT blocked. So technically `https://www.fut.gg/players/<slug>/` is permitted.
- **Rendering:** filter-first — landing page shows "Apply a filter to get started…", actual player rows load via client-side XHR. Server-side scrape returns the empty shell. Would need Playwright/Puppeteer to scrape fully rendered.
- **ToS:** not deeply researched here, but mirrors Futbin in spirit (data tied to EA).

### SoFIFA (https://sofifa.com)

- **API docs page** (`/document`) returned 403 in this session (cookie/referrer gated). The fact docs exist suggests a semi-official API behind a key.
- **Open-source scrapers** that work today:
  - `prashantghimire/sofifa-web-scraper` — Python + Playwright, 18k+ players, EA FC 25 covered, recent activity.
  - `probberechts/soccerdata` — multi-source scraper (FBref, Sofascore, SoFIFA, Understat, WhoScored). Battle-tested PyPI package.
  - `sagunsh/sofifa-scraper` — older/smaller.
- SoFIFA is **career-mode** focused — has player ratings + attributes but NO FUT-specific data (chemistry styles, evolutions, untradeable flags, current FUT coin price). Useful for ratings/stats but won't validate FUT squads alone.

### EA's own APIs

- **Pro Clubs API** — public for some partners (e.g. Virtual Pro Gaming integration documented on EA forums). Per-match player data.
- **Ultimate Team API** — **not publicly available**. EA forum threads from 2024-2026 show repeated community requests that EA has not granted. Only the unofficial private FUT WebApp endpoints exist (require player auth; brittle; against ToS to scrape).
- No esports licensing program for non-pro leagues that would grant CADE official UT data access. Would have to apply to EA's community-fansite program (the same program Futbin joined). Long shot for a 13-player league.

### Community Kaggle dumps

Multiple FC 26 datasets actively maintained. Best candidates:
- `rovnez/fc-26-fifa-26-player-data`
- `flynn28/eafc26-player-database`
- `talhademirezen/fc-26-player-stats`
- `yusufhanakr/fc-26-premier-league-player-dataset-unofficial`

Typical shape (from prior FC dumps): ~18,000 players × ~110 attributes (rating, position, work_rate, weak_foot, skill_moves, all 6 main + sub stats, club, league, nation, age, value_eur, wage_eur, body_type, real_face flag, etc). License usually CC-0 or CC-BY-SA on the Kaggle metadata. Underlying data still EA's, but personal/research use is the broadly-accepted norm.

Update cadence: monthly-ish per dataset author. Live FUT-coin price NOT tracked (those move hourly with the in-game market). Card-art images NOT included.

### Card visual copyright

EA owns the card art (background tints, layout, position blocks, chemistry diamonds). Futbin renders them using EA's templates under the new licensing agreement — they can serve them; we cannot redistribute them without a license.

**Safe path:** build CADE's own player card visual that re-uses player metadata (name, rating, position, stats) but renders in CADE brand styling (signal-green `#6bcd06` + pink `#fe036d` + Agharti display font). This is what every non-licensed FUT site that wants to display info should do. Already aligns with Plan 16 player-card overlay template.

**Risky path:** cache + serve EA-rendered card PNGs (e.g. `https://cdn.futbin.com/content/fifa26/img/players/<id>.png`). DMCA exposure from both EA + Futbin.

---

## Alternatives matrix

| Source | API/scrape posture | robots-permissive | Last-active | Our assessment |
|---|---|---|---|---|
| Futbin | Cloudflare 403; ToS forbids; EA partner | No (`*?*` blocked) | live | DON'T scrape |
| FUT.GG | XHR-rendered; needs Playwright; `/api/*` blocked | partial | live | possible if Playwright + low rate |
| SoFIFA | gated API + open scrapers | n/a | active scrapers | OK for static stats; no FUT prices |
| Kaggle FC 26 dumps | free CSV download | n/a | monthly | **recommended baseline** |
| `probberechts/soccerdata` (PyPI) | clean Python wrapper over multiple sites | varies | actively maintained | good fallback for stats |
| EA Pro Clubs API | partner-only | n/a | live | not for UT validation |
| EA Ultimate Team API | not public | n/a | n/a | unavailable |
| Apify Futbin actor | paid $9/1000 | n/a | ~19d ago | escape hatch only |
| FutDatabase.com | public API, freemium | n/a | live | worth evaluating; their full API is paid |
| FUTNext | community DB | n/a | live | similar to FUT.GG |
| FIFA Index | static | live | live | UI-only, no API |

---

## Recommended approach (if user says "go build it")

### Phase A — Baseline (1-2 days, no legal risk)

1. **Pick a Kaggle FC 26 dataset.** Compare row counts / attribute coverage / freshness across the 4 candidates. Pick the most complete.
2. **Add migration `2026MMDDNN_fc26_players.sql`** — table `fc26_players (id, name, slug, rating, position, club, league, nation, value_coins_estimate, work_rate, weak_foot, skill_moves, item_type, nationality_iso, body_type, attributes_jsonb, source_dataset_url, imported_at)`. Audit-triggered, soft-delete.
3. **GitHub Action `fc26-refresh.yml`** — monthly cron. Downloads chosen Kaggle dataset via `kaggle` CLI (auth via `KAGGLE_KEY` org secret), normalizes CSV → SQL upsert, opens PR with diff. Manual approval before merge.
4. **Server module `apps/web/src/server/fcdb/`:**
   - `lookup.ts` — `findPlayer({name, rating, position?, club?}): FCPlayer | null` with fuzzy match + ambiguity resolution.
   - `validate.ts` — `validateSubmittedSquad(items, rule)` extends Plan 10's `evaluateRules` with DB-resolved item validity.
   - `lookup.test.ts` — fuzzy-match fixtures.
5. **Wire into `/admin/squads/[id]` review page** — already shows hand-transcribed items; now flag any item where `findPlayer()` returned null (typo/non-existent player) or where rating/position mismatch.

Keeps existing Plan 10 manual-screenshot workflow intact; layers automated cross-check on top.

### Phase B — CADE-branded card template (1 day)

1. **Build `<CadePlayerCard>` React component** — overlay-grade, renders `{name, rating, position, club, nation, attributes}` with Agharti display + `--primary`/`--secondary` tints. NO EA assets.
2. **Use it in:** `/players/[id]` public profile, Plan 16 `player-card` overlay, `/admin/squads/[id]` review previews.
3. Asset-license-clean. Future-proof against EA/Futbin enforcement.

### Phase C — Live coin prices (optional, deferred)

1. Live FUT market prices change hourly. Plan 10's manual screenshot flow already captures the squad value at submission time (the screenshot itself is the source of truth for budget compliance, since the rule is "10M coin budget at squad submission"). No automation strictly required.
2. If user later wants live prices: pay for an Apify Futbin actor run on demand ($9/1000 = trivial cost for 13 players × weekly = $1.40/yr). Outsources legal/anti-bot risk to Apify.

### What NOT to do

- Don't scrape Futbin/FUT.GG headlessly at scale. ToS + Cloudflare + EA partnership = legal/operational risk for CADE.
- Don't cache EA-rendered card PNGs. DMCA exposure.
- Don't try to reverse-engineer the EA WebApp/UT private API. That genuinely violates EA's ToS and risks bans of admin EA accounts.

---

## Legal + IP summary

- **Player metadata** (name, rating, attributes, club, nation, value): facts about EA's product. Not copyrightable individually; widely available on free Kaggle dumps + community sites. CADE using them for league validation = low risk.
- **Card art** (templates, backgrounds, position blocks, chemistry diagrams, EA fonts): EA copyright. Don't copy/cache/redistribute. Build our own.
- **Live FUT coin prices:** Futbin's proprietary market data (their crowd-sourced + scraping infra). They're now EA-licensed. Don't scrape; if needed, pay Apify or use the manual screenshot.
- **Apply to EA's community-fansite program:** if CADE ever wants official data access, this is the path. Application process not publicly documented; would need direct contact via EA Sports business development. Worth a try later; not blocking now.

---

## Action items (ranked, if green-lit)

1. **Plan 21 (small):** ingest one Kaggle FC 26 dataset → DB. New `server/fcdb/` module + lookup tests. ~1 day.
2. **Plan 22 (small):** build `<CadePlayerCard>` component + use in Plan 16 `player-card` overlay + `/players/[id]`. ~0.5 day.
3. **Plan 23 (medium):** wire `fcdb.findPlayer` validation into `/admin/squads/[id]` review — flag transcription mismatches. ~1 day.
4. **Plan 24 (defer):** evaluate Apify Futbin actor for live prices. Optional.
5. **Plan 25 (defer):** apply to EA community-fansite program. Optional, async.

---

## Sources

- Futbin robots.txt — fetched live
- Futbin ToS summary — search engines (Bing index of futbin.com/tos)
- Futbin player page 403 — confirmed via direct WebFetch
- FUT.GG robots.txt — fetched live
- FUT.GG players page rendering — fetched live (filter-first XHR)
- Sportico (May 2025) "Futbin Capitalizes as EA Sports FC Softens Third-Party App Stance" — EA-Futbin licensing partnership
- EA Forums multiple threads — Pro Clubs API partner-only, UT API not public
- Kaggle FC 26 datasets — `rovnez`, `flynn28`, `talhademirezen`, `yusufhanakr`
- GitHub `prashantghimire/sofifa-web-scraper` — Playwright + 18k players, FC 25
- GitHub `probberechts/soccerdata` — multi-source PyPI scraper
- Apify `getdataforme/futbin-player-details-scraper` — paid actor, $9/1000
