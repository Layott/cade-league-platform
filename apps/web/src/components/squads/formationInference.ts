/**
 * Pure formation-inference helper. Lives in a non-`"use client"` module so
 * Server Components (e.g. `/player/squad/page.tsx::buildInitialSquadFromSubmission`)
 * can call it directly. Client components import the same helper.
 *
 * Bug fix 2026-05-02: previously co-located in `SquadPitchView.tsx` which
 * carries `"use client"`. Importing a named export from a Client Component
 * module into a Server Component yields a client reference (not a callable
 * function); calling it at server-render time throws the "Attempted to call
 * inferFormationFromItems() ..." runtime error users saw on the
 * `/player/squad?matchDay=…&edit=1` route.
 */

// Bug fix 2026-05-02: import from `./formations` (no "use client") instead
// of `./PitchLayout` (which is "use client") so this helper module stays
// server-callable. Importing the consts via PitchLayout left them as client
// references at runtime → "TypeError: q.FORMATION_KEYS" on server render.
import {
  getFormationSlots,
  FORMATION_KEYS,
  type FormationKey,
} from "./formations";

export type FormationInferenceItem = {
  position: string | null | undefined;
};

/**
 * Infer a formation key from the 11 lineup positions. Strategy:
 *   1. Exact full-tuple match — compare the sorted position multiset
 *      against every known formation. Return the first hit.
 *   2. Defender/mid/attacker count signature match (looser).
 *   3. Fallback to "433" so the pitch always has SOMETHING to render.
 */
export function inferFormationFromItems(
  items: FormationInferenceItem[],
): FormationKey {
  if (items.length === 0) return "433";
  const positionMultiset = items
    .map((it) => (it.position ?? "").toUpperCase())
    .sort()
    .join("|");
  for (const key of FORMATION_KEYS) {
    const slots = getFormationSlots(key);
    const keyMultiset = slots
      .map((s) => s.label.toUpperCase())
      .sort()
      .join("|");
    if (keyMultiset === positionMultiset) return key;
  }

  const positions = items.map((it) => (it.position ?? "").toUpperCase());
  const def = positions.filter((p) => /^(LB|RB|CB|LWB|RWB)$/.test(p)).length;
  const mid = positions.filter((p) => /^(CDM|CM|CAM|LM|RM)$/.test(p)).length;
  const att = positions.filter((p) => /^(LW|RW|LF|RF|CF|ST)$/.test(p)).length;
  const sig = `${def}-${mid}-${att}`;
  switch (sig) {
    case "4-3-3":
      return "433";
    case "4-4-2":
      return "442";
    case "4-2-3-1":
    case "4-5-1":
      return "4231";
    case "3-5-2":
      return "352";
    case "3-4-3":
      return "343";
    case "5-3-2":
      return "532";
    case "5-4-1":
      return "541";
    case "5-2-3":
      return "523";
    default:
      return "433";
  }
}
