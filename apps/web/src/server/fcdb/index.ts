/**
 * Plan 21 — fcdb module surface.
 *
 * Plan 23's ref-review UI imports from `@/server/fcdb`. Keep the public
 * surface narrow: lookup + per-squad validate + types.
 */

export { findPlayer } from "./lookup";
export type { FindPlayerQuery } from "./lookup";
export {
  validateSubmittedSquadAgainstFCDB,
} from "./validate";
export type {
  SubmittedItem,
  FCDBValidationResult,
  FCDBValidationStatus,
} from "./validate";
export type {
  FCPlayer,
  FCPlayerCandidate,
  FCAttributes,
  FCItemType,
} from "./types";
export { slugify, stripDiacritics } from "./slug";
