import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
];

// Logo path replacements (any quotes, any URL-encoded form).
// Source path under KNOWLEDGE: ../../../logos/<name>.png
// Source path under public mirror: /overlays/v2/_assets/logos/<name>.png
const REPLACEMENTS = [
  // KNOWLEDGE source paths
  ["../../../logos/GameEvo%20Esports%20White.png", "../../../logos/processed/GameEvo%20Esports%20White_strip.png"],
  ["../../../logos/Gamepride%20Green-01.png", "../../../logos/processed/Gamepride%20Green-01_strip.png"],
  ["../../../logos/ESPORTS%20AFRICA%20NEWS%20WHITE.png", "../../../logos/processed/ESPORTS%20AFRICA%20NEWS%20WHITE_strip.png"],
  ["../../../logos/TRACE_2010_logo.svg.png", "../../../logos/processed/TRACE_2010_logo.svg_strip.png"],
  // public mirror paths (after sync rewrite)
  ["/overlays/v2/_assets/logos/GameEvo%20Esports%20White.png", "/overlays/v2/_assets/logos/processed/GameEvo%20Esports%20White_strip.png"],
  ["/overlays/v2/_assets/logos/Gamepride%20Green-01.png", "/overlays/v2/_assets/logos/processed/Gamepride%20Green-01_strip.png"],
  ["/overlays/v2/_assets/logos/ESPORTS%20AFRICA%20NEWS%20WHITE.png", "/overlays/v2/_assets/logos/processed/ESPORTS%20AFRICA%20NEWS%20WHITE_strip.png"],
  ["/overlays/v2/_assets/logos/TRACE_2010_logo.svg.png", "/overlays/v2/_assets/logos/processed/TRACE_2010_logo.svg_strip.png"],
];

let patched = 0;
for (const root of ROOTS) {
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (dir.name.startsWith("_")) continue;
    const file = join(root, dir.name, "index.html");
    let html;
    try {
      html = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let next = html;
    for (const [from, to] of REPLACEMENTS) {
      next = next.split(from).join(to);
    }
    // Bump partner heights to 80px since strip canvas (600x300, all visually equalized) lets us go larger.
    next = next.replace(/\.marquee-group \.partner--gameevo\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--gameevo  { height: 80px; }");
    next = next.replace(/\.marquee-group \.partner--pride\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--pride    { height: 80px; }");
    next = next.replace(/\.marquee-group \.partner--africa\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--africa   { height: 80px; }");
    next = next.replace(/\.marquee-group \.partner--trace\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--trace    { height: 80px; }");
    next = next.replace(/(\.marquee-group \.partner\s*\{[^}]*?)height:\s*\d+px;/g,
      "$1height: 80px;");

    if (next !== html) {
      writeFileSync(file, next, "utf8");
      patched++;
      console.log(`  updated: ${file}`);
    }
  }
}
console.log(`\nPatched ${patched} files.`);
