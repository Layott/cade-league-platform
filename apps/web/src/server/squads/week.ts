/**
 * Plan 10 — domain-scoped wrappers around the WAT week helpers in
 * `src/lib/time.ts`. Keeps the squads server layer self-contained so callers
 * don't need to reach into the time lib directly.
 */
export {
  weekStartThursday,
  thursdayDeadline,
  fridayWindowBounds,
  isWithinFridayWindow,
} from "@/lib/time";
