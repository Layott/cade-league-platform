import { formatInTimeZone } from "date-fns-tz";

export const APP_TIMEZONE = "Africa/Lagos" as const;

export function formatWat(date: Date | string, pattern: string): string {
  return formatInTimeZone(date, APP_TIMEZONE, pattern);
}

export function toWatIso(date: Date | string): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssxxx");
}

// -- Plan 10 -- Thursday-anchored week math for squad submissions.
// Africa/Lagos is UTC+1 year-round (no DST), so we can compute in WAT by
// shifting the instant with a format call and parsing the YMD back.
//
// weekStartThursday(d) → "YYYY-MM-DD" of the Thursday on-or-before d (WAT).
// thursdayDeadline(weekStart) → Date at 10:00:00 WAT on that Thursday (as UTC Date).
// fridayWindowBounds(weekStart) → { openAt, closeAt } at 21:00-22:00 WAT on the
//   FRIDAY immediately after that week's Thursday anchor.
// isWithinFridayWindow(now, weekStart) → true iff openAt ≤ now < closeAt.

/**
 * Returns the Thursday on-or-before the given instant (in Africa/Lagos) as a
 * YYYY-MM-DD string. JS Date.getUTCDay(): 0=Sun..6=Sat, so Thursday=4.
 */
export function weekStartThursday(date: Date | string): string {
  // Express the instant as a YYYY-MM-DD in WAT, then a Date at UTC midnight
  // for safe day-of-week math. Because Africa/Lagos has no DST, formatting
  // any UTC instant in WAT gives the correct local calendar date.
  const ymd = formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd");
  const local = new Date(`${ymd}T00:00:00Z`);
  const dow = local.getUTCDay(); // 0..6 with Sun=0
  const diff = (dow - 4 + 7) % 7; // days since most-recent Thursday
  local.setUTCDate(local.getUTCDate() - diff);
  return local.toISOString().slice(0, 10);
}

/**
 * The hard Thursday 10:00 WAT submission deadline for the given week.
 * Returns a UTC Date; convert to local with formatInTimeZone for display.
 */
export function thursdayDeadline(weekStart: string): Date {
  return new Date(`${weekStart}T10:00:00+01:00`);
}

/**
 * The Friday 21:00-22:00 WAT change window bounds for the given week.
 * `weekStart` must be the Thursday anchor (YYYY-MM-DD). The Friday is the
 * calendar day after weekStart.
 */
export function fridayWindowBounds(weekStart: string): {
  openAt: Date;
  closeAt: Date;
} {
  // Compute the Friday date = Thursday + 1 day.
  const thu = new Date(`${weekStart}T00:00:00Z`);
  thu.setUTCDate(thu.getUTCDate() + 1);
  const friYmd = thu.toISOString().slice(0, 10);
  return {
    openAt: new Date(`${friYmd}T21:00:00+01:00`),
    closeAt: new Date(`${friYmd}T22:00:00+01:00`),
  };
}

/**
 * Half-open interval: openAt ≤ now < closeAt.
 */
export function isWithinFridayWindow(now: Date, weekStart: string): boolean {
  const { openAt, closeAt } = fridayWindowBounds(weekStart);
  const t = now.getTime();
  return t >= openAt.getTime() && t < closeAt.getTime();
}

// -- 2026-04-30 — Weekend-anchored helpers --------------------------------
// User clarification: squads are submitted per WEEKEND (Sat+Sun pair) not
// per match-day. Submissions remain Thursday-anchored at the schema level
// (one squad_submissions row covers every match in the week), but UI
// grouping uses Saturday as the canonical weekend anchor.
//
// weekendStartSaturday(d) → Saturday on-or-before d as YYYY-MM-DD (WAT).
// weekendLabel(satYmd, dates) → "May 2-3" (Sat-Sun) or "May 23" (single).

/**
 * Returns the Saturday on-or-before the given instant (in Africa/Lagos)
 * as YYYY-MM-DD. Sat=6, Sun=0 in JS Date.getUTCDay(). Days since the
 * most-recent Saturday: Sat→0, Sun→1, Mon→2, ..., Fri→6.
 */
export function weekendStartSaturday(date: Date | string): string {
  const ymd = formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd");
  const local = new Date(`${ymd}T00:00:00Z`);
  const dow = local.getUTCDay();
  const diff = (dow + 1) % 7;
  local.setUTCDate(local.getUTCDate() - diff);
  return local.toISOString().slice(0, 10);
}

/**
 * Format a weekend label given the Saturday anchor + the actual match
 * dates that fall in that weekend. Examples:
 *   weekendLabel("2026-05-02", ["2026-05-02", "2026-05-03"]) → "May 2-3"
 *   weekendLabel("2026-05-23", ["2026-05-23"])               → "May 23"
 *   weekendLabel("2026-05-23", [])                            → "May 23-24"
 *     (when called with no concrete dates, defaults to the Sat-Sun pair)
 */
export function weekendLabel(satYmd: string, dates: string[]): string {
  const sat = new Date(`${satYmd}T00:00:00Z`);
  const sun = new Date(sat);
  sun.setUTCDate(sun.getUTCDate() + 1);
  const sunYmd = sun.toISOString().slice(0, 10);
  const month = formatInTimeZone(`${satYmd}T12:00:00Z`, APP_TIMEZONE, "MMM");
  const satDay = parseInt(satYmd.slice(8, 10), 10);
  const sunDay = parseInt(sunYmd.slice(8, 10), 10);
  if (dates.length === 0) return `${month} ${satDay}-${sunDay}`;
  const set = new Set(dates);
  const hasSat = set.has(satYmd);
  const hasSun = set.has(sunYmd);
  if (hasSat && hasSun) return `${month} ${satDay}-${sunDay}`;
  if (hasSat) return `${month} ${satDay}`;
  if (hasSun) return `${month} ${sunDay}`;
  return `${month} ${satDay}-${sunDay}`;
}
