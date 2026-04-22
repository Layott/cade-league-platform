import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Plan 37 — guard: every Plan 37 rewritten overlay page must source colors
 * from `var(--…)` only. Inline hex (`#abc`, `#aabbcc`, `#aabbccdd`) is
 * disallowed — designers extend tokens in `globals.css` instead.
 */

const REWRITTEN = [
  "lower-third",
  "score-bug",
  "up-next-bug",
  "layout-timer",
];

// We're at apps/web/src/server/overlays/token-lint.test.ts. Walk up to
// apps/web, then into src/app/(overlay)/overlay/<route>/page.tsx.
const ROOT = resolve(__dirname, "..", "..", "..");
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

describe("Plan 37 overlay rewrites — token discipline", () => {
  for (const route of REWRITTEN) {
    it(`/overlay/${route}/page.tsx contains zero inline hex literals`, () => {
      const file = join(ROOT, "app", "(overlay)", "overlay", route, "page.tsx");
      if (!existsSync(file)) {
        // Soft-skip until rewrite lands; the existence assertion lives in
        // the E2E spec.
        return;
      }
      const src = readFileSync(file, "utf8");
      const matches = src.match(HEX_RE) ?? [];
      // Filter out `#` symbols inside JSX text (jersey numbers `#10`,
      // etc) by requiring a hex digit immediately after `#`. The regex
      // already enforces 3+ hex digits so jersey numbers slip through.
      // Tighten to 6/8-digit strings that look like color literals.
      const colorish = matches.filter(
        (m) => m.length === 4 || m.length === 7 || m.length === 9,
      );
      expect(colorish, `inline hex in ${route}: ${colorish.join(", ")}`).toEqual([]);
    });
  }
});
