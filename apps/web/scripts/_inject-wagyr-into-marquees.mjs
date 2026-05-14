/**
 * One-shot patch: inject the WAGYR partner cell into every overlay HTML
 * that hardcodes the marquee strip.
 *
 * The DB-driven partner roster (overlay_partner_logos) is the runtime
 * source of truth, but a handful of overlays bake a marquee directly
 * into static HTML (01-brb + 13-stream-ended + 12-starting-soon, etc).
 * The bootstrap rebuild path replaces those imgs on `partnerTokens`
 * payloads, but the DEFAULT render (no token URL param yet — first
 * paint, single-shot OBS load, AI-design exports) must include WAGYR
 * too so the strip never looks out-of-roster.
 *
 * For each overlay HTML in BOTH roots:
 *   1. Find every `partner--oas` <img> line. Insert a matching WAGYR
 *      line directly below, mimicking indent, alt text, src convention.
 *   2. Find the `.marquee-group .partner--oas { height: Npx; }` rule.
 *      Append a sibling rule for `.partner--wagyr` with the same height.
 *
 * Idempotent — if `partner--wagyr` already appears in the file, skip.
 *
 * Walks index.html under both source roots; portable / archive variants
 * are out of scope (regenerated on demand by designers).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
];

// Match the OAS partner img line — captures leading whitespace, then
// the inner alt attribute so we can mirror it (alt="OAS esport" in the
// announcing copy, alt="" in the visual dupes).
const IMG_RE = /^(\s*)<img\s+class="partner\s+partner--oas"[^>]*src="([^"]+)"[^>]*alt="([^"]*)"\s*\/>\s*$/;

// Match a CSS height rule for partner--oas inside the marquee group.
const CSS_RE = /^(\s*)\.marquee-group\s+\.partner--oas\s*\{\s*height:\s*(\d+)px;\s*\}\s*$/;

function wagyrSrcFor(oasSrc) {
  // The OAS src reveals whether we're in the source root (uses
  // `../../../logos/processed/...`) or in the public mirror (uses
  // `/overlays/v2/_assets/logos/processed/...`). Mirror that prefix.
  if (oasSrc.startsWith("/overlays/v2/_assets/logos/")) {
    return "/overlays/v2/_assets/logos/processed/WAGYR_strip.png";
  }
  return "../../../logos/processed/WAGYR_strip.png";
}

function patchHtml(html) {
  if (html.includes("partner--wagyr")) return null; // already patched
  const out = [];
  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);

    const imgMatch = line.match(IMG_RE);
    if (imgMatch) {
      const [, indent, src, alt] = imgMatch;
      const newSrc = wagyrSrcFor(src);
      const altOut = alt === "" ? "" : "WAGYR";
      out.push(`${indent}<img class="partner partner--wagyr"   src="${newSrc}" alt="${altOut}" />`);
      continue;
    }

    const cssMatch = line.match(CSS_RE);
    if (cssMatch) {
      const [, indent, height] = cssMatch;
      out.push(`${indent}.marquee-group .partner--wagyr    { height: ${height}px; }`);
      continue;
    }
  }
  return out.join("\n");
}

let patched = 0;
let scanned = 0;
for (const root of ROOTS) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue;
    const file = join(root, entry.name, "index.html");
    let html;
    try {
      html = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scanned++;
    const next = patchHtml(html);
    if (next !== null && next !== html) {
      writeFileSync(file, next, "utf8");
      patched++;
      console.log(`  patched: ${file}`);
    }
  }
}
console.log(`\nScanned ${scanned}, patched ${patched}.`);
