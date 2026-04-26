// Inject `transition: opacity 360ms ease-out` setup BEFORE every opacity setProperty call inside the gate observer.
// Surgical edit that works regardless of observer's SEL/INNER_SEL shape.
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
    if (!html.includes('cade-visible-gate-observer-v2')) continue;
    if (html.includes('cadeTransition')) continue; // already patched

    // Inject transition setup at the start of the forEach callback in apply().
    // Pattern: find `forEach(function(el){\n        if (vis) {`
    let next = html.replace(
      /(\.forEach\(function\(el\)\s*\{\s*\n)(\s+)if \(vis\) \{/g,
      (m, intro, indent) => `${intro}${indent}if (!el.dataset.cadeTransition) { el.style.transition = (el.style.transition ? el.style.transition + ', ' : '') + 'opacity 360ms ease-out'; el.dataset.cadeTransition = '1'; }\n${indent}if (vis) {`,
    );

    if (next === html) continue;
    writeFileSync(file, next, "utf8");
    patched++;
    console.log(`  smoothed: ${file}`);
  }
}
console.log(`\nPatched ${patched} files.`);
