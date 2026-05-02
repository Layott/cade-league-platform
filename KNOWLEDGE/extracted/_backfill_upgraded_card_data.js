#!/usr/bin/env node
// Surgical backfill for fc26_players rows missing top-level club / league /
// alt_positions. Fetches each card's Futbin profile page directly via
// `curl` subprocess (Node's native fetch is blocked by Cloudflare's TLS
// fingerprint heuristic; curl/Schannel passes through cleanly), parses
// the HTML with regex, and writes ONLY the columns currently NULL.
// Idempotent — re-runs only fill NULL columns.
//
// Why this exists: pre-May-2026 the list scrapers (_scrape_futbin_*.js)
// only stored numeric `futbin_*_id` and skipped the human-readable
// club/league names + alt-position chips. Chemistry (lib/chemistry.ts)
// reads top-level `fc26_players.{club, league, alt_positions, position}`
// so the scraper gap meant Mr Oga's submitted 4-3-3 calculated 7/33 chem
// when Futbin's own builder put it at a true 32/33. The May-2026 scraper
// patch fixes the going-forward path; this backfill catches up the ~7.7k
// legacy rows.
//
// Prereqs:
//   - `curl` on PATH (Windows ships /mingw64/bin/curl + System32/curl.exe;
//     macOS / Linux ship one out of the box).
//   - apps/web/.env.local has SUPABASE_SERVICE_ROLE_KEY.
//
// Usage:
//   node KNOWLEDGE/extracted/_backfill_upgraded_card_data.js --dry-run
//   node KNOWLEDGE/extracted/_backfill_upgraded_card_data.js
//   node KNOWLEDGE/extracted/_backfill_upgraded_card_data.js --limit 100
//   node KNOWLEDGE/extracted/_backfill_upgraded_card_data.js --concurrency 4
//   node KNOWLEDGE/extracted/_backfill_upgraded_card_data.js --variants icon,hero,tots,toty,rttf,special
//
// Flags:
//   --dry-run         Print what would be written; no DB writes.
//   --limit N         Stop after the first N rows (default: process all).
//   --concurrency N   Parallel curl subprocesses (default 3, cap 6 — CF-safe).
//   --variants CSV    item_type filter (default: all NULL-club rows).
//   --delay-ms MS     Inter-request delay per worker (default 600ms).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 6;
const DEFAULT_DELAY_MS = 600;
const ROW_BATCH = 500;
const RETRY_BACKOFF_MS = [3000, 8000, 20000];

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Decode HTML entities Futbin emits in title= attributes (e.g.
// "Ligue 1 McDonald&#39;s", "RAAL La Louvi&egrave;re").
function decodeHtml(s) {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

// Fetch profile HTML via curl subprocess. Promise resolves with
// { html?, error?, status? }. Auto-retries on transient errors.
function curlFetch(url, attempt = 0) {
  return new Promise((resolve) => {
    const args = [
      "-sL",
      "--max-time", "20",
      "-w", "\n[STATUS=%{http_code}]",
      "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      url,
    ];
    let out = "";
    let err = "";
    const proc = spawn("curl", args);
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("close", async (code) => {
      if (code !== 0) {
        if (attempt < RETRY_BACKOFF_MS.length) {
          await sleep(RETRY_BACKOFF_MS[attempt]);
          return resolve(curlFetch(url, attempt + 1));
        }
        return resolve({ error: `curl exit ${code}: ${err.slice(0, 200)}` });
      }
      const m = out.match(/\n\[STATUS=(\d+)\]\s*$/);
      const status = m ? parseInt(m[1], 10) : 0;
      const html = m ? out.slice(0, m.index) : out;
      if (status >= 500 || status === 429) {
        if (attempt < RETRY_BACKOFF_MS.length) {
          await sleep(RETRY_BACKOFF_MS[attempt]);
          return resolve(curlFetch(url, attempt + 1));
        }
        return resolve({ error: `HTTP ${status}`, status });
      }
      if (status !== 200) return resolve({ error: `HTTP ${status}`, status });
      return resolve({ html, status });
    });
  });
}

// Extract club + league + altPositions + primary position from a Futbin
// profile page HTML string. Returns null if the page is empty or the
// page is a Cloudflare challenge.
function parseProfile(html) {
  if (!html || html.length < 5000) return null;
  // Cloudflare CHALLENGE pages are short (<5KB) and contain a marker
  // <title>Just a moment...</title> + the meta refresh redirect. The
  // `challenge-platform` substring also appears in the LOAD-time CF
  // telemetry script Futbin embeds on EVERY page (legit or not), so it's
  // a false positive when used as the sole marker. The reliable signal
  // is the Just-a-moment title combined with a small body OR an explicit
  // CF-mitigated header response (which we'd see at the curl layer, not
  // here in the body).
  if (
    html.length < 50000
    && /<title>Just a moment\.\.\./i.test(html)
  ) {
    return { _cfBlocked: true };
  }
  // Anchor-with-title-img — first occurrence is the card-info row.
  // The anchor carries a `class=` attribute between href + the inner
  // <img>, so [^>]* swallows attribute padding before the <img tag. Same
  // for [^>]* between the <img and its title= attribute (alt + src + width
  // + height + srcset all sit before title).
  const clubM = html.match(
    /<a\s+href="\/players\?club=\d+"[^>]*>\s*<img[^>]+title="([^"]+)"/i
  );
  const leagueM = html.match(
    /<a\s+href="\/players\?league=\d+"[^>]*>\s*<img[^>]+title="([^"]+)"/i
  );

  // Alt positions — capture every "<div class="playercard-26-alt-pos-sub">POS</div>"
  // until the closing </div> of the .playercard-26-alt-pos block. Limit to
  // the FIRST .playercard-26-alt-pos block (header card).
  const altBlockM = html.match(
    /<div class="playercard-26-alt-pos[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  );
  const altPositions = [];
  if (altBlockM) {
    const altRe = /<div class="playercard-26-alt-pos-sub[^"]*">\s*([A-Z]{1,3})\s*<\/div>/gi;
    let m;
    while ((m = altRe.exec(altBlockM[1])) !== null) {
      const pos = m[1].toUpperCase();
      if (!altPositions.includes(pos)) altPositions.push(pos);
    }
  }

  // Primary position chip on the header card.
  const primaryM = html.match(
    /<div class="playercard-26-position[^"]*">\s*([A-Z]{1,3})\s*<\/div>/i
  );

  return {
    club: clubM ? decodeHtml(clubM[1]).trim() : null,
    league: leagueM ? decodeHtml(leagueM[1]).trim() : null,
    altPositions,
    primary: primaryM ? primaryM[1].toUpperCase() : null,
  };
}

// Update one row, writing only the columns that were NULL. Returns
// outcome string for log aggregation.
async function applyRow(sb, row, profile, dryRun) {
  const update = {};
  if ((row.club ?? null) === null && profile.club) update.club = profile.club;
  if ((row.league ?? null) === null && profile.league) update.league = profile.league;
  if (
    (!Array.isArray(row.alt_positions) || row.alt_positions.length === 0)
    && profile.altPositions && profile.altPositions.length > 0
  ) {
    update.alt_positions = profile.altPositions;
  }
  // Primary position — Futbin profile may have the correct primary even
  // when DB has the placeholder "ST". Only overwrite when DB is "ST" or
  // null AND profile produced a value.
  if (
    profile.primary
    && (row.position === "ST" || (row.position ?? null) === null)
    && profile.primary !== row.position
  ) {
    update.position = profile.primary;
  }
  if (Object.keys(update).length === 0) return "noop";
  if (dryRun) return `dryrun(${Object.keys(update).join(",")})`;

  // Mirror club / league / alt_positions into attributes too — keeps
  // legacy consumers (broadcast endpoints reading attributes->>'club_name')
  // in sync without a second pass.
  const attrs = row.attributes && typeof row.attributes === "object" ? { ...row.attributes } : {};
  let attrsChanged = false;
  if (update.club && attrs.club_name !== update.club) {
    attrs.club_name = update.club; attrsChanged = true;
  }
  if (update.league && attrs.league_name !== update.league) {
    attrs.league_name = update.league; attrsChanged = true;
  }
  if (update.alt_positions && JSON.stringify(attrs.alt_positions || []) !== JSON.stringify(update.alt_positions)) {
    attrs.alt_positions = [...update.alt_positions]; attrsChanged = true;
  }
  if (attrsChanged) update.attributes = attrs;
  update.updated_at = new Date().toISOString();

  const { error } = await sb.from("fc26_players").update(update).eq("id", row.id);
  if (error) return `err(${error.message})`;
  return `wrote(${Object.keys(update).filter((k) => k !== "updated_at" && k !== "attributes").join(",")})`;
}

async function main() {
  loadEnv();
  const dryRun = !!arg("dry-run", false);
  const limitArg = arg("limit", null);
  const limit = limitArg && limitArg !== true ? parseInt(limitArg, 10) : null;
  const concArg = arg("concurrency", null);
  const concurrency = Math.min(
    MAX_CONCURRENCY,
    concArg && concArg !== true ? parseInt(concArg, 10) : DEFAULT_CONCURRENCY
  );
  const variantsArg = arg("variants", null);
  const itemTypeFilter = variantsArg && variantsArg !== true
    ? variantsArg.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const delayArg = arg("delay-ms", null);
  const delayMs = delayArg && delayArg !== true ? parseInt(delayArg, 10) : DEFAULT_DELAY_MS;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("missing supabase env — check apps/web/.env.local");
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log(`[backfill] mode=${dryRun ? "dry-run" : "apply"} concurrency=${concurrency} delay=${delayMs}ms limit=${limit ?? "∞"} variants=${itemTypeFilter ? itemTypeFilter.join(",") : "all"}`);

  // Pre-flight: count missing rows.
  let countQuery = sb
    .from("fc26_players")
    .select("id", { count: "exact", head: true })
    .eq("source_dataset", "futbin.com")
    .is("deleted_at", null)
    .is("club", null);
  if (itemTypeFilter) countQuery = countQuery.in("item_type", itemTypeFilter);
  const { count: totalMissing } = await countQuery;
  console.log(`[backfill] rows missing club: ${totalMissing}`);
  if (!totalMissing) {
    console.log("[backfill] nothing to do.");
    return;
  }
  const targetCount = limit ? Math.min(limit, totalMissing) : totalMissing;
  console.log(`[backfill] will process up to ${targetCount} rows`);

  // Probe — confirm curl + parser work end-to-end on a known card.
  console.log("[backfill] probe: Buffon icon...");
  const probeResp = await curlFetch("https://www.futbin.com/26/player/24539/buffon");
  if (probeResp.error) {
    console.error(`[backfill] probe FAILED: ${probeResp.error}`);
    console.error("Cannot reach Futbin — check VPN / network / curl on PATH.");
    process.exit(1);
  }
  const probeProfile = parseProfile(probeResp.html);
  if (!probeProfile || !probeProfile.club || !probeProfile.league) {
    console.error(`[backfill] probe parse FAILED: club=${probeProfile?.club} league=${probeProfile?.league}`);
    console.error("Selectors may have rotated. Inspect Buffon page HTML manually.");
    process.exit(1);
  }
  console.log(`[backfill] probe OK: Buffon → club="${probeProfile.club}" league="${probeProfile.league}"`);

  const stats = {
    fetched: 0, parsed: 0, wrote: 0, noop: 0, errors: 0, cfBlocked: 0,
    byVariant: {},
  };
  const errors = [];

  let offset = 0;
  let processed = 0;
  while (processed < targetCount) {
    const remaining = targetCount - processed;
    const fetchSize = Math.min(ROW_BATCH, remaining);
    let q = sb
      .from("fc26_players")
      .select("id, source_row_id, slug, item_type, club, league, alt_positions, position, attributes, name, rating")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .is("club", null)
      .order("id", { ascending: true })
      .range(offset, offset + fetchSize - 1);
    if (itemTypeFilter) q = q.in("item_type", itemTypeFilter);
    const { data: rows, error } = await q;
    if (error) { console.error("[backfill] fetch err:", error.message); break; }
    if (!rows || rows.length === 0) break;

    // Process this slice with bounded concurrency. Each worker pulls
    // from a shared cursor; inter-request delay applies per worker.
    let cursor = 0;
    async function workerLoop() {
      while (cursor < rows.length) {
        const i = cursor++;
        const row = rows[i];
        const idMatch = (row.source_row_id || "").match(/^futbin_(\d+)$/);
        if (!idMatch) {
          stats.errors++;
          errors.push({ id: row.id, name: row.name, reason: "bad source_row_id" });
          continue;
        }
        const resourceId = idMatch[1];
        const slug = row.slug || "x";
        const url = `https://www.futbin.com/26/player/${resourceId}/${slug}`;
        const { html, error: fErr } = await curlFetch(url);
        stats.fetched++;
        if (fErr) {
          stats.errors++;
          errors.push({ id: row.id, name: row.name, reason: fErr });
          await sleep(delayMs);
          continue;
        }
        const profile = parseProfile(html);
        if (profile && profile._cfBlocked) {
          stats.cfBlocked++;
          errors.push({ id: row.id, name: row.name, reason: "CF challenge" });
          await sleep(delayMs * 4);
          continue;
        }
        if (!profile || (!profile.club && !profile.league && profile.altPositions.length === 0 && !profile.primary)) {
          stats.noop++;
          errors.push({ id: row.id, name: row.name, reason: "no fields parsed" });
          await sleep(delayMs);
          continue;
        }
        stats.parsed++;
        const outcome = await applyRow(sb, row, profile, dryRun);
        const bucket = stats.byVariant[row.item_type] || { wrote: 0, noop: 0, errors: 0 };
        if (outcome.startsWith("wrote") || outcome.startsWith("dryrun")) {
          stats.wrote++; bucket.wrote++;
        } else if (outcome === "noop") {
          stats.noop++; bucket.noop++;
        } else {
          stats.errors++; bucket.errors++;
          errors.push({ id: row.id, name: row.name, reason: outcome });
        }
        stats.byVariant[row.item_type] = bucket;
        if ((stats.fetched % 50) === 0) {
          console.log(`[backfill] +${stats.fetched}/${targetCount} | wrote=${stats.wrote} noop=${stats.noop} cf=${stats.cfBlocked} err=${stats.errors}`);
        }
        await sleep(delayMs);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, workerLoop));
    processed += rows.length;
    offset += rows.length;
  }

  console.log("");
  console.log("[backfill] DONE");
  console.log(`  rows fetched:   ${stats.fetched}`);
  console.log(`  parsed OK:      ${stats.parsed}`);
  console.log(`  wrote:          ${stats.wrote}${dryRun ? " (DRY-RUN)" : ""}`);
  console.log(`  noop:           ${stats.noop}`);
  console.log(`  CF challenges:  ${stats.cfBlocked}`);
  console.log(`  errors:         ${stats.errors}`);
  for (const [variant, b] of Object.entries(stats.byVariant)) {
    console.log(`    ${variant.padEnd(10)} wrote=${b.wrote}  noop=${b.noop}  err=${b.errors}`);
  }
  if (errors.length) {
    const out = path.resolve(__dirname, "_backfill_upgraded_errors.json");
    fs.writeFileSync(out, JSON.stringify(errors, null, 2));
    console.log(`  errors logged → ${out}`);
  }

  // 2026-05-02 — fan out fcdb.refreshed so 19-player-squads overlay
  // re-fetches chem without operator intervention. Skipped on dry-run.
  if (!dryRun && stats.wrote > 0) {
    try {
      const { publishFcdbRefreshed } = require("./_lib_realtime");
      await publishFcdbRefreshed(sb, {
        rowsChanged: stats.wrote,
        source: "backfill_upgraded_card_data",
      });
      console.log("  fcdb.refreshed: published");
    } catch (err) {
      console.error(
        "  fcdb.refreshed: publish failed:",
        err && err.message ? err.message : err,
      );
    }
  }
}

main().catch((e) => { console.error("[fatal]", e.stack || e.message); process.exit(1); });
