import { describe, it, expect } from "vitest";
// .mjs ESM import — pure JS module; vitest resolves it via Vite's allowJs.
import {
  rewritePaths,
  KEYS,
} from "../../../../scripts/sync-v2-overlays.mjs";

/**
 * Plan 51 — sync-v2-overlays.mjs unit tests.
 *
 * The script lives at apps/web/scripts/sync-v2-overlays.mjs and exports
 * `rewritePaths` + `KEYS`. We co-locate this test under
 * `src/components/broadcast/v2/` so vitest's `include` glob picks it up
 * (the script itself is outside `src/` for npm-script discoverability).
 */

describe("sync-v2-overlays", () => {
  describe("rewritePaths", () => {
    it("rewrites font urls", () => {
      const out = rewritePaths(
        "src: url('../../../fonts/agharti/Agharti-Bold.woff2') format('woff2');",
      );
      expect(out).toContain("/overlays/v2/_assets/fonts/agharti/");
      expect(out).not.toContain("../../../fonts");
    });

    it("rewrites logo references", () => {
      const out = rewritePaths(
        "<img src=\"../../../logos/pro%20league%20.png\" />",
      );
      expect(out).toContain('src="/overlays/v2/_assets/logos/pro%20league%20.png"');
    });

    it("rewrites Orgs references (case-sensitive bucket name)", () => {
      const out = rewritePaths(
        "<img src='../../../Orgs/AFROPANDA%20-%20ANIFE.jpeg' />",
      );
      expect(out).toContain("/overlays/v2/_assets/Orgs/AFROPANDA");
    });

    it("rewrites designsample references", () => {
      const out = rewritePaths(
        "background-image: url('../../../designsample/ELITE%20S2%20BG.png');",
      );
      expect(out).toContain("/overlays/v2/_assets/designsample/ELITE");
    });

    it("rewrites players references", () => {
      const out = rewritePaths(
        "src='../../../players/processed/faruk/headshot_01_nobg.png'",
      );
      expect(out).toContain(
        "/overlays/v2/_assets/players/processed/faruk/headshot_01_nobg.png",
      );
    });

    it("does NOT rewrite unrelated relative paths", () => {
      const out = rewritePaths(
        "@import url('../../../mystery/foo.css');",
      );
      expect(out).toBe("@import url('../../../mystery/foo.css');");
    });

    it("rewrites all five buckets in a single pass", () => {
      const before = [
        "../../../fonts/A.woff2",
        "../../../logos/B.png",
        "../../../Orgs/C.jpeg",
        "../../../designsample/D.png",
        "../../../players/processed/e/headshot_01_nobg.png",
      ].join("\n");
      const after = rewritePaths(before);
      expect(after).not.toContain("../../../fonts");
      expect(after).not.toContain("../../../logos");
      expect(after).not.toContain("../../../Orgs");
      expect(after).not.toContain("../../../designsample");
      expect(after).not.toContain("../../../players");
      expect(after.match(/\/overlays\/v2\/_assets\//g)?.length).toBe(5);
    });

    it("returns input unchanged when no matches present", () => {
      const input = "<html><body>no relative paths here</body></html>";
      expect(rewritePaths(input)).toBe(input);
    });

    it("handles multiple occurrences of the same bucket", () => {
      const out = rewritePaths(
        [
          "url('../../../fonts/a.woff2')",
          "url('../../../fonts/b.woff2')",
          "url('../../../fonts/c.woff2')",
        ].join("\n"),
      );
      expect(out.match(/\/overlays\/v2\/_assets\/fonts\//g)?.length).toBe(3);
    });
  });

  describe("KEYS", () => {
    it("exports the 16 routable v2 overlay keys", () => {
      expect(KEYS).toHaveLength(16);
      expect(KEYS).toContain("01-brb");
      expect(KEYS).toContain("17-penalties");
    });

    it("excludes meta-only animated-bg + 18-partners-strip", () => {
      expect(KEYS).not.toContain("03-animated-bg");
      expect(KEYS).not.toContain("03-animated-bg-v3");
      expect(KEYS).not.toContain("18-partners-strip");
    });

    it("KEYS array is frozen (cannot be mutated by callers)", () => {
      expect(Object.isFrozen(KEYS)).toBe(true);
    });
  });
});
