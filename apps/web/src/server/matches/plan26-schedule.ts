/**
 * Plan 26 — TypeScript mirror of the LOC-supplied fixture schedule that
 * lives in `supabase/seed/plan26_real_fixtures.sql`. The seed file is the
 * canonical artifact written to the database; this constant exists so unit
 * tests can validate round-robin invariants without parsing SQL.
 *
 * INVARIANT: must remain byte-identical (modulo ordering inside a day) to
 * the seed. The unit test `plan26-schedule.test.ts` enforces:
 *   - 78 fixtures total
 *   - 13 distinct players, each with exactly 12 matches
 *   - no duplicate unordered pair across the season
 */

export type Plan26Day = {
  date: string; // YYYY-MM-DD
  pairs: ReadonlyArray<readonly [string, string]>;
};

export const PLAN26_SCHEDULE: readonly Plan26Day[] = [
  {
    date: "2026-04-26",
    pairs: [
      ["ADEFOLA", "GURU"],
      ["TACTICAL", "WOLEVATION"],
      ["BAJI_JNR", "KILLER_FREAK"],
      ["DADABOI", "KAYKAY"],
      ["ANIFE", "MITCH"],
      ["ADEFOLA", "TACTICAL"],
      ["KILLER_FREAK", "WOLEVATION"],
      ["BAJI_JNR", "MR_OGA"],
      ["GURU", "KAYKAY"],
      ["KINGNONEX", "MITCH"],
    ],
  },
  {
    date: "2026-05-02",
    pairs: [
      ["DADABOI", "WOLEVATION"],
      ["GURU", "MR_OGA"],
      ["ANIFE", "KAYKAY"],
      ["BAJI_JNR", "MITCH"],
      ["DADABOI", "FARUK"],
      ["ADEFOLA", "MR_OGA"],
      ["ANIFE", "GURU"],
      ["KAYKAY", "KILLER_FREAK"],
      ["FARUK", "WOLEVATION"],
      ["ADEFOLA", "BAJI_JNR"],
      ["KILLER_FREAK", "MITCH"],
    ],
  },
  {
    date: "2026-05-03",
    pairs: [
      ["ANIFE", "KILLER_FREAK"],
      ["BAJI_JNR", "WOLEVATION"],
      ["ADEFOLA", "MITCH"],
      ["FARUK", "KINGNONEX"],
      ["KILLER_FREAK", "MR_OGA"],
      ["ANIFE", "DADABOI"],
      ["ADEFOLA", "WOLEVATION"],
      ["MITCH", "MR_OGA"],
      ["BAJI_JNR", "DADABOI"],
    ],
  },
  {
    date: "2026-05-09",
    pairs: [
      ["ADEFOLA", "DADABOI"],
      ["ANIFE", "MR_OGA"],
      ["FARUK", "MITCH"],
      ["BAJI_JNR", "KINGNONEX"],
      ["GURU", "TACTICAL"],
      ["DADABOI", "MR_OGA"],
      ["ADEFOLA", "FARUK"],
      ["KAYKAY", "MITCH"],
      ["ANIFE", "TACTICAL"],
      ["GURU", "KINGNONEX"],
      ["BAJI_JNR", "KAYKAY"],
    ],
  },
  {
    date: "2026-05-10",
    pairs: [
      ["FARUK", "MR_OGA"],
      ["DADABOI", "KILLER_FREAK"],
      ["BAJI_JNR", "GURU"],
      ["MITCH", "WOLEVATION"],
      ["KINGNONEX", "MR_OGA"],
      ["FARUK", "KAYKAY"],
      ["DADABOI", "TACTICAL"],
      ["GURU", "MITCH"],
      ["KINGNONEX", "WOLEVATION"],
      ["BAJI_JNR", "TACTICAL"],
    ],
  },
  {
    date: "2026-05-16",
    pairs: [
      ["DADABOI", "MITCH"],
      ["FARUK", "GURU"],
      ["KILLER_FREAK", "KINGNONEX"],
      ["ADEFOLA", "ANIFE"],
      ["KAYKAY", "TACTICAL"],
      ["DADABOI", "GURU"],
      ["ANIFE", "FARUK"],
      ["ADEFOLA", "KINGNONEX"],
      ["KILLER_FREAK", "TACTICAL"],
      ["KAYKAY", "WOLEVATION"],
    ],
  },
  {
    date: "2026-05-17",
    pairs: [
      ["KINGNONEX", "TACTICAL"],
      ["ADEFOLA", "KILLER_FREAK"],
      ["ANIFE", "WOLEVATION"],
      ["BAJI_JNR", "FARUK"],
      ["KAYKAY", "MR_OGA"],
      ["GURU", "KILLER_FREAK"],
      ["FARUK", "TACTICAL"],
      ["KAYKAY", "KINGNONEX"],
      ["MR_OGA", "WOLEVATION"],
    ],
  },
  {
    date: "2026-05-30",
    pairs: [
      ["DADABOI", "KINGNONEX"],
      ["MITCH", "TACTICAL"],
      ["ANIFE", "BAJI_JNR"],
      ["GURU", "WOLEVATION"],
      ["ADEFOLA", "KAYKAY"],
      ["MR_OGA", "TACTICAL"],
      ["ANIFE", "KINGNONEX"],
      ["FARUK", "KILLER_FREAK"],
    ],
  },
];
