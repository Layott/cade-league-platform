#!/usr/bin/env node
/**
 * Plan 51 — v2 overlay sync script.
 *
 * Mirrors the source-of-truth HTML at
 *   KNOWLEDGE/brand-assets/elements/v2/<key>/index.html
 * into the Next.js public folder at
 *   apps/web/public/overlays/v2/<key>/index.html
 * and copies the assets that those HTMLs reference (fonts, logos, Orgs,
 * designsample, players/processed) into
 *   apps/web/public/overlays/v2/_assets/{fonts,logos,Orgs,designsample,players}/
 *
 * Source HTML uses `../../../<bucket>/...` relative paths. The sync rewrites
 * those to `/overlays/v2/_assets/<bucket>/...` during copy so the static
 * HTML resolves when served from the Next.js public folder.
 *
 * Usage:
 *   node apps/web/scripts/sync-v2-overlays.mjs              # one-shot sync
 *   node apps/web/scripts/sync-v2-overlays.mjs --watch      # chokidar watch
 *
 * Hooked into `npm run prebuild` so production builds always have an
 * up-to-date public mirror without dev intervention.
 */

import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir,
  stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = .../apps/web/scripts
const APP_WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_WEB_ROOT, "..", "..");
const SOURCE_ROOT = resolve(
  REPO_ROOT,
  "KNOWLEDGE",
  "brand-assets",
  "elements",
  "v2",
);
const BRAND_ROOT = resolve(REPO_ROOT, "KNOWLEDGE", "brand-assets");
const TARGET_HTML_ROOT = resolve(APP_WEB_ROOT, "public", "overlays", "v2");
const TARGET_ASSETS_ROOT = resolve(TARGET_HTML_ROOT, "_assets");

// 17 overlay keys per spec section 9. Animated-bg variants + 18-partners-strip
// are NOT in the live route list (meta-only / subsumed).
export const KEYS = Object.freeze([
  "01-brb",
  "02-timer",
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "08-lower-third",
  "09-secondary-score-bug",
  "10-up-next-bug",
  "11-match-scores-day",
  "12-starting-soon",
  "13-stream-ended",
  "14-top-scorers",
  "15-orgs",
  "16-coaches",
  "17-penalties",
]);

// Buckets the v2 HTMLs reference via `../../../<bucket>/...`. Keep this list
// in sync with the regex in `rewritePaths` below.
const ASSET_BUCKETS = Object.freeze([
  "fonts",
  "logos",
  "Orgs",
  "designsample",
  "players",
]);

/**
 * Rewrite `../../../<bucket>/...` references to absolute
 * `/overlays/v2/_assets/<bucket>/...` paths so the copied HTML resolves when
 * served from `apps/web/public/overlays/v2/<key>/index.html`.
 */
export function rewritePaths(html) {
  return html.replace(
    /\.\.\/\.\.\/\.\.\/(fonts|logos|players|Orgs|designsample)\//g,
    "/overlays/v2/_assets/$1/",
  );
}

async function copyDirRecursive(src, dst) {
  if (!existsSync(src)) return 0;
  let copied = 0;
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      // Skip Python caches + raw camera files (they're gitignored anyway).
      if (entry.name === "__pycache__") continue;
      copied += await copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      // Skip raw photography (huge; gitignored).
      if (/\.(ARW|CR3)$/i.test(entry.name)) continue;
      // Skip top-level loose PNGs in players/ root (e.g. FARUK 1.png) —
      // overlays only reference players/processed/**.
      if (
        srcPath.startsWith(join(BRAND_ROOT, "players") + sep) &&
        relative(join(BRAND_ROOT, "players"), srcPath).split(sep).length === 1 &&
        /\.(png|jpe?g)$/i.test(entry.name)
      ) {
        continue;
      }
      await copyFile(srcPath, dstPath);
      copied += 1;
    }
  }
  return copied;
}

async function syncAssets() {
  await mkdir(TARGET_ASSETS_ROOT, { recursive: true });
  const counts = {};
  for (const bucket of ASSET_BUCKETS) {
    const src = resolve(BRAND_ROOT, bucket);
    const dst = resolve(TARGET_ASSETS_ROOT, bucket);
    counts[bucket] = await copyDirRecursive(src, dst);
  }
  return counts;
}

async function syncOne(key) {
  const srcHtml = join(SOURCE_ROOT, key, "index.html");
  if (!existsSync(srcHtml)) {
    console.warn(`[v2-sync] missing source: ${srcHtml}`);
    return { key, ok: false, bytes: 0 };
  }
  const dstHtml = join(TARGET_HTML_ROOT, key, "index.html");
  await mkdir(dirname(dstHtml), { recursive: true });
  const raw = await readFile(srcHtml, "utf8");
  const rewritten = rewritePaths(raw);
  await writeFile(dstHtml, rewritten, "utf8");
  const s = await stat(dstHtml);
  return { key, ok: true, bytes: s.size };
}

export async function syncAll() {
  await mkdir(TARGET_HTML_ROOT, { recursive: true });
  const assetCounts = await syncAssets();
  const results = [];
  for (const k of KEYS) {
    results.push(await syncOne(k));
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(
    `[v2-sync] HTML: ${ok}/${KEYS.length} synced  ·  assets: ${Object.entries(
      assetCounts,
    )
      .map(([b, n]) => `${b}=${n}`)
      .join(" ")}`,
  );
  return { results, assetCounts };
}

// Entry point — only run when invoked as a script (not when imported by tests).
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  await syncAll();

  if (process.argv.includes("--watch")) {
    let chokidar;
    try {
      chokidar = (await import("chokidar")).default;
    } catch {
      console.error(
        "[v2-sync] watch mode requires chokidar — install with `npm i -D chokidar`",
      );
      process.exit(1);
    }
    chokidar
      .watch(SOURCE_ROOT, { ignoreInitial: true })
      .on("all", (event, path) => {
        const rel = relative(SOURCE_ROOT, path);
        console.log(`[v2-sync] ${event}: ${rel}`);
        syncAll().catch((e) => console.error("[v2-sync] error:", e));
      });
    console.log(
      `[v2-sync] watching ${SOURCE_ROOT} for changes (Ctrl-C to stop)`,
    );
  }
}
