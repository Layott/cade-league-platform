/**
 * Overlay Builder — binding JSON validator.
 *
 * Bindings carry a feed + fieldPath + optional templateString. The
 * feed enum is parsed via Zod. The fieldPath is a tight regex
 * allowlist (`[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*|\[\d+\])*`). The
 * templateString is parsed via a hand-rolled tokenizer that only
 * recognises literal text + `${path}` interpolations — anything else
 * inside `${...}` is rejected.
 *
 * Goal: provable allowlist, not "looks safe". A regex that approximates
 * "JS-like" gets smuggled past via Unicode escapes, exotic operators,
 * or method-chain tricks. A tokenizer that knows ONLY the two valid
 * shapes cannot.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §7.3 + §12
 */

import { z } from "zod";
import { FORBIDDEN_CSS_CHARS } from "../_shared/css-validator";
import { BindingSchema, FeedNameSchema } from "./types";
import type { Binding, FeedName } from "./types";

// Paths may start with an identifier segment OR an array index (e.g. `[0].name`).
// Subsequent segments may be `.identifier` or `[n]` array accesses.
const FIELD_PATH_RE =
  /^(\[\d+\]|[a-z_][a-z0-9_]*)(\.[a-z_][a-z0-9_]*|\[\d+\])*$/i;

type ParseTemplateResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Tokenizer: walks the templateString char by char. State machine:
 *   - STATE_LITERAL: accept anything except `$` (which transitions to
 *     STATE_DOLLAR). Backslash escapes are REJECTED (no string
 *     smuggling via \uXXXX or \n / \t — we want the literal char to
 *     be exactly what the admin sees in the editor).
 *   - STATE_DOLLAR: saw a `$`. If next is `{`, enter STATE_INTERP. Else
 *     drop back to STATE_LITERAL (the `$` is a literal dollar sign).
 *   - STATE_INTERP: accumulating the path inside braces. Closing `}`
 *     transitions back to STATE_LITERAL. Any chars OTHER than those
 *     valid in a field path (letters, digits, dots, brackets, digits)
 *     reject the whole string.
 *
 * The accumulated path inside each `${...}` MUST match FIELD_PATH_RE
 * after the closing brace.
 */
function parseTemplateString(s: string): ParseTemplateResult {
  let i = 0;
  const n = s.length;
  let state: "literal" | "dollar" | "interp" = "literal";
  let interpBuf = "";

  while (i < n) {
    const ch = s[i];
    if (state === "literal") {
      if (ch === "\\") {
        return {
          ok: false,
          error: "backslash escapes not allowed in templateString",
        };
      }
      if (ch === "$") {
        state = "dollar";
        i++;
        continue;
      }
      if (ch === "}") {
        return {
          ok: false,
          error: "unexpected `}` outside interpolation in templateString",
        };
      }
      // Reject CSS/HTML metacharacters in literal text (e.g. `;`, `{`, `<`).
      if (FORBIDDEN_CSS_CHARS.test(ch)) {
        return {
          ok: false,
          error: `templateString: forbidden character "${ch}" in literal text`,
        };
      }
      i++;
      continue;
    }
    if (state === "dollar") {
      if (ch === "{") {
        state = "interp";
        interpBuf = "";
        i++;
        continue;
      }
      // `$` followed by anything else — treat as literal dollar sign.
      state = "literal";
      continue;
    }
    // state === "interp"
    if (ch === "}") {
      if (!FIELD_PATH_RE.test(interpBuf)) {
        return {
          ok: false,
          error: `templateString: invalid interpolation "\${${interpBuf}}" — only feed-style paths allowed`,
        };
      }
      state = "literal";
      interpBuf = "";
      i++;
      continue;
    }
    if (ch === "{" || ch === "$" || ch === "\\") {
      return {
        ok: false,
        error: `templateString: forbidden character "${ch}" inside interpolation`,
      };
    }
    // Whitelist of chars allowed inside path: letters, digits,
    // underscore, dot, square brackets.
    if (!/[A-Za-z0-9_.\[\]]/.test(ch)) {
      return {
        ok: false,
        error: `templateString: forbidden character "${ch}" inside interpolation`,
      };
    }
    interpBuf += ch;
    i++;
  }

  if (state === "interp") {
    return {
      ok: false,
      error: "templateString: unbalanced `${` — missing closing `}`",
    };
  }
  return { ok: true };
}

export type BindingValidationResult =
  | { ok: true; value: Binding }
  | { ok: false; errors: string[] };

export function validateBinding(
  binding: unknown,
  availableFeeds: FeedName[],
): BindingValidationResult {
  const errors: string[] = [];

  const parsed = BindingSchema.safeParse(binding);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "binding";
      errors.push(`${path}: ${issue.message}`);
    }
    return { ok: false, errors };
  }
  const b = parsed.data;

  if (!availableFeeds.includes(b.feed)) {
    errors.push(
      `feed: "${b.feed}" not in availableFeeds [${availableFeeds.join(", ")}]`,
    );
  }

  if (!FIELD_PATH_RE.test(b.fieldPath)) {
    errors.push(
      `fieldPath: "${b.fieldPath}" — only alphanumeric segments + dots + numeric brackets allowed`,
    );
  }

  if (b.templateString !== undefined) {
    const tpl = parseTemplateString(b.templateString);
    if (!tpl.ok) {
      errors.push(tpl.error);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: b };
}

// Re-export for callers that want to validate FeedName independently.
export { FeedNameSchema };
export { z };
