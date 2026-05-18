/**
 * Wave 2B — wire shape for the Photopea iframe ↔ admin postMessage
 * bridge.
 *
 * Photopea's official postMessage API uses string commands (sent into
 * the iframe via `iframe.contentWindow.postMessage(...)`) and replies
 * via `window.addEventListener('message', ...)` on the parent. The
 * reply payload is either a Photopea status string ("done"), a JSON
 * blob (for queries like `app.activeDocument.name`), or raw binary
 * (`ArrayBuffer`) for export commands like `saveToOE`. We wrap that
 * surface in OUR typed envelope so the rest of the codebase never
 * touches the raw Photopea API.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12
 */

import { z } from "zod";

/** The ONLY origin the bridge listens to. */
export const PHOTOPEA_EMBED_ORIGIN = "https://www.photopea.com" as const;

/**
 * Strict equality check. We don't use `URL` parsing because we need
 * EXACT string equality — `https://photopea.com` (no www) and
 * `http://www.photopea.com` are NOT the canonical embed and must be
 * rejected. Likewise `https://www.photopea.com.evil/` (a homograph
 * suffix) must fail.
 */
export const PhotopeaOriginSchema = z.literal(PHOTOPEA_EMBED_ORIGIN);

/** Outbound: command we send INTO the Photopea iframe. */
export const PhotopeaSaveCommandSchema = z.object({
  type: z.literal("app.activeDocument.saveToOE"),
});
export type PhotopeaSaveCommand = z.infer<typeof PhotopeaSaveCommandSchema>;

/** Inbound: reply from Photopea carrying raw PSD bytes. */
const HUNDRED_MB = 100 * 1024 * 1024;

export const PsdBytesEnvelopeSchema = z
  .object({
    kind: z.literal("psd-bytes"),
    byteLength: z.number().int().min(1).max(HUNDRED_MB),
    payload: z.instanceof(ArrayBuffer),
  })
  .refine((v) => v.payload.byteLength === v.byteLength, {
    message: "byteLength header does not match payload size",
  });
export type PsdBytesEnvelope = z.infer<typeof PsdBytesEnvelopeSchema>;

/**
 * PSD magic bytes. Every valid PSD starts with the literal ASCII
 * sequence `8BPS`. We reject anything else BEFORE handing bytes to
 * `psd-parser.ts` so a hostile `app.open(...)` payload cannot
 * smuggle non-PSD content into our storage bucket.
 */
const PSD_MAGIC = [0x38, 0x42, 0x50, 0x53] as const;

function hasPsdMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === PSD_MAGIC[0] &&
    bytes[1] === PSD_MAGIC[1] &&
    bytes[2] === PSD_MAGIC[2] &&
    bytes[3] === PSD_MAGIC[3]
  );
}

/** Input to `savePsdFromPhotopeaAction` — server action contract. */
export const SavePsdInputSchema = z.object({
  assetId: z.string().uuid(),
  psdBytes: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 0, { message: "psdBytes empty" })
    .refine((b) => b.byteLength <= HUNDRED_MB, {
      message: "psdBytes exceeds 100MB cap",
    })
    .refine(hasPsdMagic, { message: "psdBytes missing 8BPS magic" }),
  note: z.string().max(200).optional(),
});
export type SavePsdInput = z.infer<typeof SavePsdInputSchema>;

/** Output of `savePsdFromPhotopeaAction`. */
export type SavePsdResult = {
  assetId: string;
  historyId: string;
  flatPngAssetId: string;
  spriteAssetIds: readonly string[];
  newSizeBytes: number;
};
