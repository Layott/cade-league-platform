/**
 * Plan 21 — types mirroring `public.fc26_players`.
 */

export type FCAttributes = {
  pace?: number;
  shooting?: number;
  passing?: number;
  dribbling?: number;
  defending?: number;
  physical?: number;
  // Sub-attributes are best-effort; absence is normal.
  [k: string]: number | undefined;
};

export type FCItemType =
  | "normal"
  | "totw"
  | "icon"
  | "hero"
  | "evolution"
  | "special"
  | "other";

export type FCPlayer = {
  id: string;
  source_dataset: string;
  source_row_id: string;
  name: string;
  short_name: string | null;
  slug: string;
  rating: number;
  position: string;
  alt_positions: string[] | null;
  club: string | null;
  league: string | null;
  nation: string | null;
  nation_iso: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  preferred_foot: "Left" | "Right" | null;
  weak_foot: number | null;
  skill_moves: number | null;
  body_type: string | null;
  work_rate_atk: "Low" | "Medium" | "High" | null;
  work_rate_def: "Low" | "Medium" | "High" | null;
  attributes: FCAttributes;
  item_type: FCItemType;
  value_coins_estimate: number | null;
  imported_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * Optional ranking metadata returned by `findPlayer` for ref-UI display.
 * `score` is the internal sort key; `sim` is populated only on the trigram
 * fallback path so the UI can show a "fuzzy: 72%" hint.
 */
export type FCPlayerCandidate = FCPlayer & {
  score: number;
  sim?: number;
};
