import { accessSync, constants } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_TOKENS, PARTNER_LOGOS, PRIMARY_LOGOS } from "./brand";

/**
 * `apps/web/public` — logo public-URL paths resolve here on disk.
 * `__dirname` at runtime resolves to `apps/web/src/lib`, so ../../public
 * lands at `apps/web/public`.
 */
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");

function assertExistsOnDisk(publicPath: string): void {
  // publicPath is e.g. "/brand/logos/primary/cade.png"; strip the leading slash
  // so path.join doesn't treat it as absolute on POSIX.
  const relative = publicPath.replace(/^\/+/, "");
  const onDisk = path.join(PUBLIC_DIR, relative);
  accessSync(onDisk, constants.R_OK);
}

describe("brand asset registry", () => {
  it("every PRIMARY_LOGOS entry resolves to a readable file", () => {
    const entries = Object.entries(PRIMARY_LOGOS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, publicPath] of entries) {
      expect(publicPath, `${key} must start with /brand/logos/`).toMatch(
        /^\/brand\/logos\//,
      );
      expect(() => assertExistsOnDisk(publicPath), `${key} → ${publicPath}`).not.toThrow();
    }
  });

  it("every PARTNER_LOGOS entry resolves to a readable file", () => {
    const entries = Object.entries(PARTNER_LOGOS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, publicPath] of entries) {
      expect(publicPath, `${key} must start with /brand/logos/`).toMatch(
        /^\/brand\/logos\//,
      );
      expect(() => assertExistsOnDisk(publicPath), `${key} → ${publicPath}`).not.toThrow();
    }
  });

  it("BRAND_TOKENS values are valid 6-digit hex colors", () => {
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    const entries = Object.entries(BRAND_TOKENS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(value, `${key} must be a 6-digit hex color (got ${value})`).toMatch(hexRe);
    }
  });
});
