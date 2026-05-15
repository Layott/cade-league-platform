// Patches portable HTML files to be ALWAYS-ON (no triggers, no exit anim).
// - Adds cade-visible class to body literal
// - Strips the cade-demo-mode loop entirely so no auto-hide ever fires
// - Injects a hard <style> override so .bg-image / .partners / .body /
//   .top-band / .chevrons / .season-mark / .bg-vignette / .bg-grain are
//   opacity:1 with NO transition the moment the page parses. Belt &
//   braces: even if the MutationObserver gate script is delayed by a
//   slow data-URI decode on an older PC, the visible layers still paint.
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

  // 4. Inject portable force-show stylesheet immediately before </head>.
  //    Guarantees the background + content layers are painted even if the
  //    MutationObserver gate script hasn't run yet on a slow / older PC.
  const FORCE_SHOW_BLOCK = `<style id="cade-portable-force-show">
/* portable always-on hard override */
.bg-image,
.bg-vignette,
.bg-grain,
.body,
.partners,
.partners-strip,
.top-band,
.chevrons,
.season-mark,
.matchup,
.timer,
.timer-badge,
[data-element-id] {
  opacity: 1 !important;
  visibility: visible !important;
  transition: none !important;
  animation-delay: 0s !important;
}
body.cade-exiting * {
  opacity: 1 !important;
}
</style>`;
  if (!next.includes('id="cade-portable-force-show"')) {
    if (next.includes("</head>")) {
      next = next.replace("</head>", FORCE_SHOW_BLOCK + "\n</head>");
    } else {
      next = next.replace("<body", FORCE_SHOW_BLOCK + "\n<body");
    }
  }

  if (next !== html) {
    writeFileSync(path, next, "utf8");
    patched++;
    console.log(`  patched: ${path}`);
  }
}
console.log(`\nPatched ${patched} files.`);
