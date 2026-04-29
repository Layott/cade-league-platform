import { describe, it, expect } from "vitest";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wave 2 Stage 2 — parity linter behaviour tests.
 *
 * Verifies the seed-catalog loader extracts the right tuples + the HTML
 * regex catches `data-element-id` attrs in real HTML files. The linter
 * lives in `apps/web/scripts/_check-element-id-parity.mjs` and is wired
 * into `npm run prebuild` so a deploy is blocked when extra HTML attrs
 * exist without matching seed rows. These tests check the helper
 * primitives so we know the linter's regex / loader behaves correctly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = apps/web/src/server/overlays/text
const APP_WEB_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "web");
const PARITY_SCRIPT = resolve(
  APP_WEB_ROOT,
  "scripts",
  "_check-element-id-parity.mjs",
);

async function importLinter() {
  // Vite's dynamic import handles .mjs natively; vitest jsdom env should too.
  const mod = await import(/* @vite-ignore */ PARITY_SCRIPT);
  return mod;
}

describe("element-id parity linter", () => {
  it("loadSeedCatalog returns one entry per overlay key", async () => {
    const { loadSeedCatalog } = await importLinter();
    const catalog = await loadSeedCatalog();
    expect(catalog.size).toBeGreaterThan(0);
    // The 16 routable overlays should all have at least one seed row.
    const expectedKeys = ["01-brb", "07-leaderboard", "12-starting-soon"];
    for (const k of expectedKeys) {
      expect(catalog.has(k), `missing ${k} in catalog`).toBe(true);
      expect(catalog.get(k).size).toBeGreaterThan(0);
    }
  });

  it("loadSeedCatalog includes title/eyebrow on text-bearing overlays", async () => {
    const { loadSeedCatalog } = await importLinter();
    const catalog = await loadSeedCatalog();
    const ids = catalog.get("01-brb");
    expect(ids).toBeDefined();
    expect(ids.has("title")).toBe(true);
    expect(ids.has("kicker")).toBe(true);
    expect(ids.has("subtitle")).toBe(true);
  });

  it("readHtmlElementIds returns empty Set for missing files", async () => {
    const { readHtmlElementIds } = await importLinter();
    const ids = await readHtmlElementIds(
      join(APP_WEB_ROOT, "public/overlays/v2/this-does-not-exist/index.html"),
    );
    expect(ids.size).toBe(0);
  });

  it("readHtmlElementIds picks up data-element-id attrs in real overlay HTML", async () => {
    const { readHtmlElementIds } = await importLinter();
    const ids = await readHtmlElementIds(
      join(APP_WEB_ROOT, "public/overlays/v2/07-leaderboard/index.html"),
    );
    // Stage 2 seeded these attrs into 07-leaderboard.
    expect(ids.has("title")).toBe(true);
    expect(ids.has("eyebrow")).toBe(true);
  });

  it("all attrs in real overlay HTML are valid kebab-case IDs", async () => {
    const { readHtmlElementIds } = await importLinter();
    const ids = await readHtmlElementIds(
      join(APP_WEB_ROOT, "public/overlays/v2/01-brb/index.html"),
    );
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
