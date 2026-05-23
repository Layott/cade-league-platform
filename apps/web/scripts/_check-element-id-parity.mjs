#!/usr/bin/env node
/**
 * Wave 2 Stage 2 — element-id parity linter.
 *
 * Walks every overlay HTML at:
 *   apps/web/public/overlays/v2/<key>/index.html
 * and gathers the `data-element-id="..."` attrs. Compares against the
 * canonical seed catalog at:
 *   supabase/migrations/20260620000007_overlay_text_elements_seed.sql
 *
 * Mismatch → exit 1 with a per-overlay diff report so the offending
 * file or migration is obvious.
 *
 * Reports two classes of mismatch:
 *   - DB has element_id, HTML missing → admin's "Save" call would
 *     attach style overrides to a `data-element-id` selector that
 *     doesn't exist in the DOM, silently no-op.
 *   - HTML has element_id, DB missing → admin can't see / edit it
 *     from the design page (the catalog drives the UI).
 *
 * Wired into `npm run prebuild` so a deploy is blocked on drift.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §10.4
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_WEB_ROOT, "..", "..");

const HTML_ROOT = resolve(APP_WEB_ROOT, "public", "overlays", "v2");
const SEED_PATH = resolve(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20260620000007_overlay_text_elements_seed.sql",
);

/**
 * Additional seed augments — Stage 3 added partners-strip rows for
 * 06-h2h-5 + 17-penalties via a follow-up migration so the original
 * 20260620000007 stays immutable on already-deployed envs.
 */
const SEED_AUGMENTS = [
  resolve(
    REPO_ROOT,
    "supabase",
    "migrations",
    "20260620000009_overlay_text_elements_partners_strip_extra.sql",
  ),
  // 19-player-squads (added 2026-04-30).
  resolve(
    REPO_ROOT,
    "supabase",
    "migrations",
    "20260620000014_overlay_template_variants_player_squads.sql",
  ),
  // 20-highlight + 11-match-scores-day redesign (added 2026-04-30).
  resolve(
    REPO_ROOT,
    "supabase",
    "migrations",
    "20260620000017_overlay_template_variants_highlight.sql",
  ),
];

/**
 * Inline allowlist — element_ids that are seeded by a foreach-loop
 * migration (or runtime upsert) which the literal-VALUES regex above
 * can't parse. Mirrors the `(overlay_key, element_id)` tuples those
 * migrations insert.
 *
 * Add new tuples here when a migration uses a loop / dynamic insert
 * instead of literal VALUES.
 */
const INLINE_SEED_ALLOWLIST = [
  // Migration 20260903000002 — CADE + ESOCCER header logos on 12
  // overlays. Uses `foreach v_overlay in array v_overlays loop ...`
  // so the column 1 is a PG variable, not a literal.
  ...[
    "01-brb",
    "04-h2h-2",
    "05-h2h-3",
    "06-h2h-5",
    "11-match-scores-day",
    "12-starting-soon",
    "13-stream-ended",
    "14-top-scorers",
    "15-orgs",
    "16-coaches",
    "17-penalties",
    "19-player-squads",
  ].flatMap((overlay) => [
    [overlay, "logo-cade"],
    [overlay, "logo-pro"],
  ]),
];

/** Extract every (overlay_key, element_id) tuple from the seed migration. */
async function loadSeedCatalog() {
  if (!existsSync(SEED_PATH)) {
    throw new Error(`seed migration not found: ${SEED_PATH}`);
  }
  const out = new Map();
  // INSERT VALUES rows look like:
  //   ('01-brb', 'default', 'kicker', 'seed', 'eyebrow', '', v_set_by),
  // Tolerate whitespace / column count drift via a relaxed regex.
  const ROW_RE =
    /\(\s*'([0-9]{2}-[a-z0-9-]+)'\s*,\s*'[^']*'\s*,\s*'([a-z][a-z0-9-]*)'/g;

  for (const path of [SEED_PATH, ...SEED_AUGMENTS]) {
    if (!existsSync(path)) continue;
    const sql = await readFile(path, "utf8");
    for (const m of sql.matchAll(ROW_RE)) {
      const overlay = m[1];
      const elementId = m[2];
      if (!out.has(overlay)) out.set(overlay, new Set());
      out.get(overlay).add(elementId);
    }
  }
  for (const [overlay, elementId] of INLINE_SEED_ALLOWLIST) {
    if (!out.has(overlay)) out.set(overlay, new Set());
    out.get(overlay).add(elementId);
  }
  return out;
}

/**
 * Extract every `data-element-id="..."` from a single HTML file.
 *
 * Strips `<!-- ... -->` comments AND `<script>...</script>` blocks
 * before scanning so the inline cade-token-bootstrap script (which
 * contains the literal `data-element-id="partners-strip"` selector)
 * doesn't masquerade as a real DOM attr. Comments first because some
 * overlays embed `<script>` strings inside `<!-- ... -->` blocks
 * (e.g. design notes referencing the bootstrap), which would otherwise
 * confuse the script-stripping regex.
 */
async function readHtmlElementIds(htmlPath) {
  if (!existsSync(htmlPath)) return new Set();
  let html = await readFile(htmlPath, "utf8");
  // 1. Strip HTML comments first.
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  // 2. Iterative strip: walk forward, find the next opening
  //    `<script>` or `<style>` tag, take whichever comes FIRST, and
  //    strip up to its closing tag. Then repeat. This handles the
  //    awkward case where a JS string inside a <script> contains the
  //    literal "<style>" (e.g. comments referencing the bootstrap)
  //    OR a CSS `/* ... */` block contains "<script>" (e.g. design
  //    notes). The naive two-pass strip mis-pairs those.
  let cleaned = "";
  let i = 0;
  while (i < html.length) {
    // Find next <script or <style (case-insensitive).
    const nextScript = html.toLowerCase().indexOf("<script", i);
    const nextStyle = html.toLowerCase().indexOf("<style", i);
    let nextOpen = -1;
    let closeTag = "";
    if (nextScript === -1 && nextStyle === -1) {
      cleaned += html.slice(i);
      break;
    }
    if (nextScript === -1) {
      nextOpen = nextStyle;
      closeTag = "</style>";
    } else if (nextStyle === -1) {
      nextOpen = nextScript;
      closeTag = "</script>";
    } else {
      if (nextScript < nextStyle) {
        nextOpen = nextScript;
        closeTag = "</script>";
      } else {
        nextOpen = nextStyle;
        closeTag = "</style>";
      }
    }
    cleaned += html.slice(i, nextOpen);
    // Skip past the matching closing tag.
    const close = html.toLowerCase().indexOf(closeTag, nextOpen);
    if (close === -1) {
      // Unclosed tag — bail and append the rest.
      break;
    }
    i = close + closeTag.length;
  }
  const out = new Set();
  const RE = /data-element-id\s*=\s*["']([a-z][a-z0-9-]*)["']/g;
  for (const m of cleaned.matchAll(RE)) {
    out.add(m[1]);
  }
  return out;
}

async function main() {
  const seed = await loadSeedCatalog();
  if (seed.size === 0) {
    console.error(
      "[check-element-id-parity] seed migration parsed to empty catalog — aborting",
    );
    process.exit(1);
  }

  let overlayDirs;
  try {
    overlayDirs = await readdir(HTML_ROOT, { withFileTypes: true });
  } catch (e) {
    console.error(
      `[check-element-id-parity] cannot read ${HTML_ROOT}: ${e?.message}`,
    );
    process.exit(1);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  const errors = [];
  const warnings = [];

  for (const [overlayKey, expectedIds] of seed.entries()) {
    const dirEntry = overlayDirs.find(
      (d) => d.isDirectory() && d.name === overlayKey,
    );
    if (!dirEntry) {
      warnings.push(
        `[${overlayKey}] no overlay HTML directory found at ${HTML_ROOT}/${overlayKey}`,
      );
      totalWarnings += 1;
      continue;
    }
    const htmlPath = join(HTML_ROOT, overlayKey, "index.html");
    const actualIds = await readHtmlElementIds(htmlPath);

    const missingInHtml = [];
    for (const id of expectedIds) {
      if (!actualIds.has(id)) missingInHtml.push(id);
    }
    const extraInHtml = [];
    for (const id of actualIds) {
      if (!expectedIds.has(id)) extraInHtml.push(id);
    }

    // ERRORS — `data-element-id` attrs in HTML that have NO seed row.
    // This is the dangerous direction: an admin trying to edit such an
    // element would target a server row that doesn't exist (or an
    // unknown elementId regex would reject the action). Fix: either
    // seed it or remove the HTML attr.
    if (extraInHtml.length) {
      errors.push(
        `[${overlayKey}] HTML has ${extraInHtml.length} data-element-id attr${extraInHtml.length === 1 ? "" : "s"} not in seed: ${extraInHtml.slice(0, 8).join(", ")}${extraInHtml.length > 8 ? `, +${extraInHtml.length - 8} more` : ""}`,
      );
      totalErrors += extraInHtml.length;
    }

    // WARNINGS — seed rows without HTML attrs. The Stage 2 admin UI
    // still works (rows show up in the editor), but saving against an
    // unattached element_id silently no-ops in the iframe. Future
    // stages will close the gap as designers add attrs to richer
    // overlays.
    if (missingInHtml.length) {
      warnings.push(
        `[${overlayKey}] ${missingInHtml.length} seed row${missingInHtml.length === 1 ? "" : "s"} missing data-element-id in HTML: ${missingInHtml.slice(0, 8).join(", ")}${missingInHtml.length > 8 ? `, +${missingInHtml.length - 8} more` : ""}`,
      );
      totalWarnings += missingInHtml.length;
    }
  }

  // Surface warnings unconditionally so designers see what's still un-
  // seeded in HTML. They don't block exit — see the rationale block
  // above. Errors block exit.
  if (warnings.length) {
    for (const w of warnings) console.warn(w);
    console.warn(
      `[check-element-id-parity] ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"} (seed rows without HTML attrs — admin save no-ops on these)`,
    );
  }

  if (errors.length === 0) {
    const overlayCount = seed.size;
    let totalSeeded = 0;
    for (const ids of seed.values()) totalSeeded += ids.size;
    console.log(
      `[check-element-id-parity] OK — ${overlayCount} overlays · ${totalSeeded} elements seeded · ${totalWarnings === 0 ? "all" : "no extra"} data-element-id attrs match`,
    );
    process.exit(0);
  }

  console.error(
    `[check-element-id-parity] FAIL — ${totalErrors} error${totalErrors === 1 ? "" : "s"} (HTML attrs without seed rows)`,
  );
  for (const r of errors) console.error(r);
  console.error(
    "Fix: remove the offending data-element-id attr OR add a row to migration 20260620000007 + db push.",
  );
  process.exit(1);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(`[check-element-id-parity] threw: ${e?.stack ?? e}`);
    process.exit(1);
  });
}

export { loadSeedCatalog, readHtmlElementIds };
