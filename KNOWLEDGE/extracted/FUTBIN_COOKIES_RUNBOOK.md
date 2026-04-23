# Futbin Cookie-Injection Scraper — Runbook

**Script:** `KNOWLEDGE/extracted/_scrape_futbin_cookies.js`
**Purpose:** Scrape every FC26 card variant from Futbin (base + promos + icons + heroes + FUT Birthday + TOTY …) with live PS4/5 + PC prices and card images. Writes into `public.fc26_players` and INSERTs new rows for variants that don't exist yet.

---

## Why this scraper

Previous scrapers (`_scrape_futbin_playwright.js`, `_scrape_futgg_images.js`) only covered ~19 % of the FC26 catalogue because:
- Cloudflare's JS challenge auto-solve was flaky → most pages came back blank.
- Those scripts only **UPDATE** existing rows, never **INSERT**. Promo variants (FUT Birthday Ronaldo, TOTY Mbappé, Icon Ultimate Pelé …) have their own Futbin `resourceId` and were silently dropped.

This scraper replays cookies from the user's real browser (already Cloudflare-cleared) and INSERTs every new variant it finds, keyed on `(source_dataset='futbin.com', source_row_id='futbin_<resourceId>')`.

---

## Prerequisites

- Node 20+, repo deps installed (`playwright`, `@supabase/supabase-js`).
- Playwright Chromium download already cached (it is, from `_scrape_futbin_playwright.js`).
- `apps/web/.env.local` with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Residential / VPN IP — data-center IPs get the hardest Cloudflare challenges.

---

## Step 1 — Export cookies from your real browser

1. Open **Chrome / Edge / Firefox in your normal profile** (not incognito).
2. Visit `https://www.futbin.com/26/players`.
3. Wait until the player table renders. If Cloudflare prompts, solve it. Refresh once to confirm the site loads without challenge.
4. Open DevTools → **Application** (Chrome) / **Storage** (Firefox) → **Cookies** → `https://www.futbin.com`.
5. Copy the following cookies (at minimum):
   - `cf_clearance`  (the critical one — binds to IP + UA)
   - `__cf_bm`  (Cloudflare bot-management)
   - Anything else Futbin sets (`PHPSESSID`, `nlbi_*`, session tokens — paste them all if present, doesn't hurt).

6. Paste into `KNOWLEDGE/extracted/.futbin_cookies.json` using this shape:

```json
[
  {
    "name": "cf_clearance",
    "value": "paste_cf_clearance_value_here",
    "domain": ".futbin.com",
    "path": "/",
    "secure": true,
    "httpOnly": true,
    "sameSite": "None"
  },
  {
    "name": "__cf_bm",
    "value": "paste___cf_bm_value_here",
    "domain": ".futbin.com",
    "path": "/",
    "secure": true,
    "httpOnly": true,
    "sameSite": "None"
  }
]
```

The file is **gitignored** — your cookies never leave your machine.

---

## Step 2 — Run the scraper

From the repo root:

```bash
node KNOWLEDGE/extracted/_scrape_futbin_cookies.js
```

Progress logs every 5 pages. State is saved to `KNOWLEDGE/extracted/futbin_cookies_state.json` every 50 rows → safe to Ctrl-C and resume. Pass `--reset` to start from page 1.

Typical run: ~600 pages × 30 cards = 18 k+ cards, ~3 s/page → **30–60 min end-to-end**.

---

## Step 3 — What happens when cookies expire

`cf_clearance` rotates every ~30 min and binds to the IP + User-Agent that created it. If the scraper re-hits a Cloudflare challenge mid-run it will:
1. Back off: 60 s → 120 s → 300 s.
2. Abort after the third block, with state saved.
3. Print explicit instructions telling you to refresh cookies.

When you see "Cloudflare re-challenged" → redo Step 1, then re-run. The scraper resumes from the last saved page.

---

## Step 4 — Verify after the scrape

```bash
# How many rows now carry futbin live prices?
npx supabase db query --linked "select count(*) from public.fc26_players where deleted_at is null and attributes->>'price_source' = 'futbin_live';"

# Should show many Ronaldo rows post-scrape (base + FUT Birthday + TOTY + any promo).
npx supabase db query --linked "select name, rating, item_type, value_coins_estimate, attributes->>'futbin_variant' as variant from public.fc26_players where deleted_at is null and name ilike '%ronaldo%' order by rating desc;"

# Top 20 by price — sanity-check against futbin.com's home page.
npx supabase db query --linked "select name, rating, attributes->>'futbin_variant' as variant, value_coins_estimate from public.fc26_players where deleted_at is null and attributes->>'price_source' = 'futbin_live' order by value_coins_estimate desc nulls last limit 20;"
```

---

## Re-running for fresh prices

Rerun the script any time prices need refreshing. It's idempotent — existing rows get `attributes.price_snapshot_at` + `value_coins_estimate` updated in place. New promo drops get inserted.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `[FATAL] No cookie file found` | Create `.futbin_cookies.json` per Step 1. |
| `[FATAL] Cloudflare challenge still present after cookie warmup` | `cf_clearance` expired / IP mismatch. Redo Step 1 from same browser + IP. |
| `p1: 0 rows — end of catalogue` on page 1 | DOM selector mismatch (Futbin redesigned). Open the page in a browser, inspect the table, update `extractListPage()` selectors. |
| Playwright browser download missing | `npx playwright install chromium` from repo root. |
| Rows inserted but `value_coins_estimate` null | Cards were SBC-only / untradeable at scrape time. Expected for some icons. |
