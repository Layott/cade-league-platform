import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2",
];

// Demo block — guarded by ?demo=1 query string. Auto-fires show() on load,
// then loops show/hide every 8s so designer can verify entry + exit.
const DEMO_BLOCK = `<script data-tag="cade-demo-mode">
(function(){
  if (new URLSearchParams(location.search).get('demo') !== '1') return;
  function fire(type){ window.dispatchEvent(new MessageEvent('message', { data: { type: type } })); }
  // Initial show after a tiny tick so the gate observer is wired.
  setTimeout(function(){ fire('show'); }, 200);
  // Loop: show 5s, hide 3s, repeat.
  setInterval(function(){ fire('hide'); }, 8000);
  setTimeout(function(){
    setInterval(function(){ fire('show'); }, 8000);
  }, 8000 - 5000); // offset so show fires 5s after each hide
})();
</script>`;

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
    if (html.includes('data-tag="cade-demo-mode"')) continue;
    // Insert before </body>.
    const next = html.replace(/<\/body>/, `${DEMO_BLOCK}\n</body>`);
    if (next === html) {
      console.warn(`  no </body> in ${file}`);
      continue;
    }
    writeFileSync(file, next, "utf8");
    patched++;
    console.log(`  demo added: ${file}`);
  }
}
console.log(`\nPatched ${patched} files.`);
