/**
 * Overlay Builder — style JSON validator.
 *
 * Two-pass guard for every save:
 *   1. Per-element_type Zod parse via `schemaForElementType`.
 *   2. Forbidden-pattern sweep over every string value in the style
 *      tree. Rejects CSS-injection vectors that the Zod parse cannot
 *      see (it does not introspect string CONTENTS):
 *        - expression(...)
 *        - url(...) unless prefixed with `data:image/` or
 *          `/overlay-user-assets/`
 *        - @import
 *        - behavior:   (IE-era XSS)
 *        - javascript: (case-insensitive)
 *        - the FORBIDDEN_CSS_CHARS metacharacter set from
 *          `_shared/css-validator.ts` (semicolons, braces, angle
 *          brackets, quotes, backticks).
 *
 * Returns `{ ok: true, value }` with the Zod-parsed style on success,
 * `{ ok: false, errors }` with one human-readable message per failure
 * on rejection. Errors are aggregated — every problem is reported in
 * a single response so admin UI can surface the full list.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §6 + §12
 */

import { FORBIDDEN_CSS_CHARS } from "../_shared/css-validator";
import { schemaForElementType } from "./style-schema";
import type { ElementType, Style } from "./types";

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /expression\s*\(/i, label: "expression(" },
  { re: /@import\b/i, label: "@import" },
  { re: /behavior\s*:/i, label: "behavior:" },
  { re: /javascript\s*:/i, label: "javascript:" },
];

// Only `data:image/...` and our own asset prefix are allowed inside a
// `url(...)` reference. Anything else (external host, blob:, file:,
// chrome-extension:, etc.) is rejected.
const ALLOWED_URL_PREFIXES = /url\s*\(\s*["']?(data:image\/|\/overlay-user-assets\/)/i;
const ANY_URL_RE = /url\s*\(/i;

function scanStringForForbidden(
  value: string,
  fieldPath: string,
  errors: string[],
): void {
  for (const { re, label } of FORBIDDEN_PATTERNS) {
    if (re.test(value)) {
      errors.push(`${fieldPath}: forbidden pattern "${label}"`);
    }
  }
  if (ANY_URL_RE.test(value) && !ALLOWED_URL_PREFIXES.test(value)) {
    errors.push(
      `${fieldPath}: url(...) only allowed with data:image/ or /overlay-user-assets/ prefix`,
    );
  }
  if (FORBIDDEN_CSS_CHARS.test(value)) {
    errors.push(`${fieldPath}: contains forbidden CSS metacharacter`);
  }
}

function walkAndScan(node: unknown, prefix: string, errors: string[]): void {
  if (typeof node === "string") {
    scanStringForForbidden(node, prefix, errors);
    return;
  }
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => walkAndScan(child, `${prefix}[${i}]`, errors));
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    walkAndScan(v, prefix ? `${prefix}.${k}` : k, errors);
  }
}

export type StyleValidationResult =
  | { ok: true; value: Style }
  | { ok: false; errors: string[] };

export function validateStyle(
  elementType: ElementType,
  style: unknown,
): StyleValidationResult {
  const errors: string[] = [];

  // Pass 1: Zod parse via per-element_type schema.
  const schema = schemaForElementType(elementType);
  const parsed = schema.safeParse(style);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "style";
      errors.push(`${path}: ${issue.message}`);
    }
    // Continue to pattern sweep on the raw input so admins see every
    // problem in one response, not just the first schema error.
  }

  // Pass 2: forbidden-pattern sweep over every string value.
  walkAndScan(style, "style", errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: parsed.success ? (parsed.data as Style) : ({} as Style) };
}
