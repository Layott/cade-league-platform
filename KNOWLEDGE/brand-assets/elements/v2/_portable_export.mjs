// _portable_export.mjs
// Base64-inlines all url(...) and <img src="..."> references in the source HTML.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGETS = [
  '01-brb',
  '12-starting-soon',
  '13-stream-ended',
  '18-partners-strip',
  '03-animated-bg-v1',
  '03-animated-bg-v2',
  '03-animated-bg-v3',
];

// Friendly-named copies kept in sync with portable.html so users dragging the
// named file to another PC always pick up the latest inlined assets.
const NAMED_COPY = {
  '01-brb': 'BRB portable.html',
  '12-starting-soon': 'STARTING SOON portable.html',
  '13-stream-ended': 'STREAM ENDED portable.html',
  '18-partners-strip': 'PARTNERS STRIP portable.html',
  '03-animated-bg-v1': 'ANIMATED BG 1 portable.html',
  '03-animated-bg-v2': 'ANIMATED BG 2 portable.html',
  '03-animated-bg-v3': 'ANIMATED BG 3 portable.html',
};

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Heavy PNGs that ship as compressed JPGs in portable builds only.
// Source HTMLs reference the PNGs for cloud (where they load as separate
// HTTP files); inlining the PNG would balloon portable files to 10MB+ and
// break file:// loads on slower PCs. Substituting the same-name .jpg
// variant keeps the visual close while shrinking by ~88%.
const PORTABLE_PNG_TO_JPG = new Set([
  'ELITE S2 BG.png',
]);

function inlineFile(path) {
  let resolved = path;
  let ext = extname(path).toLowerCase();
  if (ext === '.png') {
    const base = path.split(/[\\/]/).pop();
    if (PORTABLE_PNG_TO_JPG.has(base)) {
      const jpgPath = path.slice(0, -4) + '.jpg';
      if (existsSync(jpgPath)) {
        resolved = jpgPath;
        ext = '.jpg';
      }
    }
  }
  if (!existsSync(resolved)) {
    console.warn('MISSING:', resolved);
    return null;
  }
  const buf = readFileSync(resolved);
  const mime = MIME[ext] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function processHtml(srcAbs) {
  let html = readFileSync(srcAbs, 'utf8');
  const baseDir = dirname(srcAbs);

  // Replace url('...') and url("...") in CSS
  html = html.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, quote, ref) => {
    if (ref.startsWith('data:') || ref.startsWith('http')) return m;
    const decoded = decodeURIComponent(ref);
    const abs = resolve(baseDir, decoded);
    const dataUri = inlineFile(abs);
    return dataUri ? `url('${dataUri}')` : m;
  });

  // Replace <img src="..."> attributes
  html = html.replace(/<img\b([^>]*?)\bsrc=(['"])([^'"]+)\2/gi, (m, before, q, ref) => {
    if (ref.startsWith('data:') || ref.startsWith('http')) return m;
    const decoded = decodeURIComponent(ref);
    const abs = resolve(baseDir, decoded);
    const dataUri = inlineFile(abs);
    return dataUri ? `<img${before}src='${dataUri}'` : m;
  });

  // Replace any quoted string literal that points to a relative asset path
  // (e.g. "../../../logos/foo.png" inside <script> JS data arrays).
  // Matches strings ending in a known asset extension that contain a relative path.
  const ASSET_EXT_RE = /\.(png|jpe?g|svg|gif|webp|woff2?|ttf|otf)/i;
  html = html.replace(/(['"])((?:\.\.\/|\.\/)[^'"\s]+?\.(?:png|jpe?g|svg|gif|webp|woff2?|ttf|otf))\1/gi, (m, q, ref) => {
    if (ref.startsWith('data:') || ref.startsWith('http')) return m;
    const decoded = decodeURIComponent(ref);
    const abs = resolve(baseDir, decoded);
    const dataUri = inlineFile(abs);
    return dataUri ? `${q}${dataUri}${q}` : m;
  });

  return html;
}

for (const dir of TARGETS) {
  const src = resolve(__dirname, dir, 'index.html');
  const dst = resolve(__dirname, dir, 'portable.html');
  if (!existsSync(src)) {
    console.warn('SKIP (no source):', src);
    continue;
  }
  const out = processHtml(src);
  writeFileSync(dst, out, 'utf8');
  const namedCopy = NAMED_COPY[dir];
  if (namedCopy) {
    writeFileSync(resolve(__dirname, dir, namedCopy), out, 'utf8');
  }
  // Report size delta
  const inSize = readFileSync(src).byteLength;
  const outSize = Buffer.byteLength(out, 'utf8');
  console.log(`${dir}: ${(inSize/1024).toFixed(1)}KB -> ${(outSize/1024).toFixed(1)}KB (${(outSize/1048576).toFixed(2)}MB)`);
}
