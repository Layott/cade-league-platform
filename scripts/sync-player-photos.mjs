#!/usr/bin/env node
/**
 * Plan 22 — copy transparent-bg headshots from KNOWLEDGE/brand-assets
 * into apps/web/public/players so Next.js serves them at
 * /players/<slug>/headshot_<NN>.png.
 *
 * Idempotent: skips files whose mtime + size already match the source.
 * Usage: `node scripts/sync-player-photos.mjs`.
 *
 * Reads the manifest committed under
 * KNOWLEDGE/brand-assets/players/processed/manifest.json and copies every
 * `headshot_<NN>_nobg.png` into the public/ destination.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "KNOWLEDGE",
  "brand-assets",
  "players",
  "processed",
  "manifest.json",
);
const SOURCE_ROOT = path.join(
  REPO_ROOT,
  "KNOWLEDGE",
  "brand-assets",
  "players",
  "processed",
);
const DEST_ROOT = path.join(REPO_ROOT, "apps", "web", "public", "players");

function copyIfChanged(src, dest) {
  if (!fs.existsSync(src)) return "missing";
  if (fs.existsSync(dest)) {
    const a = fs.statSync(src);
    const b = fs.statSync(dest);
    if (a.size === b.size && a.mtimeMs <= b.mtimeMs) return "skipped";
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return "copied";
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`manifest not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  let copied = 0;
  let skipped = 0;
  let missing = 0;

  for (const [slug, player] of Object.entries(manifest.players)) {
    for (const pose of player.poses) {
      const rel = pose.variants.headshot_nobg;
      if (!rel) {
        missing += 1;
        continue;
      }
      const src = path.join(SOURCE_ROOT, rel.replaceAll("\\", path.sep));
      const idx = String(pose.pose_index).padStart(2, "0");
      const dest = path.join(DEST_ROOT, slug, `headshot_${idx}.png`);
      const action = copyIfChanged(src, dest);
      if (action === "copied") copied += 1;
      else if (action === "skipped") skipped += 1;
      else missing += 1;
    }
  }

  console.log(
    `sync-player-photos done: ${copied} copied, ${skipped} skipped, ${missing} missing-source`,
  );
}

main();
