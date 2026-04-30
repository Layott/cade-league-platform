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
  "19-player-squads",
  "20-highlight",
];

/**
 * The unified Stage 4 bootstrap.
 *
 * Decodes 8 base64-encoded JSON URL params:
 *   tokens                 — Phase A persisted CSS-variable tokens
 *   previewTokens          — Phase A admin live-preview overrides
 *   textTokens             — Stage 2 persisted text-element overrides
 *   previewTextTokens      — Stage 2 admin live-preview overrides
 *   partnerTokens          — Stage 3 persisted partner strip + logos
 *   previewPartnerTokens   — Stage 3 admin live-preview partner overrides
 *   animTokens             — Stage 4 persisted element animations
 *   previewAnimTokens      — Stage 4 admin live-preview animations
 *
 * Outputs:
 *   <style id="cade-injected-tokens"> with :root{...} CSS variables
 *   <style id="cade-injected-text"> with [data-element-id="X"]{...} rules
 *   <style id="cade-injected-partners-layout"> with strip layout CSS
 *   <style id="cade-injected-anim-keyframes"> with @keyframes blocks
 *   <style id="cade-injected-anim-rules"> with phase-gated animation rules
 *   DOM mutations:
 *     - textContent on each [data-element-id="X"] when tokens carry a
 *       `content` string.
 *     - rebuild children of [data-element-id="partners-strip"] when
 *       partner logos are supplied.
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
  // Wave 2 Stage 3 — cross-document design + text + partner propagation.
  //
  // Read base64-encoded JSON token maps from the iframe URL query
  // string and emit <style> blocks that win the CSS source-order
  // cascade (appended LATER in <head> than the author defaults).
  //
  // Token shapes:
  //   tokens / previewTokens     — { 'bg-color': '#000', ... }
  //   textTokens / previewTextTokens — { '<elementId>': { visible?,
  //     content?, styles?: { color, fontFamily, fontSize, ... } } }
  //   partnerTokens / previewPartnerTokens — {
  //     layout?: { anchor, positionXPx, positionYPx, scalePct,
  //                itemSpacingPx, orientation, justification,
  //                zIndex, visible },
  //     logos?: [ { partnerKey, label, alt, fileUrl, visible?, sort? } ]
  //   }
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
        // Sentinel "none" → CSS keyword (turn off background image entirely
        // so var(--overlay-bg-image, url(default)) resolves to none and
        // does NOT fall through to the HTML hard-coded default).
        if (safe === 'none') {
          parts.push('--overlay-' + k + ': none');
        } else {
          parts.push('--overlay-' + k + ': url("' + safe + '")');
        }
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
  function buildPartnerLayoutRule(layout) {
    if (!layout || typeof layout !== 'object') return '';
    if (layout.visible === false) {
      return '[data-element-id="partners-strip"]{display:none !important;}';
    }
    var declarations = [];
    declarations.push('display:flex');
    declarations.push('flex-direction:' + (layout.orientation === 'vertical' ? 'column' : 'row'));
    declarations.push('justify-content:' + sanitizeCss(layout.justification || 'center'));
    declarations.push('align-items:center');
    declarations.push('gap:' + ((+layout.itemSpacingPx) || 0) + 'px');
    declarations.push('z-index:' + ((+layout.zIndex) || 12));
    declarations.push('position:absolute');
    var anchor = layout.anchor || 'bottom-center';
    var px = (+layout.positionXPx) || 0;
    var py = (+layout.positionYPx) || 0;
    var sx = ((+layout.scalePct) || 100) / 100;
    var transformOps = [];
    if (anchor.indexOf('top') === 0) {
      declarations.push('top:' + py + 'px');
      declarations.push('bottom:auto');
    } else if (anchor.indexOf('bottom') === 0) {
      declarations.push('bottom:' + (1080 - py) + 'px');
      declarations.push('top:auto');
    } else {
      declarations.push('top:' + py + 'px');
      declarations.push('bottom:auto');
      transformOps.push('translateY(-50%)');
    }
    if (anchor.indexOf('left') !== -1) {
      declarations.push('left:' + px + 'px');
      declarations.push('right:auto');
    } else if (anchor.indexOf('right') !== -1) {
      declarations.push('right:' + (1920 - px) + 'px');
      declarations.push('left:auto');
    } else {
      declarations.push('left:50%');
      declarations.push('right:auto');
      transformOps.push('translateX(-50%)');
    }
    if (sx !== 1) transformOps.push('scale(' + sx + ')');
    if (transformOps.length) {
      declarations.push('transform:' + transformOps.join(' '));
      declarations.push('transform-origin:center center');
    }
    return '[data-element-id="partners-strip"]{' + declarations.join(';') + ';}';
  }
  function applyPartnerLogos(logos, layout) {
    if (!Array.isArray(logos)) return false;
    var strip = document.querySelector('[data-element-id="partners-strip"]');
    if (!strip) return false;
    // Filter visible + sort.
    var sorted = logos
      .filter(function(l) { return l && l.visible !== false && typeof l.fileUrl === 'string'; })
      .slice()
      .sort(function(a, b) {
        var sa = typeof a.sort === 'number' ? a.sort : 999;
        var sb = typeof b.sort === 'number' ? b.sort : 999;
        return sa - sb;
      });
    if (sorted.length === 0 && (!layout || layout.visible !== false)) {
      // No logos but layout present — leave existing children alone.
      return false;
    }
    // Wipe existing children.
    while (strip.firstChild) strip.removeChild(strip.firstChild);
    // Mark as flex container so the layout CSS takes effect even without
    // browser quirks.
    sorted.forEach(function(l) {
      var img = document.createElement('img');
      var safeKey = sanitizeCss(l.partnerKey || 'x');
      img.className = 'partner partner--' + safeKey;
      img.src = sanitizeCss(l.fileUrl);
      img.alt = sanitizeCss(l.alt || l.label || '');
      img.setAttribute('data-partner-key', safeKey);
      strip.appendChild(img);
    });
    return true;
  }
  // ────────── Stage 4 — element animations ──────────
  //
  // Build @keyframes BODY for a given preset anim type. Mirrors
  // server/overlays/animations/elements.ts::buildKeyframesBody — same
  // values across server-side resolver + client-side bootstrap so
  // SSR-emitted styles + URL-borne overrides yield identical motion.
  function buildPresetKeyframes(animType, name, customBody) {
    switch (animType) {
      case 'slide-left':
        return '@keyframes ' + name + '{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:translateX(0)}}';
      case 'slide-right':
        return '@keyframes ' + name + '{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:translateX(0)}}';
      case 'slide-up':
        return '@keyframes ' + name + '{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}';
      case 'slide-down':
        return '@keyframes ' + name + '{from{opacity:0;transform:translateY(-32px)}to{opacity:1;transform:translateY(0)}}';
      case 'fade':
        return '@keyframes ' + name + '{from{opacity:0}to{opacity:1}}';
      case 'scale':
        return '@keyframes ' + name + '{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}';
      case 'rotate':
        return '@keyframes ' + name + '{from{opacity:0;transform:rotate(-12deg)}to{opacity:1;transform:rotate(0)}}';
      case 'bounce':
        return '@keyframes ' + name + '{0%{opacity:0;transform:translateY(20px)}60%{transform:translateY(-6px)}100%{opacity:1;transform:translateY(0)}}';
      case 'pulse':
        return '@keyframes ' + name + '{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}}';
      case 'glow':
        return '@keyframes ' + name + '{0%{filter:drop-shadow(0 0 0 rgba(107,205,6,0))}50%{filter:drop-shadow(0 0 24px rgba(107,205,6,0.55))}100%{filter:drop-shadow(0 0 0 rgba(107,205,6,0))}}';
      case 'shake':
        return '@keyframes ' + name + '{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}';
      case 'flip':
        return '@keyframes ' + name + '{from{opacity:0;transform:perspective(800px) rotateY(-90deg)}to{opacity:1;transform:perspective(800px) rotateY(0)}}';
      case 'custom-css':
        // Defence-in-depth: strip url(), at-rules, and angle/backtick
        // characters even if server sanitizer was bypassed (URL-borne).
        if (typeof customBody !== 'string') return '';
        if (/\\burl\\s*\\(/i.test(customBody)) return '';
        if (/@(import|font-face|charset|media|supports|keyframes)\\b/i.test(customBody)) return '';
        if (/[<>\\\`]/.test(customBody)) return '';
        return '@keyframes ' + name + '{' + customBody + '}';
      case 'none':
      default:
        return '';
    }
  }
  function buildAnimRulesAndKeyframes(tokens) {
    if (!tokens || typeof tokens !== 'object') return { keyframes: '', rules: '' };
    var keyframesParts = [];
    var rulesParts = [];
    for (var elId in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, elId)) continue;
      if (!/^[a-z][a-z0-9-]*$/.test(elId)) continue;
      var phases = tokens[elId];
      if (!phases || typeof phases !== 'object') continue;
      for (var phase in phases) {
        if (!Object.prototype.hasOwnProperty.call(phases, phase)) continue;
        if (phase !== 'entry' && phase !== 'exit' && phase !== 'continuous') continue;
        var p = phases[phase];
        if (!p || typeof p !== 'object') continue;
        if (p.enabled === false) continue;
        if (!p.animType || p.animType === 'none') continue;
        var animName = 'cade-' + elId + '-' + phase;
        var kf = buildPresetKeyframes(
          p.animType,
          animName,
          p.customCssKeyframes || ''
        );
        if (!kf) continue;
        keyframesParts.push(kf);
        var duration = (+p.durationMs) || 360;
        var delay = (+p.delayMs) || 0;
        var easing = sanitizeCss(p.easing || 'ease-out');
        var iterations = sanitizeCss(p.iterationCount || '1');
        // Phase-gated selector. Continuous animations only run while
        // the overlay is visible (cade-visible class on body).
        var sel =
          phase === 'exit'
            ? 'body.cade-exiting [data-element-id="' + elId + '"]'
            : 'body.cade-visible [data-element-id="' + elId + '"]';
        var rule =
          'animation:' + animName +
          ' ' + duration + 'ms' +
          ' ' + easing +
          ' ' + delay + 'ms' +
          ' ' + iterations +
          ' both;';
        rulesParts.push(sel + '{' + rule + '}');
      }
    }
    return {
      keyframes: keyframesParts.join('\\n'),
      rules: rulesParts.join('\\n'),
    };
  }
  try {
    var qs = new URLSearchParams(location.search);
    var design = decodeTokens(qs.get('tokens'));
    var preview = decodeTokens(qs.get('previewTokens'));
    var textTokens = decodeTokens(qs.get('textTokens'));
    var previewTextTokens = decodeTokens(qs.get('previewTextTokens'));
    var partnerTokens = decodeTokens(qs.get('partnerTokens'));
    var previewPartnerTokens = decodeTokens(qs.get('previewPartnerTokens'));
    var animTokens = decodeTokens(qs.get('animTokens'));
    var previewAnimTokens = decodeTokens(qs.get('previewAnimTokens'));
    // Source order: design first, preview second so preview wins.
    var cssVarRule = buildCssVars(design) + buildCssVars(preview);
    var textRule = buildTextRules(textTokens) + (buildTextRules(textTokens).length && buildTextRules(previewTextTokens).length ? '\\n' : '') + buildTextRules(previewTextTokens);
    // Partner layout: preview wins by being applied second (later
    // <style> block wins on identical selector via source-order).
    var partnerRules = [];
    if (partnerTokens && partnerTokens.layout) {
      var r1 = buildPartnerLayoutRule(partnerTokens.layout);
      if (r1) partnerRules.push(r1);
    }
    if (previewPartnerTokens && previewPartnerTokens.layout) {
      var r2 = buildPartnerLayoutRule(previewPartnerTokens.layout);
      if (r2) partnerRules.push(r2);
    }
    // Stage 4 — element animations. Build keyframes + rules from both
    // design + preview maps. Source-order wins on identical names: the
    // preview block emits second, so its keyframes & rules overwrite
    // design's via CSS cascade (same selector + same animation-name).
    var animDesign = buildAnimRulesAndKeyframes(animTokens);
    var animPreview = buildAnimRulesAndKeyframes(previewAnimTokens);
    var animKeyframesCss = animDesign.keyframes +
      (animDesign.keyframes && animPreview.keyframes ? '\\n' : '') +
      animPreview.keyframes;
    var animRulesCss = animDesign.rules +
      (animDesign.rules && animPreview.rules ? '\\n' : '') +
      animPreview.rules;
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
      if (partnerRules.length) {
        var s3 = document.createElement('style');
        s3.id = 'cade-injected-partners-layout';
        s3.textContent = partnerRules.join('\\n');
        document.head.appendChild(s3);
      }
      // Stage 4 — animation keyframes block FIRST (must precede rules
      // so the named animations resolve).
      if (animKeyframesCss) {
        var s4 = document.createElement('style');
        s4.id = 'cade-injected-anim-keyframes';
        s4.textContent = animKeyframesCss;
        document.head.appendChild(s4);
      }
      if (animRulesCss) {
        var s5 = document.createElement('style');
        s5.id = 'cade-injected-anim-rules';
        s5.textContent = animRulesCss;
        document.head.appendChild(s5);
      }
      // Apply textContent edits AFTER DOM is parsed.
      applyTextContent(textTokens);
      applyTextContent(previewTextTokens);
      // Rebuild partner strip children — preview wins by being applied
      // second (overwrites design's children).
      if (partnerTokens && Array.isArray(partnerTokens.logos)) {
        applyPartnerLogos(partnerTokens.logos, partnerTokens.layout);
      }
      if (previewPartnerTokens && Array.isArray(previewPartnerTokens.logos)) {
        applyPartnerLogos(previewPartnerTokens.logos, previewPartnerTokens.layout);
      }
      // Phase D — partner-strip scroll. Token \`partner-strip-scroll\`
      // controls whether logos scroll continuously sideways. When "true",
      // wrap the strip's children in a flex track + clone them once for
      // a seamless 50% translateX loop. Inject @keyframes + animation
      // rule via a dedicated <style> block so OBS sees the motion.
      var scrollOn = false;
      if (design && design['partner-strip-scroll'] === 'true') scrollOn = true;
      if (preview && preview['partner-strip-scroll'] === 'true') scrollOn = true;
      if (preview && preview['partner-strip-scroll'] === 'false') scrollOn = false;
      if (scrollOn) {
        var stripScroll = document.querySelector('[data-element-id="partners-strip"]');
        if (stripScroll && !stripScroll.querySelector('.cade-partner-track')) {
          var kids = Array.from(stripScroll.children);
          if (kids.length > 0) {
            var track = document.createElement('div');
            track.className = 'cade-partner-track';
            kids.forEach(function(c) { track.appendChild(c); });
            kids.forEach(function(c) { track.appendChild(c.cloneNode(true)); });
            stripScroll.appendChild(track);
            var s6 = document.createElement('style');
            s6.id = 'cade-injected-partner-scroll';
            s6.textContent =
              '[data-element-id="partners-strip"]{overflow:hidden !important;}' +
              '.cade-partner-track{display:flex;align-items:center;flex-wrap:nowrap;width:max-content;gap:inherit;animation:cade-partner-scroll 35s linear infinite;}' +
              '@keyframes cade-partner-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}';
            document.head.appendChild(s6);
          }
        }
      }
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
