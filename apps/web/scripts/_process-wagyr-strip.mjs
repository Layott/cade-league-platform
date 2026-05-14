/**
 * One-shot processor for the WAGYR partner logo.
 *
 * Source `KNOWLEDGE/brand-assets/logos/WAGYR.png` is the WAGYR brand
 * tile — solid brand-green square + dark-green "N" mark. The brand
 * identity is the SQUARE, not the N alone (the N is unreadable on the
 * broadcast's dark background once decoupled from the green block).
 *
 * Recipe — match the canonical `partner-strip` contract from
 * apps/web/src/lib/image-processing.ts:
 *   - Trim residual transparent margins (defensive — source already
 *     square-cropped).
 *   - Contain-fit the brand tile into a 600×300 transparent canvas so
 *     the strip cell carries the full brand block on alpha bg, exactly
 *     like the other partner cells (no edge halo, no green bleed).
 *   - Compression-9 PNG for fast Storage I/O.
 *
 * Writes to BOTH:
 *   - apps/web/public/overlays/v2/_assets/logos/processed/WAGYR_strip.png
 *   - KNOWLEDGE/brand-assets/logos/processed/WAGYR_strip.png   (mirror)
 */
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SRC = "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/logos/WAGYR.png";
const OUTS = [
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2/_assets/logos/processed/WAGYR_strip.png",
  "C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/logos/processed/WAGYR_strip.png",
];

async function main() {
  const buf = await sharp(SRC)
    .ensureAlpha()
    .trim()
    .resize(600, 300, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  for (const out of OUTS) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    console.log(`wrote ${out} (${buf.length} bytes)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
