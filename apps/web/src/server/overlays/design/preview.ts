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

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 2 — text-element preview decoder                      *
 * ------------------------------------------------------------------ */

/**
 * Element-id schema — kebab-case, 1..64 chars, starts with lowercase
 * letter. Mirrors `_shared/css-validator.ts::ELEMENT_ID_RE`.
 */
const ELEMENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%-]+\))$/;
const ALIGNMENT_VALUES = ["left", "center", "right", "justify"] as const;
const FONT_FAMILY_ALLOWLIST = [
  "Agharti",
  "Quedora",
  "Inter",
  "JetBrains Mono",
] as const;

/**
 * Per-element style override schema. All fields optional — every absent
 * key leaves that property at the HTML / DB default. Mirrors the
 * iframe-side bootstrap's expected shape (see spec §6.2).
 *
 * `fontSize`, `letterSpacing`, `left`, `top` are CSS-shape strings (e.g.
 * `'120px'`, `'0.04em'`). We re-validate them through the metacharacter
 * regex so a malicious previewTextTokens param can't break out of the
 * declaration block.
 */
const TextStyleSchema = z
  .object({
    fontFamily: z
      .enum(FONT_FAMILY_ALLOWLIST as readonly string[] as [string, ...string[]])
      .optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    fontSize: z
      .string()
      .max(20)
      .refine((v) => !FORBIDDEN_CHARS.test(v))
      .optional(),
    letterSpacing: z
      .string()
      .max(20)
      .refine((v) => !FORBIDDEN_CHARS.test(v))
      .optional(),
    lineHeight: z.number().min(0.6).max(3.0).optional(),
    color: z
      .string()
      .max(40)
      .refine((v) => !FORBIDDEN_CHARS.test(v))
      .refine((v) => COLOR_RE.test(v))
      .optional(),
    textAlign: z
      .enum(ALIGNMENT_VALUES as readonly string[] as [string, ...string[]])
      .optional(),
    opacity: z.number().min(0).max(1).optional(),
    left: z
      .string()
      .max(20)
      .refine((v) => !FORBIDDEN_CHARS.test(v))
      .optional(),
    top: z
      .string()
      .max(20)
      .refine((v) => !FORBIDDEN_CHARS.test(v))
      .optional(),
    zIndex: z.number().int().min(0).max(40).optional(),
  })
  .strict();

const TextElementOverrideSchema = z
  .object({
    origin: z.enum(["seed", "runtime"]).optional(),
    visible: z.boolean().optional(),
    content: z
      .string()
      .max(1024)
      .refine((v) => !/[<>]/.test(v), {
        message: "content cannot contain < or > (HTML injection guard)",
      })
      .nullable()
      .optional(),
    styles: TextStyleSchema.optional(),
  })
  .strict();

const PreviewTextTokensSchema = z
  .record(
    z.string().regex(ELEMENT_ID_RE, "element_id must be kebab-case"),
    TextElementOverrideSchema,
  )
  .refine((obj) => Object.keys(obj).length <= 64, {
    message: "too many preview text tokens (>64)",
  });

export type PreviewTextTokens = z.infer<typeof PreviewTextTokensSchema>;

/**
 * Decode `?previewTextTokens=<base64>` into a typed map. Returns null on
 * any failure (missing param, malformed b64, malformed JSON, schema
 * mismatch) so a typo in the URL never 500s the overlay route.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §6.1
 */
export async function decodePreviewTextTokens(
  raw: string | undefined | null,
): Promise<PreviewTextTokens | null> {
  if (!raw) return null;
  let json: string;
  try {
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

  const result = PreviewTextTokensSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 3 — partner-strip preview decoder                     *
 * ------------------------------------------------------------------ */

/**
 * Strip-layout shape mirrors `PartnerStripLayout` from
 * `apps/web/src/server/overlays/partners/strip.ts`. Strict so unknown
 * keys (typos / hostile input) drop the whole map silently to null.
 *
 * Anchor / orientation / justification enums match the DB CHECK
 * constraints (migration `20260620000002`). Numeric ranges mirror the
 * server-side `validateInput()` so an admin live-preview cannot push
 * out-of-range layouts.
 */
const PARTNER_ANCHOR_VALUES = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
const PARTNER_ORIENTATION_VALUES = ["horizontal", "vertical"] as const;
const PARTNER_JUSTIFICATION_VALUES = [
  "start",
  "center",
  "end",
  "space-between",
] as const;

const PartnerStripLayoutSchema = z
  .object({
    visible: z.boolean(),
    positionXPx: z.number().int().min(-1920).max(1920),
    positionYPx: z.number().int().min(-1080).max(1080),
    anchor: z.enum(
      PARTNER_ANCHOR_VALUES as readonly string[] as [string, ...string[]],
    ),
    orientation: z.enum(
      PARTNER_ORIENTATION_VALUES as readonly string[] as [string, ...string[]],
    ),
    scalePct: z.number().int().min(50).max(200),
    itemSpacingPx: z.number().int().min(0).max(256),
    justification: z.enum(
      PARTNER_JUSTIFICATION_VALUES as readonly string[] as [string, ...string[]],
    ),
    zIndex: z.number().int().min(0).max(40),
  })
  .strict();

/**
 * Logo entry for the preview channel. `fileUrl` is rendered straight
 * into the iframe so we screen for CSS / HTML metacharacters AND require
 * a valid http(s) or root-relative URL — defence-in-depth on top of the
 * server-side validation in `partners/logos.ts::validateLogoInput`.
 *
 * `partnerKey` MUST match the kebab-case rule from the DB unique index
 * so a hostile preview can't synthesise a logo with `;evil` characters.
 */
const URL_RE = /^(\/[^?]*|https?:\/\/[^\s<>"']{1,500})$/;
const PARTNER_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

const PartnerLogoEntrySchema = z
  .object({
    partnerKey: z.string().regex(PARTNER_KEY_RE),
    label: z
      .string()
      .max(200)
      .refine((v) => !/[<>]/.test(v), {
        message: "label cannot contain < or >",
      }),
    alt: z
      .string()
      .max(200)
      .refine((v) => !/[<>]/.test(v), {
        message: "alt cannot contain < or >",
      }),
    fileUrl: z
      .string()
      .max(1000)
      .refine((v) => URL_RE.test(v), { message: "fileUrl must be url" })
      .refine((v) => !FORBIDDEN_CHARS.test(v), {
        message: "fileUrl contains forbidden CSS/HTML metacharacter",
      }),
    visible: z.boolean().optional(),
    sort: z.number().int().min(0).max(999).optional(),
  })
  .strict();

const PreviewPartnerTokensSchema = z
  .object({
    layout: PartnerStripLayoutSchema.optional(),
    logos: z.array(PartnerLogoEntrySchema).max(32).optional(),
  })
  .strict();

export type PreviewPartnerTokens = z.infer<typeof PreviewPartnerTokensSchema>;

/**
 * Decode `?previewPartnerTokens=<base64>` into a typed map. Returns
 * null on any failure (missing param, malformed b64/JSON, schema
 * mismatch). Used by the admin live-preview path so dragging the
 * partner-strip position slider re-renders the iframe without saving.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.6, §6.2
 */
export async function decodePreviewPartnerTokens(
  raw: string | undefined | null,
): Promise<PreviewPartnerTokens | null> {
  if (!raw) return null;
  let json: string;
  try {
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

  const result = PreviewPartnerTokensSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}
