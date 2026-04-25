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

function inlineFile(path) {
  if (!existsSync(path)) {
    console.warn('MISSING:', path);
    return null;
  }
  const buf = readFileSync(path);
  const ext = extname(path).toLowerCase();
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
  // Report size delta
  const inSize = readFileSync(src).byteLength;
  const outSize = Buffer.byteLength(out, 'utf8');
  console.log(`${dir}: ${(inSize/1024).toFixed(1)}KB -> ${(outSize/1024).toFixed(1)}KB (${(outSize/1048576).toFixed(2)}MB)`);
}
