/**
 * One-shot: inject the WAGYR partner into the two strip patterns that
 * the earlier WAGYR rollouts (`_inject-wagyr-into-marquees.mjs` and
 * `_inject-wagyr-into-flat-strips.mjs`) missed:
 *
 *   1. Cover-up overlays (21-29) — single-line `<footer class="partners">`
 *      with 5 inline `<img class="partner" ...>` children. Earlier
 *      injectors keyed on `partner--<slug>` modifier classes, which
 *      these footers don't carry.
 *
 *   2. 18-partners-strip — JS-generated marquee fed from a top-level
 *      `const partners = [...]` array. Append a 6th object after the
 *      existing OAS entry.
 *
 * For each match, we also touch the public mirror under
 * `apps/web/public/overlays/v2/` so the sync script doesn't need a
 * fresh re-run for callers that don't run prebuild locally. Idempotent
 * — skip when WAGYR is already present.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
];

const COVER_UP_KEYS = new Set([
  "21-streaks",
  "22-power-rankings",
  "23-org-standings",
  "24-biggest-margins",
  "25-did-you-know",
  "26-card-meta",
  "27-schedule",
  "28-punditry",
  "29-goalfests",
]);

const COVER_UP_OAS_IMG_RE =
  /(<img\s+class="partner"\s+src="([^"]*\/OAS_colored_org\.png|[^"]*\/OAS%20esport_strip\.png)"\s+alt="[^"]*"\s*\/?>)/;

function wagyrImgFor(oasSrc) {
  if (oasSrc.startsWith("/overlays/v2/_assets/logos/")) {
    return `<img class="partner" src="/overlays/v2/_assets/logos/processed/WAGYR_strip.png" alt="WAGYR">`;
  }
  return `<img class="partner" src="../../../logos/processed/WAGYR_strip.png" alt="WAGYR">`;
}

function patchCoverUp(html) {
  if (html.includes("WAGYR")) return null;
  const m = html.match(COVER_UP_OAS_IMG_RE);
  if (!m) return null;
  const oasTag = m[1];
  const oasSrc = m[2];
  const wagyrTag = wagyrImgFor(oasSrc);
  return html.replace(oasTag, oasTag + wagyrTag);
}

const PARTNERS_ARRAY_OAS_RE =
  /(\{\s*name:\s*"OAS esport",\s*shortName:\s*"OAS",\s*src:\s*"[^"]+"\s*\})/;

function patchPartnersStrip(html) {
  if (html.includes("WAGYR")) return null;
  const m = html.match(PARTNERS_ARRAY_OAS_RE);
  if (!m) return null;
  const oasObj = m[1];
  // Mirror the OAS object's `src` URL prefix when picking the WAGYR path
  // so the source HTML keeps `../../../` references and the public mirror
  // keeps the rewritten `/overlays/v2/_assets/` references.
  const isPublicMirror = oasObj.includes("/overlays/v2/_assets/logos/");
  const wagyrSrc = isPublicMirror
    ? "/overlays/v2/_assets/logos/processed/WAGYR_strip.png"
    : "../../../logos/processed/WAGYR_strip.png";
  const wagyrObj = `,\n    {\n      name: "WAGYR",\n      shortName: "WAGYR",\n      src: "${wagyrSrc}"\n    }`;
  return html.replace(oasObj, oasObj + wagyrObj);
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
    let next = null;
    if (COVER_UP_KEYS.has(entry.name)) {
      next = patchCoverUp(html);
    } else if (entry.name === "18-partners-strip") {
      next = patchPartnersStrip(html);
    }
    if (next !== null && next !== html) {
      writeFileSync(file, next, "utf8");
      patched++;
      console.log(`  patched: ${file}`);
    }
  }
}
console.log(`\nScanned ${scanned}, patched ${patched}.`);
