import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
];

// Replace gate observer's apply() with smooth-transition version.
// Old: instantly snaps opacity 0/1 with !important.
// New: sets transition: opacity 360ms ease-out as inline style first, then flips opacity.
//      Browser animates because transition is in place when value changes.
const OLD_PATTERN = /function apply\(\) \{\s*var b = document\.body;\s*if \(!b\) return;\s*var vis = b\.classList\.contains\('cade-visible'\);\s*var exit = b\.classList\.contains\('cade-exiting'\);\s*document\.querySelectorAll\(SEL\)\.forEach\(function\(el\)\{\s*if \(vis\) \{[^}]*?\}\s*else if \(exit\) \{[^}]*?\}\s*else \{[^}]*?\}\s*\}\);\s*\}/;

const NEW_BODY = `function apply() {
    var b = document.body;
    if (!b) return;
    var vis = b.classList.contains('cade-visible');
    document.querySelectorAll(SEL).forEach(function(el){
      // Set transition once so opacity flips animate smoothly.
      if (!el.dataset.cadeTransition) {
        el.style.transition = (el.style.transition ? el.style.transition + ', ' : '') + 'opacity 360ms ease-out';
        el.dataset.cadeTransition = '1';
      }
      if (vis) {
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
      } else {
        el.style.setProperty('opacity', '0', 'important');
      }
    });
  }`;

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
    if (!OLD_PATTERN.test(html)) continue;
    if (html.includes("dataset.cadeTransition")) continue;
    const next = html.replace(OLD_PATTERN, NEW_BODY);
    if (next === html) continue;
    writeFileSync(file, next, "utf8");
    patched++;
    console.log(`  smoothed: ${file}`);
  }
}
console.log(`\nPatched ${patched} files.`);
