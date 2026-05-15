/**
 * One-shot: inject WAGYR into every `*portable*.html` variant under
 * KNOWLEDGE/brand-assets/elements/v2/. The earlier wave only touched
 * the runtime `index.html` files; the portable bundles that designers
 * download for offline review missed the new partner.
 *
 * Handles three injection patterns:
 *
 *   1. Marquee strip — three duplicated rows containing
 *      `<img class="partner partner--oas" src=".../OAS%20esport_strip.png">`.
 *      Append a sibling `partner--wagyr` row + a CSS height rule per
 *      duplicate. Same shape as `_inject-wagyr-into-marquees.mjs`.
 *
 *   2. Flat footer — `<footer class="partners">` with five inline
 *      `<img class="partner partner--<slug>">` children but no OAS
 *      entry. Append `partner--oas` + `partner--wagyr` after the
 *      trace img so the footer renders all six partners.
 *
 *   3. Cover-up / showcase footer — single-line
 *      `<footer class="partners">` with `<img class="partner">` (no
 *      modifier class) and an OAS `org` or `strip` variant. Append a
 *      WAGYR sibling img after OAS.
 *
 *   4. Partners-array script (18-partners-strip portable) — JS-side
 *      `const partners = [...]` array; append a 6th WAGYR entry after
 *      the OAS object.
 *
 * Idempotent — skip when the file already contains `WAGYR`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT =
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2";

// 2026-05-15 — accept both `src="..."` and `src='...'` because the
// downloadable portable variants embed images as base64 inside
// single-quoted attributes, while the runtime index.html keeps the
// path-based double-quoted form. `[^"']+` matches whichever quote
// style the surrounding tag uses.
const MARQUEE_IMG_RE =
  /^(\s*)<img\s+class="partner\s+partner--oas"[^>]*src=["']([^"']+)["'][^>]*alt="([^"]*)"\s*\/?>\s*$/;
const MARQUEE_CSS_RE =
  /^(\s*)\.marquee-group\s+\.partner--oas\s*\{\s*height:\s*(\d+)px;\s*\}\s*$/;
const FLAT_TRACE_RE =
  /^(\s*)<img\s+class="partner\s+partner--trace"[^>]*src=["']([^"']+)["'][^>]*alt="([^"]*)"\s*\/?>\s*$/;
const COVER_UP_OAS_IMG_RE =
  /(<img\s+class="partner"\s+src=["']([^"']*\/OAS_colored_org\.png|[^"']*\/OAS%20esport_strip\.png)["']\s+alt="[^"]*"\s*\/?>)/;
const PARTNERS_ARRAY_OAS_RE =
  /(\{\s*name:\s*"OAS esport",\s*shortName:\s*"OAS",\s*src:\s*"[^"]+"\s*\})/;

function wagyrPathFor(refSrc) {
  if (refSrc.startsWith("/overlays/v2/_assets/logos/")) {
    return "/overlays/v2/_assets/logos/processed/WAGYR_strip.png";
  }
  return "../../../logos/processed/WAGYR_strip.png";
}

function patchMarqueeAndFlat(html) {
  const out = [];
  let touched = false;
  const lines = html.split("\n");
  let sawOas = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);

    const marqueeMatch = line.match(MARQUEE_IMG_RE);
    if (marqueeMatch) {
      sawOas = true;
      const [, indent, src, alt] = marqueeMatch;
      const wagyrSrc = wagyrPathFor(src);
      const altOut = alt === "" ? "" : "WAGYR";
      out.push(
        `${indent}<img class="partner partner--wagyr"   src="${wagyrSrc}" alt="${altOut}" />`,
      );
      touched = true;
      continue;
    }

    const cssMatch = line.match(MARQUEE_CSS_RE);
    if (cssMatch) {
      const [, indent, height] = cssMatch;
      out.push(
        `${indent}.marquee-group .partner--wagyr    { height: ${height}px; }`,
      );
      touched = true;
      continue;
    }
  }

  // If the file uses the flat-footer pattern (partner--trace WITHOUT
  // an OAS sibling marquee), inject OAS + WAGYR after the trace row.
  if (!sawOas) {
    const lines2 = out.slice();
    out.length = 0;
    for (let i = 0; i < lines2.length; i++) {
      const line = lines2[i];
      out.push(line);
      const m = line.match(FLAT_TRACE_RE);
      if (m) {
        const [, indent, src, alt] = m;
        const prefix = src.startsWith("/overlays/v2/_assets/logos/")
          ? "/overlays/v2/_assets/logos/processed/"
          : "../../../logos/processed/";
        const altOas = alt === "" ? "" : "OAS esport";
        const altWagyr = alt === "" ? "" : "WAGYR";
        out.push(
          `${indent}<img class="partner partner--oas"     src="${prefix}OAS_colored_strip.png" alt="${altOas}" />`,
        );
        out.push(
          `${indent}<img class="partner partner--wagyr"   src="${prefix}WAGYR_strip.png" alt="${altWagyr}" />`,
        );
        touched = true;
      }
    }
  }

  return touched ? out.join("\n") : null;
}

function patchCoverUpFooter(html) {
  const m = html.match(COVER_UP_OAS_IMG_RE);
  if (!m) return null;
  const oasTag = m[1];
  const oasSrc = m[2];
  const wagyrSrc = wagyrPathFor(oasSrc);
  const wagyrTag = `<img class="partner" src="${wagyrSrc}" alt="WAGYR">`;
  return html.replace(oasTag, oasTag + wagyrTag);
}

function patchPartnersArray(html) {
  const m = html.match(PARTNERS_ARRAY_OAS_RE);
  if (!m) return null;
  const oasObj = m[1];
  const isPublicMirror = oasObj.includes("/overlays/v2/_assets/logos/");
  const wagyrSrc = isPublicMirror
    ? "/overlays/v2/_assets/logos/processed/WAGYR_strip.png"
    : "../../../logos/processed/WAGYR_strip.png";
  const wagyrObj = `,\n    {\n      name: "WAGYR",\n      shortName: "WAGYR",\n      src: "${wagyrSrc}"\n    }`;
  return html.replace(oasObj, oasObj + wagyrObj);
}

function patchFile(html) {
  if (html.includes("WAGYR")) return null;
  // Try each pattern in turn; first one that produces a real diff wins.
  const a = patchMarqueeAndFlat(html);
  if (a) return a;
  const b = patchCoverUpFooter(html);
  if (b) return b;
  const c = patchPartnersArray(html);
  if (c) return c;
  return null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p, out);
    } else if (entry.isFile() && /portable.*\.html$/i.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

let scanned = 0;
let patched = 0;
for (const file of walk(ROOT)) {
  scanned++;
  let html;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const next = patchFile(html);
  if (next !== null && next !== html) {
    writeFileSync(file, next, "utf8");
    patched++;
    console.log(`  patched: ${file}`);
  }
}
console.log(`\nScanned ${scanned}, patched ${patched}.`);
