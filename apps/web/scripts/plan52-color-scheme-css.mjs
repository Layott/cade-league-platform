import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
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
    if (html.includes("color-scheme: dark")) continue;
    const next = html.replace(
      /(html, body \{[^}]*?background: transparent !important;)/,
      `$1\n    color-scheme: dark;`,
    );
    if (next === html) {
      console.warn(`  no html,body block found in ${file}`);
      continue;
    }
    writeFileSync(file, next, "utf8");
    patched++;
    console.log(`  patched ${file}`);
  }
}

console.log(`\nPatched ${patched} files.`);
