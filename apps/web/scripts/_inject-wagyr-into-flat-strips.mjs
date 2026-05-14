/**
 * Companion to `_inject-wagyr-into-marquees.mjs`.
 *
 * A few overlays (11-match-scores-day, 20-highlight) render the partner
 * strip as a FLAT footer with one img per partner — no marquee dupes,
 * and they ship with only 4 partners hardcoded (gameevo / pride /
 * africa / trace; OAS was never added).
 *
 * The marquee patcher targeted `partner--oas`, so these overlays were
 * skipped. This pass appends BOTH the missing OAS row and the new
 * WAGYR row directly after `partner--trace`, mirroring the 6-partner
 * roster carried by the DB-driven runtime.
 *
 * Idempotent — skips when `partner--wagyr` is already present.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
];

const TRACE_RE = /^(\s*)<img\s+class="partner\s+partner--trace"[^>]*src="([^"]+)"[^>]*alt="([^"]*)"\s*\/>\s*$/;

function prefixFor(traceSrc) {
  if (traceSrc.startsWith("/overlays/v2/_assets/logos/")) {
    return "/overlays/v2/_assets/logos/processed/";
  }
  return "../../../logos/processed/";
}

function patchHtml(html) {
  if (html.includes("partner--wagyr")) return null;
  // Only patch overlays missing the OAS line — marquee overlays already
  // got `partner--oas` then `partner--wagyr` from the prior script.
  if (html.includes("partner--oas")) return null;

  const out = [];
  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = line.match(TRACE_RE);
    if (m) {
      const [, indent, src, alt] = m;
      const pre = prefixFor(src);
      const altOas = alt === "" ? "" : "OAS esport";
      const altWagyr = alt === "" ? "" : "WAGYR";
      out.push(`${indent}<img class="partner partner--oas"     src="${pre}OAS_colored_strip.png" alt="${altOas}" />`);
      out.push(`${indent}<img class="partner partner--wagyr"   src="${pre}WAGYR_strip.png" alt="${altWagyr}" />`);
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
