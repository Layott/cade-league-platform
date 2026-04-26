import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
];

const META = '<meta name="color-scheme" content="dark" />';

let patched = 0;
let skipped = 0;

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
    if (html.includes('name="color-scheme"')) {
      skipped++;
      continue;
    }
    const next = html.replace(
      /<meta charset="UTF-8" \/>/i,
      `<meta charset="UTF-8" />\n  ${META}`,
    );
    if (next === html) {
      console.warn(`  no charset meta found in ${file}`);
      continue;
    }
    writeFileSync(file, next, "utf8");
    patched++;
    console.log(`  patched ${file}`);
  }
}

console.log(`\nPatched ${patched} files, skipped ${skipped} (already had it).`);
