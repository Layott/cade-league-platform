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
    let next = html;

    // 1. Normalize partner heights to 64px (all same).
    next = next.replace(
      /\.marquee-group \.partner--gameevo\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--gameevo  { height: 64px; }",
    );
    next = next.replace(
      /\.marquee-group \.partner--pride\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--pride    { height: 64px; }",
    );
    next = next.replace(
      /\.marquee-group \.partner--africa\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--africa   { height: 64px; }",
    );
    next = next.replace(
      /\.marquee-group \.partner--trace\s*\{\s*height:\s*\d+px;\s*\}/g,
      ".marquee-group .partner--trace    { height: 64px; }",
    );
    // base .partner — also normalize.
    next = next.replace(
      /(\.marquee-group \.partner\s*\{[^}]*?)height:\s*\d+px;/g,
      "$1height: 64px;",
    );

    if (next !== html) {
      writeFileSync(file, next, "utf8");
      patched++;
      console.log(`  partners normalized: ${file}`);
    }
  }
}

console.log(`\n[partners] patched ${patched} files.`);

// 2. BRB body center: translate(-50%, -52%) → translate(-50%, -50%)
for (const root of ROOTS) {
  const file = join(root, "01-brb", "index.html");
  let html;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const next = html.replace(
    /transform:\s*translate\(-50%,\s*-52%\);/g,
    "transform: translate(-50%, -50%);",
  );
  if (next !== html) {
    writeFileSync(file, next, "utf8");
    console.log(`  brb-center fixed: ${file}`);
  }
}

// 3. 13-stream-ended title: shrink THANKS FOR WATCHING from 280px → 180px
for (const root of ROOTS) {
  const file = join(root, "13-stream-ended", "index.html");
  let html;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const next = html.replace(
    /(\.title\s*\{[^}]*?)font-size:\s*280px;/,
    "$1font-size: 180px;",
  );
  if (next !== html) {
    writeFileSync(file, next, "utf8");
    console.log(`  thanks-shrink: ${file}`);
  }
}

console.log("\ndone.");
