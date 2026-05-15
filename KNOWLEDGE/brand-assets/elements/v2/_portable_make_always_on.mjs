// Patches portable HTML files to be ALWAYS-ON (no triggers, no exit anim).
// - Adds cade-visible class to body literal
// - Strips the cade-demo-mode loop entirely so no auto-hide ever fires
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGETS = [
  ["01-brb", "portable.html"],
  ["01-brb", "BRB portable.html"],
  ["12-starting-soon", "portable.html"],
  ["12-starting-soon", "STARTING SOON portable.html"],
  ["13-stream-ended", "portable.html"],
  ["13-stream-ended", "STREAM ENDED portable.html"],
  ["18-partners-strip", "portable.html"],
  ["18-partners-strip", "PARTNERS STRIP portable.html"],
  ["03-animated-bg-v1", "portable.html"],
  ["03-animated-bg-v1", "ANIMATED BG 1 portable.html"],
  ["03-animated-bg-v2", "portable.html"],
  ["03-animated-bg-v2", "ANIMATED BG 2 portable.html"],
  ["03-animated-bg-v3", "portable.html"],
  ["03-animated-bg-v3", "ANIMATED BG 3 portable.html"],
];

let patched = 0;
for (const [dir, name] of TARGETS) {
  const path = resolve(__dirname, dir, name);
  let html;
  try {
    html = readFileSync(path, "utf8");
  } catch {
    console.warn("MISSING:", path);
    continue;
  }
  let next = html;

  // 1. Body always cade-visible.
  next = next.replace(/<body(\s+class="[^"]*")?>/, (m, attr) => {
    if (attr && attr.includes("cade-visible")) return m;
    if (attr) return m.replace(/class="([^"]*)"/, 'class="$1 cade-visible"');
    return '<body class="cade-visible">';
  });

  // 2. Strip the cade-demo-mode <script> entirely (so no auto-hide loop).
  next = next.replace(
    /<script\s+data-tag="cade-demo-mode"[\s\S]*?<\/script>/g,
    "<!-- cade-demo-mode stripped (portable always-on) -->",
  );

  // 3. Also strip the cadeGate hide handler so any stray postMessage hide is ignored.
  //    Replace any `if (msg.type === 'hide')` branch's call with a no-op comment.
  //    Conservative — only neutralize if pattern matches.
  next = next.replace(
    /(else if \(msg\.type === ['"]hide['"]\)\s*\{)[^}]*\}/g,
    "$1 /* portable: hide ignored */ }",
  );

  if (next !== html) {
    writeFileSync(path, next, "utf8");
    patched++;
    console.log(`  patched: ${path}`);
  }
}
console.log(`\nPatched ${patched} files.`);
