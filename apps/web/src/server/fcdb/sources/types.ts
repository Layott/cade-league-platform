/**
 * Plan 24 — source adapter contracts.
 *
 * Every source (kaggle / futdb / sofifa) exposes an async function that
 * either produces an array of normalized rows ready for upsert into
 * `public.fc26_players`, or a "skipped" result (dependencies missing /
 * rate limit already exhausted / whatever) so the orchestrator can fall
 * through cleanly to the next source.
 *
 * Failure of a single source MUST NOT throw — return `{ skipped: true,
 * reason }` instead. Throwing is reserved for true "refuse to record
 * anything" bugs (e.g. library import failures the runtime can't recover
 * from). The orchestrator in refresh.ts treats thrown errors as "this
 * source blew up" + tries the next one anyway.
 */

export type NormalizedFCRow = {
  source_dataset: string;
  source_row_id: string;
  name: string;
  slug: string;
  rating: number;
  position: string;
  alt_positions: string[] | null;
  club: string | null;
  league: string | null;
  nation: string | null;
  item_type: string;
  value_coins_estimate: number | null;
  attributes: Record<string, number>;
};

export type SourceResult =
  | {
      skipped: true;
      source: "kaggle" | "futdb" | "sofifa";
      reason: string;
    }
  | {
      skipped?: false;
      source: "kaggle" | "futdb" | "sofifa";
      rows: NormalizedFCRow[];
    };
