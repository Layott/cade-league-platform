#!/usr/bin/env node
/**
 * Wave 2 Stage 2 — element-id seeder.
 *
 * One-shot mutation script. Walks each
 *   KNOWLEDGE/brand-assets/elements/v2/<key>/index.html
 * and idempotently adds `data-element-id="..."` attrs on text-bearing
 * elements that the seed catalog (migration `20260620000007`) registers.
 *
 * Idempotent: if the attr already exists with the same value, no change.
 * Safe: only INSERTS attrs — never replaces other tag content. The
 * regex matches the FIRST opening tag of a class selector and inserts
 * `data-element-id="<id>"` immediately after the matched tag's class
 * attribute.
 *
 * Run once at Stage 2 ship time. After that, future overlay HTML edits
 * should keep the attrs intact (sync script + parity linter enforce).
 *
 * Usage:
 *   node apps/web/scripts/_seed-element-ids.mjs           # mutate
 *   node apps/web/scripts/_seed-element-ids.mjs --dry     # preview
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_WEB_ROOT, "..", "..");
const SOURCE_ROOT = resolve(
  REPO_ROOT,
  "KNOWLEDGE",
  "brand-assets",
  "elements",
  "v2",
);

/**
 * Per-overlay seed plan: ordered list of (element_id, regex pattern).
 *
 * The regex matches the FIRST opening tag we'd attach the id to. We
 * limit each id to ONE injection per file (idempotent — second pass
 * sees the existing attr + skips). For elements that appear multiple
 * times (e.g. chevrons), we use distinct patterns OR accept a single
 * representative seeding (the HTML structure already handles repeats
 * via class name + count).
 *
 * Strategy:
 *   - Use class selectors when stable.
 *   - Use id selectors when class is generic (e.g. multiple .player-card).
 *   - For partner-strip use the <footer class="partners"> wrapper.
 *
 * Regex shape: `<TAG\b[^>]*class="[^"]*\bCLASS\b[^"]*"[^>]*?>` but
 * normalised to allow attribute order variation. We DO NOT modify
 * inside the iframe-bootstrap script tag (matched on `id="rows-left"`
 * etc — script-tag IDs are handled separately).
 */
const SEED_PLAN = {
  "01-brb": [
    ["kicker", /<(span)\b([^>]*\bclass="[^"]*\bkicker\b[^"]*"[^>]*?)>/],
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
    ["subtitle", /<(p)\b([^>]*\bclass="[^"]*\bsubtitle\b[^"]*"[^>]*?)>/],
    ["season-mark", /<(div)\b([^>]*\bclass="[^"]*\bseason-mark\b[^"]*"[^>]*?)>/],
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
    ["partners-label", /<(span)\b([^>]*\bclass="[^"]*\bpartners-label\b[^"]*"[^>]*?)>/],
  ],
  "02-timer": [
    ["timer-badge", /<(div)\b([^>]*\bid="timer"[^>]*?)>/],
    ["timer-label", /<(div)\b([^>]*\bclass="timer__kicker"[^>]*?)>/],
    ["timer-display", /<(div)\b([^>]*\bid="timer-display"[^>]*?)>/],
  ],
  "04-h2h-2": [
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
  ],
  "05-h2h-3": [
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
  ],
  "06-h2h-5": [
    // 06-h2h-5 uses different class structure — minimal seed.
  ],
  "07-leaderboard": [
    ["eyebrow", /<(div)\b([^>]*\bclass="[^"]*\beyebrow\b[^"]*"[^>]*?)>/],
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
    ["matchday-mark", /<(div)\b([^>]*\bclass="[^"]*\bmatchday-mark\b[^"]*"[^>]*?)>/],
    ["season-mark", /<(div)\b([^>]*\bclass="[^"]*\bseason-mark\b[^"]*"[^>]*?)>/],
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
    ["top-band-logo", /<(img)\b([^>]*\bclass="logo-cade"[^>]*?)/],
  ],
  "08-lower-third": [
    // 08-lower-third uses dynamic anchor cards — element-id hooks added at script-injection time.
  ],
  "09-secondary-score-bug": [
    ["score-bug-card", /<(div)\b([^>]*\bclass="[^"]*\bbug-mount\b[^"]*"[^>]*?)>/],
  ],
  "10-up-next-bug": [
    ["up-next-card", /<(div)\b([^>]*\bclass="bug"\s+id="bug"[^>]*?)>/],
  ],
  "11-match-scores-day": [
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
    ["season-mark", /<(div)\b([^>]*\bclass="[^"]*\bseason-mark\b[^"]*"[^>]*?)>/],
  ],
  "12-starting-soon": [
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
    ["subtitle", /<(p)\b([^>]*\bclass="[^"]*\bsubtitle\b[^"]*"[^>]*?)>/],
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
  ],
  "13-stream-ended": [
    ["eyebrow", /<(span)\b([^>]*\bclass="[^"]*\bkicker\b[^"]*"[^>]*?)>/],
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
    ["subtitle", /<(p)\b([^>]*\bclass="[^"]*\bsubtitle\b[^"]*"[^>]*?)>/],
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
    ["season-mark", /<(div)\b([^>]*\bclass="[^"]*\bseason-mark\b[^"]*"[^>]*?)>/],
  ],
  "14-top-scorers": [
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
  ],
  "15-orgs": [
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
  ],
  "16-coaches": [
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
    ["partners-strip", /<(footer)\b([^>]*\bclass="[^"]*\bpartners\b[^"]*"[^>]*?)>/],
  ],
  "17-penalties": [
    ["title", /<(h1)\b([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*?)>/],
  ],
};

function injectAttr(html, elementId, regex) {
  // Skip if attr already present anywhere in the file.
  const exists = new RegExp(
    `data-element-id\\s*=\\s*["']${elementId}["']`,
  ).test(html);
  if (exists) return { html, hit: true, idempotent: true };

  const m = html.match(regex);
  if (!m) return { html, hit: false, idempotent: false };

  const matched = m[0];
  // Insert `data-element-id="..."` immediately after the tag name (before
  // existing attributes). For self-closing tags (`<img ...>`), the regex
  // captures everything up to the trailing `>` — we splice the attr in
  // before the closing `>`.
  const [, tagName] = m;
  const insertAt = matched.indexOf(tagName) + tagName.length;
  const replaced =
    matched.slice(0, insertAt) +
    ` data-element-id="${elementId}"` +
    matched.slice(insertAt);
  return {
    html: html.replace(matched, replaced),
    hit: true,
    idempotent: false,
  };
}

async function processOne(overlayKey, dryRun) {
  const path = join(SOURCE_ROOT, overlayKey, "index.html");
  if (!existsSync(path)) {
    return { overlayKey, missing: true, addedCount: 0, skippedCount: 0 };
  }
  let html = await readFile(path, "utf8");
  const plan = SEED_PLAN[overlayKey] ?? [];
  let added = 0;
  let skipped = 0;
  const skippedIds = [];
  for (const [elementId, regex] of plan) {
    const r = injectAttr(html, elementId, regex);
    if (!r.hit) {
      skipped += 1;
      skippedIds.push(elementId);
      continue;
    }
    if (!r.idempotent) added += 1;
    html = r.html;
  }
  if (added > 0 && !dryRun) {
    await writeFile(path, html, "utf8");
  }
  return { overlayKey, addedCount: added, skippedCount: skipped, skippedIds };
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const keys = Object.keys(SEED_PLAN);
  let totalAdded = 0;
  let totalSkipped = 0;
  for (const k of keys) {
    const r = await processOne(k, dryRun);
    if (r.missing) {
      console.warn(`[seed-element-ids] missing: ${k}`);
      continue;
    }
    totalAdded += r.addedCount;
    totalSkipped += r.skippedCount;
    if (r.addedCount === 0 && r.skippedCount === 0) continue;
    const skippedSuffix =
      r.skippedCount > 0 ? ` · ${r.skippedCount} not found: ${r.skippedIds.slice(0, 5).join(",")}` : "";
    console.log(
      `[seed-element-ids] ${k}: +${r.addedCount}${skippedSuffix}`,
    );
  }
  console.log(
    `[seed-element-ids] total: +${totalAdded} attrs added (${totalSkipped} skipped) · ${dryRun ? "DRY RUN" : "files written"}`,
  );
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(`[seed-element-ids] threw: ${e?.stack ?? e}`);
    process.exit(1);
  });
}

export { SEED_PLAN, injectAttr, processOne };
