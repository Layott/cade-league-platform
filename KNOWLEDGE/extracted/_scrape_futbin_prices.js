#!/usr/bin/env node
// Scrape live Futbin EAFC26 prices and write them into
// public.fc26_players.value_coins_estimate. Replaces the Kaggle-derived
// fallback wholesale — Futbin-sourced prices ALWAYS win over
// `matched` (FIFA23/FUT22 Kaggle) or `rating_median` placeholders.
//
// Authorised by the repo owner (adenipebi@gmail.com) for private use only.
// No redistribution.
//
// Run:
//   node KNOWLEDGE/extracted/_scrape_futbin_prices.js
//
// Resume:
//   Re-runs pick up from KNOWLEDGE/extracted/futbin_scrape_state.json.
//   Pass --reset to wipe state and start over.
//
// Anti-block tactics implemented per brief:
//   1. Cloudflare warmup — first request hits https://www.futbin.com/
//      to acquire any clearance cookies. Cookies reused across the run.
//   2. UA rotation — 7 realistic Chrome / Firefox / Safari strings rotated
//      round-robin. Desktop + mobile mix.
//   3. Jittered delay — 1500ms + random(0..2000ms) between requests.
//   4. Backoff ladder — 429/503/Cloudflare-challenge responses wait
//      [30s, 60s, 120s, 300s, 900s] on consecutive hits. 5+ blocks = abort.
//   5. Realistic headers — Accept-*, Referer, Sec-Fetch-* like Chrome.
//   6. Strict sequential — no concurrent requests.
//   7. Resume state — futbin_scrape_state.json flushed every 50 rows.
//   8. Bulk-first — paginated list (30 rows/page × ~800 pages ≈ 800 req).
//      Per-player JSON fallback only if a list row lacks a usable price.
//
// Matching to fc26_players is by (lower(name), rating, primary-position,
// nation, club). Fuzzy name via the fc26_players_fuzzy RPC on slug miss.
// Unmatched futbin rows dumped to KNOWLEDGE/extracted/futbin_unmatched.json.
//
// DB write: service-role client.
//   UPDATE value_coins_estimate
//   + attributes.price_source = 'futbin_live'
//   + attributes.price_snapshot_at = <ISO>.
//   Futbin price wins unconditionally. Older Futbin snapshots are NOT
//   overwritten by a fresher Futbin snapshot older than them — newest wins.

const fs = require("fs");
const path = require("path");
const https = require("node:https");
const zlib = require("node:zlib");
const { URL } = require("node:url");
const { createClient } = require("@supabase/supabase-js");

// ---------------------------------------------------------------------------
// Config

const BASE = "https://www.futbin.com";
const LIST_PATH = "/26/players"; // ?page=N
const WARMUP_URL = `${BASE}/`;
const STATE_FILE = path.resolve(__dirname, "futbin_scrape_state.json");
const UNMATCHED_FILE = path.resolve(__dirname, "futbin_unmatched.json");
const COOKIE_JAR_FILE = path.resolve(__dirname, "_scrape_tmp", "cookie_jar.json");

const MIN_DELAY_MS = 1500;
const JITTER_MS = 2000;
const BACKOFF_LADDER_MS = [30_000, 60_000, 120_000, 300_000, 900_000];
const MAX_CONSECUTIVE_BLOCKS = 5;
const STATE_FLUSH_EVERY = 50;

const USER_AGENTS = [
  // Chrome Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.100 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.85 Safari/537.36",
  // Chrome macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.100 Safari/537.36",
  // Firefox Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  // Safari macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  // Chrome Android (mobile)
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
  // Safari iOS (mobile)
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
];

const UPDATE_CONCURRENCY = 8; // DB writes only — NOT futbin requests.

// ---------------------------------------------------------------------------
// env loader (reuse the pattern from _ingest_prices.js)

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

// ---------------------------------------------------------------------------
// cookie jar (serialised)

function loadCookieJar() {
  try {
    const raw = fs.readFileSync(COOKIE_JAR_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveCookieJar(jar) {
  fs.mkdirSync(path.dirname(COOKIE_JAR_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_JAR_FILE, JSON.stringify(jar, null, 2));
}

function cookieHeader(jar) {
  const names = Object.keys(jar);
  if (!names.length) return "";
  return names.map((k) => `${k}=${jar[k]}`).join("; ");
}

function absorbSetCookie(jar, setCookieHeaders) {
  if (!setCookieHeaders) return;
  const arr = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];
  for (const line of arr) {
    const first = String(line).split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
}

// ---------------------------------------------------------------------------
// state (resume)

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      lastPage: 0,
      totalPages: null,
      updatedRows: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      skippedNoPrice: 0,
      startedAt: new Date().toISOString(),
      lastTickAt: null,
      consecutiveBlocks: 0,
    };
  }
}

function saveState(state) {
  state.lastTickAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function appendUnmatched(entries) {
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(UNMATCHED_FILE, "utf8"));
  } catch {}
  existing.push(...entries);
  fs.writeFileSync(UNMATCHED_FILE, JSON.stringify(existing, null, 2));
}

// ---------------------------------------------------------------------------
// HTTP with headers + cookies + gzip

let reqCounter = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nextUA() {
  return USER_AGENTS[reqCounter++ % USER_AGENTS.length];
}

function jitterDelayMs() {
  return MIN_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
}

function fetchFutbin(url, jar, referer) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      "User-Agent": nextUA(),
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: referer || `${BASE}${LIST_PATH}`,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      Connection: "keep-alive",
    };
    const cookieStr = cookieHeader(jar);
    if (cookieStr) headers["Cookie"] = cookieStr;

    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: "GET",
        headers,
        timeout: 30_000,
      },
      (res) => {
        absorbSetCookie(jar, res.headers["set-cookie"]);
        const chunks = [];
        let stream = res;
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        stream.on("data", (c) => chunks.push(c));
        stream.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        stream.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function isBlocked(res) {
  if (!res) return true;
  const code = res.statusCode || 0;
  if (code === 429 || code === 503 || code === 403) return true;
  if (code >= 500) return true;
  // Cloudflare challenge markers
  const body = res.body || "";
  if (
    body.includes("cf-challenge") ||
    body.includes("Checking your browser") ||
    body.includes("Just a moment...") ||
    body.includes("cf_chl_opt")
  ) {
    return true;
  }
  return false;
}

async function warmup(jar) {
  console.log("[warmup] fetching home page to seed cookies...");
  const res = await fetchFutbin(WARMUP_URL, jar, null);
  if (isBlocked(res)) {
    throw new Error(`warmup blocked (status ${res.statusCode})`);
  }
  console.log(
    `[warmup] ok ${res.statusCode} size=${res.body.length} cookies=${Object.keys(jar).length}`,
  );
  saveCookieJar(jar);
}

async function fetchListPage(pageNum, jar, state) {
  const url = `${BASE}${LIST_PATH}?page=${pageNum}`;
  let consecutive = 0;
  for (;;) {
    await sleep(jitterDelayMs());
    let res;
    try {
      res = await fetchFutbin(url, jar, `${BASE}${LIST_PATH}`);
    } catch (e) {
      res = { statusCode: 0, body: `network: ${e.message}` };
    }
    if (!isBlocked(res)) {
      state.consecutiveBlocks = 0;
      return res;
    }
    consecutive++;
    state.consecutiveBlocks = (state.consecutiveBlocks || 0) + 1;
    const totalBlocks = state.consecutiveBlocks;
    if (totalBlocks > MAX_CONSECUTIVE_BLOCKS) {
      saveState(state);
      throw new Error(
        `aborting — ${totalBlocks} consecutive blocks. State saved; re-run to resume.`,
      );
    }
    const waitIdx = Math.min(consecutive - 1, BACKOFF_LADDER_MS.length - 1);
    const waitMs = BACKOFF_LADDER_MS[waitIdx];
    console.warn(
      `[block] page ${pageNum} status=${res.statusCode} run-block=${consecutive} total-blocks=${totalBlocks} — sleeping ${waitMs / 1000}s`,
    );
    // Re-warm on every 2nd block (cookies may have rotated)
    if (consecutive % 2 === 0) {
      try {
        await warmup(jar);
      } catch (e) {
        console.warn(`[warmup-retry-failed] ${e.message}`);
      }
    }
    await sleep(waitMs);
  }
}

// ---------------------------------------------------------------------------
// HTML parsing

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&eacute;|&#233;/g, "é")
    .replace(/&Eacute;|&#201;/g, "É")
    .replace(/&iacute;|&#237;/g, "í")
    .replace(/&oacute;|&#243;/g, "ó")
    .replace(/&uacute;|&#250;/g, "ú")
    .replace(/&aacute;|&#225;/g, "á")
    .replace(/&ntilde;|&#241;/g, "ñ")
    .replace(/&ouml;|&#246;/g, "ö")
    .replace(/&uuml;|&#252;/g, "ü")
    .replace(/&auml;|&#228;/g, "ä")
    .replace(/&ccedil;|&#231;/g, "ç")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

function slugify(name) {
  return stripDiacritics(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parsePriceToken(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s) return 0;
  if (/^(untradeable|sbc|-|n\/a|na)$/i.test(s)) return 0;
  const m = s.match(/^([\d.]+)\s*([KkMm]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const suffix = (m[2] || "").toUpperCase();
  const mult = suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  return Math.round(n * mult);
}

function medianOfNonzero(prices) {
  const arr = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  return arr[Math.floor(arr.length / 2)];
}

// Parse a list-page HTML into 30 row objects:
//   { futbinId, name, slug, rating, position, revision, nation, club, price }
// We lean on stable class hooks: `player-row`, `/26/player/<id>/<slug>`,
// `table-rating`, `table-pos`, `table-price` (ps/pc), `title="Club"`,
// `title="<nation-name>"`.
function parseListPage(html) {
  const rows = [];
  // Split by row boundaries. Each row starts with `<tr class="player-row ...">`.
  const rowRe =
    /<tr class="player-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const rowHtml = m[1];
    const row = parseOneRow(rowHtml);
    if (row) rows.push(row);
  }
  return rows;
}

function parseOneRow(rowHtml) {
  // Futbin internal id + slug from `/26/player/<id>/<slug>`
  const idM = rowHtml.match(/\/26\/player\/(\d+)\/([a-z0-9-]+)/);
  if (!idM) return null;
  const futbinId = parseInt(idM[1], 10);
  const urlSlug = idM[2];

  // Display name
  const nameM = rowHtml.match(/class="table-player-name">([^<]+)<\/a>/);
  const displayName = nameM ? decodeEntities(nameM[1]).trim() : urlSlug.replace(/-/g, " ");

  // Rating — first `<div class="rating-square" ...>NN</div>`
  const ratM = rowHtml.match(/class="rating-square"[^>]*>(\d+)<\/div>/);
  const rating = ratM ? parseInt(ratM[1], 10) : 0;

  // Primary position — `<div class="table-pos-main ..."><span>XX</span>`
  const posM = rowHtml.match(/class="table-pos-main[^"]*"[^>]*><span>([^<]+)<\/span>/);
  const position = posM ? posM[1].trim() : "";

  // Revision / card version (optional)
  const revM = rowHtml.match(/class="table-player-revision">([^<]+)<\/div>/);
  const revision = revM ? decodeEntities(revM[1]).trim() : "";

  // Nation — anchor with `/players?nation=<n>` and `title="<Name>"`
  const natM = rowHtml.match(
    /class="table-player-nation"[\s\S]*?title="([^"]+)"/,
  );
  const nation = natM ? decodeEntities(natM[1]).trim() : "";

  // Club — anchor with `/players?club=<n>` and `title="<Name>"`
  const cluM = rowHtml.match(
    /class="table-player-club"[\s\S]*?title="([^"]+)"/,
  );
  const club = cluM ? decodeEntities(cluM[1]).trim() : "";

  // Prices — PS + PC cells (Xbox collapsed into PS since FC24). We pick
  // the MEDIAN of any nonzero numbers across platforms. The platform cell
  // has `<div class="price bold ...">VALUE<img` pattern.
  const priceRe =
    /class="table-price[^"]*platform-([a-z]+)-only"[\s\S]*?class="price bold[^"]*"[^>]*>([^<]+)<img/g;
  const platforms = {};
  let pm;
  while ((pm = priceRe.exec(rowHtml)) !== null) {
    const plat = pm[1];
    const rawTxt = decodeEntities(pm[2]).trim();
    const n = parsePriceToken(rawTxt);
    if (n > 0) platforms[plat] = n;
  }
  const priceVals = Object.values(platforms);
  const price = medianOfNonzero(priceVals);

  return {
    futbinId,
    displayName,
    urlSlug,
    slug: slugify(displayName),
    rating,
    position,
    revision,
    nation,
    club,
    platforms,
    price,
  };
}

// Parse total pages from the pagination block (`<div class="pagination-buttons-wrapper">...<a href="/players?page=N">N</a>...`).
// The last numeric pagination link is the catalogue size.
function parseTotalPages(html) {
  const block = html.match(
    /class="pagination-buttons-wrapper[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  const hay = block ? block[1] : html;
  const all = [];
  const re = /\/players\?page=(\d+)/g;
  let x;
  while ((x = re.exec(hay)) !== null) all.push(parseInt(x[1], 10));
  if (all.length) return Math.max(...all);
  return null;
}

// ---------------------------------------------------------------------------
// Matching — (slug, rating) is the primary key; position/nation/club are
// used to disambiguate when multiple fc26_players rows collide on (slug, rating).

function matchToFcRow(futRow, fcBySlug, fuzzyLookup) {
  // 1. Exact slug + rating
  const exact = fcBySlug.get(futRow.slug) || [];
  const ratingHits = exact.filter((r) => r.rating === futRow.rating);
  if (ratingHits.length === 1) return ratingHits[0];
  if (ratingHits.length > 1) {
    // Disambiguate by position (primary first, then alt_positions)
    const pos = futRow.position.toUpperCase();
    const posHits = ratingHits.filter(
      (r) =>
        String(r.position || "").toUpperCase() === pos ||
        (Array.isArray(r.alt_positions) &&
          r.alt_positions.some((ap) => String(ap).toUpperCase() === pos)),
    );
    if (posHits.length === 1) return posHits[0];
    if (posHits.length > 1) {
      // Further disambiguate by nation OR club
      const natLow = futRow.nation.toLowerCase();
      const clbLow = futRow.club.toLowerCase();
      const narrow = posHits.filter(
        (r) =>
          (natLow && String(r.nation || "").toLowerCase() === natLow) ||
          (clbLow && String(r.club || "").toLowerCase() === clbLow),
      );
      if (narrow.length === 1) return narrow[0];
      if (narrow.length > 1) return narrow[0]; // first — tie-break acceptance
    }
    // No position narrow: fall back to first rating hit
    return ratingHits[0];
  }
  // 2. Exact slug but no rating hit — skip (probably promo card mismatch)
  if (exact.length) return null;
  // 3. Fuzzy fallback — only run it if the slug exact set is empty. Caller
  // supplies the lookup.
  return fuzzyLookup ? fuzzyLookup(futRow) : null;
}

// ---------------------------------------------------------------------------
// Main

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  if (process.argv.includes("--reset")) {
    for (const p of [STATE_FILE, UNMATCHED_FILE, COOKIE_JAR_FILE]) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
    console.log("[reset] state + cookies + unmatched cleared");
  }

  const state = loadState();
  const jar = loadCookieJar();

  // Warm up once (or re-warm if we have no cookies)
  if (!Object.keys(jar).length) {
    await warmup(jar);
  } else {
    console.log(
      `[resume] existing cookies (${Object.keys(jar).length}) + state page=${state.lastPage}`,
    );
  }

  // Load fc26_players into memory: slug -> rows
  console.log("[db] loading fc26_players active rows...");
  const fcRows = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, slug, name, rating, position, alt_positions, nation, club, attributes")
      .is("deleted_at", null)
      .range(from, to);
    if (error) throw new Error(`fc26_players select: ${error.message}`);
    if (!data || data.length === 0) break;
    fcRows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  const fcBySlug = new Map();
  for (const r of fcRows) {
    const s = r.slug || slugify(r.name);
    if (!fcBySlug.has(s)) fcBySlug.set(s, []);
    fcBySlug.get(s).push(r);
  }
  console.log(
    `[db] loaded ${fcRows.length} fc26_players rows (${fcBySlug.size} unique slugs)`,
  );

  // Fuzzy lookup using pg_trgm RPC (only when exact slug misses)
  async function fuzzyLookup(futRow) {
    try {
      const { data } = await sb.rpc("fc26_players_fuzzy", {
        p_name: futRow.displayName,
        p_threshold: 0.35,
        p_limit: 10,
      });
      if (!data || !data.length) return null;
      const candidates = data.filter((r) => r.rating === futRow.rating);
      if (!candidates.length) return null;
      if (candidates.length === 1) return candidates[0];
      const pos = futRow.position.toUpperCase();
      const posHits = candidates.filter(
        (r) =>
          String(r.position || "").toUpperCase() === pos ||
          (Array.isArray(r.alt_positions) &&
            r.alt_positions.some((ap) => String(ap).toUpperCase() === pos)),
      );
      if (posHits.length) return posHits[0];
      return candidates[0];
    } catch (e) {
      console.warn(`[fuzzy] ${futRow.displayName}: ${e.message}`);
      return null;
    }
  }

  // DB updater queue — runs parallel INSIDE the DB only (NOT futbin requests).
  const updateQueue = [];
  let updateErrors = 0;
  let pendingFlush = 0;
  async function flushUpdates() {
    if (!updateQueue.length) return;
    const batch = updateQueue.splice(0);
    pendingFlush = batch.length;
    let idx = 0;
    async function worker() {
      while (idx < batch.length) {
        const my = idx++;
        const u = batch[my];
        const { error } = await sb
          .from("fc26_players")
          .update({
            value_coins_estimate: u.price,
            attributes: u.attributes,
          })
          .eq("id", u.id);
        if (error) {
          updateErrors++;
          if (updateErrors <= 5) console.error("[update-err]", u.id, error.message);
        }
      }
    }
    await Promise.all(
      Array.from({ length: UPDATE_CONCURRENCY }, () => worker()),
    );
    pendingFlush = 0;
  }

  // Scrape loop
  let startPage = Math.max(1, state.lastPage + 1);
  console.log(`[scrape] starting from page ${startPage}`);

  const unmatchedBuffer = [];
  let processedSinceFlush = 0;

  for (let pageNum = startPage; ; pageNum++) {
    const res = await fetchListPage(pageNum, jar, state);
    if (res.statusCode !== 200) {
      console.warn(`[page ${pageNum}] status ${res.statusCode} — skipping`);
      continue;
    }
    saveCookieJar(jar);

    if (!state.totalPages) {
      const tp = parseTotalPages(res.body);
      if (tp) {
        state.totalPages = tp;
        console.log(`[scrape] total pages detected: ${tp}`);
      }
    }

    const rows = parseListPage(res.body);
    if (!rows.length) {
      console.warn(`[page ${pageNum}] 0 rows — end of catalogue?`);
      state.lastPage = pageNum;
      saveState(state);
      if (state.totalPages && pageNum >= state.totalPages) break;
      // Try one more page then bail
      if (pageNum > (state.totalPages || 850)) break;
      continue;
    }

    let pageMatched = 0;
    let pageNoPrice = 0;
    let pageUnmatched = 0;

    for (const futRow of rows) {
      if (!futRow.price || futRow.price <= 0) {
        state.skippedNoPrice++;
        pageNoPrice++;
        continue;
      }
      let fcMatch = matchToFcRow(futRow, fcBySlug, null);
      if (!fcMatch) {
        fcMatch = await fuzzyLookup(futRow);
      }
      if (!fcMatch) {
        state.unmatchedRows++;
        pageUnmatched++;
        unmatchedBuffer.push({
          futbinId: futRow.futbinId,
          name: futRow.displayName,
          slug: futRow.slug,
          rating: futRow.rating,
          position: futRow.position,
          revision: futRow.revision,
          nation: futRow.nation,
          club: futRow.club,
          price: futRow.price,
        });
        continue;
      }

      // Newer-wins guard — don't overwrite a fresher Futbin snapshot with
      // a now-stale one. (We never re-scrape backwards, but be defensive.)
      const existingAttrs =
        (fcMatch.attributes && typeof fcMatch.attributes === "object"
          ? fcMatch.attributes
          : {}) || {};
      const existingSnap = existingAttrs.price_snapshot_at;
      const nowIso = new Date().toISOString();
      if (
        existingAttrs.price_source === "futbin_live" &&
        existingSnap &&
        existingSnap > nowIso
      ) {
        // existing snapshot claims to be from the future — skip, something odd
        continue;
      }

      const newAttrs = {
        ...existingAttrs,
        price_source: "futbin_live",
        price_snapshot_at: nowIso,
        futbin_id: futRow.futbinId,
        futbin_revision: futRow.revision || undefined,
        price_platforms: futRow.platforms,
      };
      updateQueue.push({
        id: fcMatch.id,
        price: futRow.price,
        attributes: newAttrs,
      });
      state.matchedRows++;
      pageMatched++;
    }

    state.lastPage = pageNum;
    processedSinceFlush += rows.length;

    // Flush updates in batches of ~STATE_FLUSH_EVERY processed rows
    if (processedSinceFlush >= STATE_FLUSH_EVERY || updateQueue.length >= 100) {
      await flushUpdates();
      state.updatedRows += state.matchedRows;
      if (unmatchedBuffer.length) {
        appendUnmatched(unmatchedBuffer.splice(0));
      }
      saveState(state);
      processedSinceFlush = 0;
    }

    const total = state.totalPages || "?";
    console.log(
      `[page ${pageNum}/${total}] rows=${rows.length} matched=${pageMatched} noprice=${pageNoPrice} unmatched=${pageUnmatched} | cum: matched=${state.matchedRows} unmatched=${state.unmatchedRows} skipped=${state.skippedNoPrice}`,
    );

    if (state.totalPages && pageNum >= state.totalPages) break;
  }

  // Final flush
  await flushUpdates();
  if (unmatchedBuffer.length) appendUnmatched(unmatchedBuffer.splice(0));
  saveState(state);

  console.log("\n==== SCRAPE COMPLETE ====");
  console.log(`matched + updated rows: ${state.matchedRows}`);
  console.log(`unmatched futbin rows : ${state.unmatchedRows}`);
  console.log(`skipped (no price)    : ${state.skippedNoPrice}`);
  console.log(`update errors         : ${updateErrors}`);
  console.log(`last page processed   : ${state.lastPage}`);
  console.log(`state                 : ${STATE_FILE}`);
  console.log(`unmatched dump        : ${UNMATCHED_FILE}`);
}

main().catch((e) => {
  console.error("[fatal]", e.message);
  console.error(e.stack);
  process.exit(1);
});
