import { z } from "zod";
import { TOKEN_CATALOG_BY_KEY } from "./defaults";

/**
 * Overlay Design System — preview-token decoder.
 *
 * The admin "live preview" iframe embeds the operator's pending token
 * edits as a base64-encoded JSON map in the URL (`?previewTokens=<b64>`).
 * The SSR overlay route decodes the param via this helper and renders a
 * second `<style id="preview-tokens">` block that overrides the
 * persisted `:root` block. Saving the form persists; navigating away
 * with no save discards.
 *
 * Security: the value lands in CSS `--overlay-*` variables which feed
 * directly into `style="color: var(--overlay-accent-color)"` etc inside
 * the iframe. We MUST reject anything that could break out of the
 * variable context. We:
 *   - reject any token_key not in the catalog (no hostile attribute names);
 *   - cap value length at 200;
 *   - reject any value containing `;` `{` `}` `<` `>` `"` `'` (CSS / HTML
 *     escape attempts);
 *   - return null silently on malformed base64 / JSON / shape so a typo
 *     in the URL doesn't 500 the overlay route.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §5.2
 */

const FORBIDDEN_CHARS = /[;{}<>"']/;

const TokenValueSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !FORBIDDEN_CHARS.test(v), {
    message: "value contains forbidden CSS/HTML metacharacter",
  });

const PreviewTokensSchema = z
  .record(z.string(), TokenValueSchema)
  .refine(
    (obj) => Object.keys(obj).every((k) => k in TOKEN_CATALOG_BY_KEY),
    { message: "unknown token_key" },
  )
  .refine((obj) => Object.keys(obj).length <= 32, {
    message: "too many preview tokens (>32)",
  });

/**
 * Decode the `?previewTokens=<base64>` param into a typed
 * Record<tokenKey, tokenValue>. Returns null when:
 *   - param is missing / empty;
 *   - base64 is malformed;
 *   - JSON is malformed;
 *   - shape fails the Zod schema (unknown key, bad value, oversize).
 *
 * Returns Record<string,string> on success — only safe-to-inline strings
 * keyed by known token_keys.
 */
export async function decodePreviewTokens(
  raw: string | undefined | null,
): Promise<Record<string, string> | null> {
  if (!raw) return null;
  let json: string;
  try {
    // URL-safe base64 — restore padding + alphabet.
    const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
    const padLen = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
    const fullPadded = padded + "=".repeat(padLen);
    json = Buffer.from(fullPadded, "base64").toString("utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const result = PreviewTokensSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

/**
 * Inverse of `decodePreviewTokens`. Used by the client-side editor to
 * build the iframe `src` query param.
 */
export function encodePreviewTokens(tokens: Record<string, string>): string {
  const json = JSON.stringify(tokens);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf-8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  }
  // Browser fallback (kept here so the helper is symmetric — the client
  // editor calls a sibling client-side encoder, but this lives so test
  // env can round-trip without DOM).
  return "";
}

/**
 * CSS variable value escaper. Mirrors the constraints the Zod schema
 * already enforces but acts as a final defence-in-depth before output.
 * Currently identity (we already validated metacharacters out).
 */
export function escapeCssValue(v: string): string {
  return v.replace(/[;{}<>"']/g, "");
}
