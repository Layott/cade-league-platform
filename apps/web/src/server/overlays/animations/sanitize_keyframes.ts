/**
 * Overlay Design Page v2 — `@keyframes` body sanitizer.
 *
 * Admins can paste custom CSS into the Animations tab when the
 * animation type is `custom-css`. The pasted text becomes the BODY of
 * a `@keyframes <auto-name> { ... }` rule. Without sanitization an
 * admin could paste:
 *   - `0% { background: url(http://attacker.com/exfil.gif) }` →
 *     overlay loads a remote resource for every render
 *   - `0% { ... } } body { display:none } @keyframes y {` → escapes
 *     the keyframes block and rewrites the entire stylesheet
 *   - `0% { transition: all 1s ease } 100% {}` → properties that
 *     don't belong inside @keyframes
 *   - `@import url(...)` / `@font-face { src: url(...) }` → arbitrary
 *     network exfiltration
 *
 * Sanitizer rules (REJECT on first violation, do NOT silently strip):
 *   1. Reject any `url(...)` reference — no remote loads from custom CSS.
 *   2. Reject any `expression(...)` — legacy IE attack vector.
 *   3. Reject any `@import` / `@font-face` / `@charset` / `@media` /
 *      `@supports` etc. — only the keyframes BODY is permitted, no
 *      nested at-rules.
 *   4. Reject any property OUTSIDE the
 *      `_shared/css-validator.ts::ALLOWED_KEYFRAMES_PROPS` set.
 *   5. Reject any `<` / `>` / `\` / backtick / smart-quote pairs.
 *
 * Format expected: a sequence of step blocks like
 *   `0% { opacity: 0 } 50% { opacity: 0.5 } 100% { opacity: 1 }`
 * Each step header is `<percent>%` or one of the keywords `from` /
 * `to`. Multiple percents per step (`0%, 100%`) are permitted.
 *
 * Returns `{ ok: true, normalized }` on success — the canonical
 * whitespace-normalized form ready to splice into the bootstrap-emitted
 * `@keyframes` rule. Returns `{ ok: false, error }` with a human-
 * readable error message naming the offending construct.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §10.5
 */

import { ALLOWED_KEYFRAMES_PROPS } from "../_shared/css-validator";

const FORBIDDEN_TOKENS = [
  /\burl\s*\(/i,
  /\bexpression\s*\(/i,
  /@import\b/i,
  /@font-face\b/i,
  /@charset\b/i,
  /@media\b/i,
  /@supports\b/i,
  /@namespace\b/i,
  /@page\b/i,
  /@keyframes\b/i,
  /<\/?[a-z]/i,
  /[<>`]/,
];

const STEP_HEADER_RE =
  /^(?:from|to|-?\d{1,3}(?:\.\d+)?%(?:\s*,\s*(?:from|to|-?\d{1,3}(?:\.\d+)?%))*)$/i;

const PROPERTY_RE = /^[a-zA-Z-]+$/;

export type SanitizeResult =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

/**
 * Quick pre-flight: scan the raw text for any forbidden token. Cheap
 * regex-only check before we do per-step parsing.
 */
function rejectForbiddenTokens(body: string): SanitizeResult | null {
  for (const re of FORBIDDEN_TOKENS) {
    if (re.test(body)) {
      const label = re.source.replace(/[\\\\bigsy]/g, "").slice(0, 24);
      return {
        ok: false,
        error: `forbidden CSS construct: ${label} not allowed in custom keyframes`,
      };
    }
  }
  // Reject any backslash escape — they can be used to disguise property names.
  if (/\\/.test(body)) {
    return {
      ok: false,
      error: "backslash escapes not allowed in custom keyframes",
    };
  }
  return null;
}

/**
 * Walk the body parsing `<header> { <decl-list> }` chunks. Returns an
 * array of canonicalized chunks or an error.
 */
function parseSteps(body: string): SanitizeResult | { steps: string[] } {
  const steps: string[] = [];
  // Naive scanner: walk char-by-char, splitting on top-level `{` / `}`.
  // Custom keyframes have no nested rules (we already rejected
  // @-rules + < > tags) so depth-1 is enough.
  let i = 0;
  const n = body.length;
  while (i < n) {
    // Skip whitespace.
    while (i < n && /\s/.test(body[i])) i++;
    if (i >= n) break;

    // Parse header up to `{`.
    const headerStart = i;
    while (i < n && body[i] !== "{") i++;
    if (i >= n) {
      return { ok: false, error: "missing `{` after step header" };
    }
    const header = body.slice(headerStart, i).trim();
    if (!STEP_HEADER_RE.test(header)) {
      return {
        ok: false,
        error: `invalid step header: "${header}" — must be 0%-100%, from, or to`,
      };
    }
    i++; // consume `{`

    // Parse declarations up to `}`.
    const declStart = i;
    while (i < n && body[i] !== "}") {
      if (body[i] === "{") {
        return {
          ok: false,
          error: "nested `{` not allowed inside step body",
        };
      }
      i++;
    }
    if (i >= n) {
      return { ok: false, error: "missing `}` to close step body" };
    }
    const declStr = body.slice(declStart, i).trim();
    i++; // consume `}`

    const parsedDecls = parseDeclarations(declStr);
    if ("error" in parsedDecls) {
      return { ok: false, error: parsedDecls.error };
    }

    steps.push(`${normalizeHeader(header)} { ${parsedDecls.decls.join("; ")} }`);
  }

  if (steps.length === 0) {
    return { ok: false, error: "no animation steps found in custom keyframes" };
  }
  return { steps };
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .split(",")
    .map((p) => p.trim())
    .join(", ");
}

function parseDeclarations(
  s: string,
): { decls: string[] } | { error: string } {
  if (!s.trim()) return { decls: [] };
  const parts = s
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const decls: string[] = [];
  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon < 0) {
      return {
        error: `declaration "${part}" missing colon — expected prop: value`,
      };
    }
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (!PROPERTY_RE.test(prop)) {
      return {
        error: `invalid property name "${prop}" — letters and dashes only`,
      };
    }
    if (!ALLOWED_KEYFRAMES_PROPS.has(prop)) {
      return {
        error: `property "${prop}" not in keyframes allowlist (allowed: ${[
          ...ALLOWED_KEYFRAMES_PROPS,
        ].join(", ")})`,
      };
    }
    if (!value) {
      return { error: `property "${prop}" missing value` };
    }
    if (/[<>{};`\\]/.test(value)) {
      return {
        error: `property "${prop}" value contains forbidden character`,
      };
    }
    decls.push(`${prop}: ${value}`);
  }
  return { decls };
}

/**
 * Sanitize a custom @keyframes BODY. The body is the contents BETWEEN
 * the outer `{` and `}` — `0% { opacity:0 } 100% { opacity:1 }` style.
 * Wraps `@keyframes name { ... }` is added by the bootstrap, NOT here.
 */
export function sanitizeKeyframes(body: string): SanitizeResult {
  if (typeof body !== "string") {
    return { ok: false, error: "custom keyframes must be a string" };
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: "custom keyframes body is empty" };
  }
  if (trimmed.length > 4096) {
    return {
      ok: false,
      error: `custom keyframes body too long (${trimmed.length} > 4096 chars)`,
    };
  }
  const forbiddenResult = rejectForbiddenTokens(trimmed);
  if (forbiddenResult) return forbiddenResult;

  const parsed = parseSteps(trimmed);
  if ("ok" in parsed && parsed.ok === false) return parsed;
  if ("steps" in parsed) {
    return { ok: true, normalized: parsed.steps.join(" ") };
  }
  // Defensive — should not reach here.
  return { ok: false, error: "unknown parse failure" };
}
