#!/usr/bin/env node
/**
 * Wave 2 Stage 2 — bootstrap script extension.
 *
 * Walks every source overlay HTML at:
 *   KNOWLEDGE/brand-assets/elements/v2/<key>/index.html
 *
 * Two operations:
 *   1. If the overlay has the existing Phase A `<script id="cade-token-
 *      bootstrap">` block, REPLACE its contents with the unified Stage 2
 *      bootstrap (which handles tokens + previewTokens + textTokens +
 *      previewTextTokens).
 *   2. If the overlay doesn't have the bootstrap (the 7 that pre-date
 *      Phase A), INJECT the unified bootstrap immediately after the
 *      `<title>...</title>` tag.
 *
 * Idempotent — running twice writes the same result. The unified
 * bootstrap is identical across all 16 overlays (one source of truth).
 *
 * Usage:
 *   node apps/web/scripts/_extend-bootstrap-script.mjs           # mutate
 *   node apps/web/scripts/_extend-bootstrap-script.mjs --dry     # preview
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §6.2
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

const KEYS = [
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
];

/**
 * The unified Stage 2 bootstrap.
 *
 * Decodes 4 base64-encoded JSON URL params:
 *   tokens             — Phase A persisted CSS-variable tokens
 *   previewTokens      — Phase A admin live-preview overrides
 *   textTokens         — Stage 2 persisted text-element overrides
 *   previewTextTokens  — Stage 2 admin live-preview overrides
 *
 * Outputs:
 *   <style id="cade-injected-tokens"> with :root{...} CSS variables
 *   <style id="cade-injected-text"> with [data-element-id="X"]{...} rules
 *   DOM mutations: textContent on each [data-element-id="X"] when
 *     tokens carry a `content` string.
 *
 * Wrapped in IIFE — no globals. Defers to DOMContentLoaded so the
 * appended <style> blocks land AFTER author <style> blocks (CSS
 * source-order cascade — our overrides win).
 *
 * MUST never throw — exception swallowed so a corrupt URL param can't
 * white-flash the overlay (CLAUDE.md §14 contract).
 */
const BOOTSTRAP = `<script id="cade-token-bootstrap">
(function() {
  // Wave 2 Stage 2 — cross-document design + text-element propagation.
  //
  // Read base64-encoded JSON token maps from the iframe URL query
  // string and emit two <style> blocks that win the CSS source-order
  // cascade (appended LATER in <head> than the author defaults).
  //
  // Token shapes:
  //   tokens / previewTokens     — { 'bg-color': '#000', ... }
  //   textTokens / previewTextTokens — { '<elementId>': { visible?,
  //     content?, styles?: { color, fontFamily, fontSize, ... } } }
  //
  // Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §6.2
  function decodeTokens(param) {
    if (!param) return null;
    try {
      var json = decodeURIComponent(escape(atob(param)));
      var obj = JSON.parse(json);
      if (typeof obj !== 'object' || !obj) return null;
      return obj;
    } catch (e) { return null; }
  }
  function buildCssVars(tokens) {
    if (!tokens) return '';
    var parts = [];
    var imageKeys = { 'bg-image': 1 };
    for (var k in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, k)) continue;
      var v = tokens[k];
      if (typeof v !== 'string') continue;
      var safe = v.replace(/[;{}<>"']/g, '');
      if (imageKeys[k]) {
        if (!safe) continue;
        parts.push('--overlay-' + k + ': url("' + safe + '")');
      } else {
        if (!safe) continue;
        parts.push('--overlay-' + k + ': ' + safe);
      }
    }
    return parts.length ? ':root{' + parts.join(';') + ';}' : '';
  }
  function sanitizeCss(v) {
    return String(v == null ? '' : v).replace(/[;{}<>"\\\\\`]/g, '');
  }
  function buildTextRules(tokens) {
    if (!tokens || typeof tokens !== 'object') return '';
    var rules = [];
    for (var elId in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, elId)) continue;
      if (!/^[a-z][a-z0-9-]*$/.test(elId)) continue;
      var t = tokens[elId];
      if (!t || typeof t !== 'object') continue;
      var s = t.styles || {};
      var declarations = [];
      if (s.color)         declarations.push('color:' + sanitizeCss(s.color));
      if (s.fontFamily)    declarations.push("font-family:'" + sanitizeCss(s.fontFamily) + "'");
      if (s.fontWeight)    declarations.push('font-weight:' + (+s.fontWeight || 400));
      if (s.fontSize)      declarations.push('font-size:' + sanitizeCss(s.fontSize));
      if (s.letterSpacing) declarations.push('letter-spacing:' + sanitizeCss(s.letterSpacing));
      if (s.lineHeight != null) declarations.push('line-height:' + (+s.lineHeight || 1));
      if (s.textAlign)     declarations.push('text-align:' + sanitizeCss(s.textAlign));
      if (s.opacity != null) declarations.push('opacity:' + (+s.opacity || 0));
      if (s.left)          declarations.push('left:' + sanitizeCss(s.left));
      if (s.top)           declarations.push('top:' + sanitizeCss(s.top));
      if (s.zIndex != null) declarations.push('z-index:' + (+s.zIndex || 0));
      if (s.left || s.top) declarations.push('position:absolute');
      if (t.visible === false) declarations.push('display:none');
      if (declarations.length) {
        rules.push('[data-element-id="' + elId + '"]{' + declarations.join(';') + ';}');
      }
    }
    return rules.join('\\n');
  }
  function applyTextContent(tokens) {
    if (!tokens || typeof tokens !== 'object') return;
    for (var elId in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, elId)) continue;
      if (!/^[a-z][a-z0-9-]*$/.test(elId)) continue;
      var t = tokens[elId];
      if (!t || typeof t !== 'object') continue;
      if (typeof t.content !== 'string') continue;
      if (t.content === '' || t.content == null) continue;
      var node = document.querySelector('[data-element-id="' + elId + '"]');
      if (!node) continue;
      try { node.textContent = t.content; } catch (e) { /* read-only */ }
    }
  }
  try {
    var qs = new URLSearchParams(location.search);
    var design = decodeTokens(qs.get('tokens'));
    var preview = decodeTokens(qs.get('previewTokens'));
    var textTokens = decodeTokens(qs.get('textTokens'));
    var previewTextTokens = decodeTokens(qs.get('previewTextTokens'));
    // Source order: design first, preview second so preview wins.
    var cssVarRule = buildCssVars(design) + buildCssVars(preview);
    var textRule = buildTextRules(textTokens) + (buildTextRules(textTokens).length && buildTextRules(previewTextTokens).length ? '\\n' : '') + buildTextRules(previewTextTokens);
    var emit = function() {
      if (!document.head) return;
      if (cssVarRule) {
        var s1 = document.createElement('style');
        s1.id = 'cade-injected-tokens';
        s1.textContent = cssVarRule;
        document.head.appendChild(s1);
      }
      if (textRule) {
        var s2 = document.createElement('style');
        s2.id = 'cade-injected-text';
        s2.textContent = textRule;
        document.head.appendChild(s2);
      }
      // Apply textContent edits AFTER DOM is parsed.
      applyTextContent(textTokens);
      applyTextContent(previewTextTokens);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', emit);
    } else {
      emit();
    }
  } catch (e) {
    // Bootstrap MUST never throw — fall back to HTML defaults.
  }
})();
</script>`;

const BOOTSTRAP_OPEN = '<script id="cade-token-bootstrap">';
const BOOTSTRAP_CLOSE = "</script>";

/**
 * Replace the existing <script id="cade-token-bootstrap"> block (or
 * inject a fresh one immediately after </title>) with the unified
 * Stage 2 bootstrap.
 */
function applyBootstrap(html) {
  // 1. Already has the bootstrap? Replace its contents.
  const openIdx = html.indexOf(BOOTSTRAP_OPEN);
  if (openIdx !== -1) {
    // Find the matching closing tag — first </script> after the opening.
    const closeIdx = html.indexOf(BOOTSTRAP_CLOSE, openIdx);
    if (closeIdx === -1) {
      throw new Error("malformed cade-token-bootstrap script — no closing tag");
    }
    const before = html.slice(0, openIdx);
    const after = html.slice(closeIdx + BOOTSTRAP_CLOSE.length);
    return { html: before + BOOTSTRAP + after, action: "replaced" };
  }

  // 2. No bootstrap yet — inject after </title>.
  const titleClose = "</title>";
  const titleIdx = html.indexOf(titleClose);
  if (titleIdx === -1) {
    throw new Error("no </title> tag found — cannot inject bootstrap");
  }
  const insertAt = titleIdx + titleClose.length;
  return {
    html: html.slice(0, insertAt) + "\n\n" + BOOTSTRAP + "\n" + html.slice(insertAt),
    action: "injected",
  };
}

async function processOne(overlayKey, dryRun) {
  const path = join(SOURCE_ROOT, overlayKey, "index.html");
  if (!existsSync(path)) {
    return { overlayKey, missing: true };
  }
  const orig = await readFile(path, "utf8");
  const { html, action } = applyBootstrap(orig);
  if (html === orig) {
    return { overlayKey, action: "noop" };
  }
  if (!dryRun) await writeFile(path, html, "utf8");
  return { overlayKey, action };
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  for (const k of KEYS) {
    try {
      const r = await processOne(k, dryRun);
      if (r.missing) {
        console.warn(`[extend-bootstrap] missing: ${k}`);
        continue;
      }
      console.log(`[extend-bootstrap] ${k}: ${r.action}`);
    } catch (e) {
      console.error(`[extend-bootstrap] ${k}: ERROR ${e?.message}`);
      process.exitCode = 1;
    }
  }
  console.log(
    `[extend-bootstrap] done · ${dryRun ? "DRY RUN" : "files written"}`,
  );
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(`[extend-bootstrap] threw: ${e?.stack ?? e}`);
    process.exit(1);
  });
}

export { BOOTSTRAP, applyBootstrap };
