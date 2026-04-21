import { accessSync, constants, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { OVERLAY_SOUNDS } from "./overlay-sounds";

/**
 * Resolves to `apps/web/public`. `__dirname` at runtime lives at
 * `apps/web/src/lib`, so ../../public hits the right folder.
 */
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");

function onDisk(publicPath: string): string {
  return path.join(PUBLIC_DIR, publicPath.replace(/^\/+/, ""));
}

function assertExistsOnDisk(publicPath: string): void {
  accessSync(onDisk(publicPath), constants.R_OK);
}

function flattenPaths(): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [category, map] of Object.entries(OVERLAY_SOUNDS)) {
    for (const [key, publicPath] of Object.entries(map as Record<string, string>)) {
      entries.push([`${category}.${key}`, publicPath]);
    }
  }
  return entries;
}

describe("overlay sound registry", () => {
  it("exposes exactly 11 entries across stingers, ui, brand", () => {
    const all = flattenPaths();
    expect(all.length).toBe(11);
    expect(Object.keys(OVERLAY_SOUNDS.stingers)).toHaveLength(5);
    expect(Object.keys(OVERLAY_SOUNDS.ui)).toHaveLength(5);
    expect(Object.keys(OVERLAY_SOUNDS.brand)).toHaveLength(1);
  });

  it("every entry starts with /overlay/sounds/ and points to a .wav", () => {
    for (const [label, publicPath] of flattenPaths()) {
      expect(publicPath, `${label} prefix`).toMatch(/^\/overlay\/sounds\//);
      expect(publicPath, `${label} ext`).toMatch(/\.wav$/);
    }
  });

  it("every entry resolves to a non-empty file on disk", () => {
    for (const [label, publicPath] of flattenPaths()) {
      expect(
        () => assertExistsOnDisk(publicPath),
        `${label} → ${publicPath}`,
      ).not.toThrow();
      const size = statSync(onDisk(publicPath)).size;
      expect(size, `${label} should be > 1 KB`).toBeGreaterThan(1024);
    }
  });

  it("every WAV has a valid RIFF/WAVE header with expected format", () => {
    for (const [label, publicPath] of flattenPaths()) {
      const buf = readFileSync(onDisk(publicPath));
      expect(buf.slice(0, 4).toString("ascii"), `${label} RIFF`).toBe("RIFF");
      expect(buf.slice(8, 12).toString("ascii"), `${label} WAVE`).toBe("WAVE");
      // fmt chunk: audioFormat(PCM=1) at offset 20, channels at 22, sampleRate at 24, bitsPerSample at 34
      expect(buf.readUInt16LE(20), `${label} PCM`).toBe(1);
      expect(buf.readUInt16LE(22), `${label} stereo`).toBe(2);
      expect(buf.readUInt32LE(24), `${label} 44.1kHz`).toBe(44100);
      expect(buf.readUInt16LE(34), `${label} 16-bit`).toBe(16);
    }
  });

  it("manifest.json matches the registry file set 1:1", () => {
    const manifestPath = path.join(
      PUBLIC_DIR,
      "overlay",
      "sounds",
      "manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const manifestPaths = new Set<string>(
      Object.values(manifest.files).map(
        (f) => (f as { path: string }).path,
      ),
    );
    const registryPaths = new Set(flattenPaths().map(([, p]) => p));
    expect(manifestPaths).toEqual(registryPaths);
    expect(manifest.sample_rate).toBe(44100);
    expect(manifest.channels).toBe(2);
    expect(manifest.bit_depth).toBe(16);
    expect(manifest.format).toBe("wav");
  });
});
