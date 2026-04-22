import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { APP_TIMEZONE } from "./time";

/**
 * Business-day arithmetic anchored to Africa/Lagos (WAT).
 *
 * Nigeria does not observe DST, so the offset is fixed at UTC+01:00. We still
 * route through date-fns-tz so the semantics read correctly and stay portable
 * if the app ever needs to run against a DST-aware zone.
 *
 * `addBusinessDays(base, count)`:
 *  - Interpret `base` as an instant; extract the WAT calendar date.
 *  - If `base` is on a weekend (or if we're starting mid-Friday), the first
 *    business-day counted is the next Monday — i.e. weekends are skipped
 *    even when they are the starting day.
 *  - Advance calendar day-by-day, skipping Sat (ISO dow=6) and Sun (dow=7).
 *  - Result = 23:59:59 WAT on the target date, returned as a UTC `Date`.
 *
 * Holidays are intentionally not modelled in Plan 13 — the IDC will supply a
 * list in a future phase. Admins can manually extend deadlines meanwhile.
 */
export function addBusinessDays(
  base: Date | string,
  count: number,
  tz: string = APP_TIMEZONE,
): Date {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(
      `addBusinessDays: count must be a non-negative integer, got ${String(count)}`,
    );
  }

  const baseDate = base instanceof Date ? base : new Date(base);
  if (Number.isNaN(baseDate.getTime())) {
    throw new RangeError(`addBusinessDays: invalid base date: ${String(base)}`);
  }

  // Work in zoned time so "next calendar day" respects the WAT boundary.
  const zoned = toZonedTime(baseDate, tz);
  let y = zoned.getFullYear();
  let m = zoned.getMonth();
  let d = zoned.getDate();

  let remaining = count;
  while (remaining > 0) {
    // Advance one calendar day.
    const next = new Date(y, m, d + 1);
    y = next.getFullYear();
    m = next.getMonth();
    d = next.getDate();
    const dow = new Date(y, m, d).getDay(); // 0=Sun..6=Sat
    if (dow === 0 || dow === 6) continue;
    remaining -= 1;
  }

  // If count=0, we still need to anchor the result to end-of-day on the BASE
  // date, and if that date is a weekend we roll forward to the next biz day.
  if (count === 0) {
    let dow = new Date(y, m, d).getDay();
    while (dow === 0 || dow === 6) {
      const next = new Date(y, m, d + 1);
      y = next.getFullYear();
      m = next.getMonth();
      d = next.getDate();
      dow = new Date(y, m, d).getDay();
    }
  }

  // Build end-of-day WAT string and convert back to UTC instant.
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const endOfDayLocal = `${y}-${mm}-${dd}T23:59:59`;
  return fromZonedTime(endOfDayLocal, tz);
}

/**
 * True iff `date` (when viewed in `tz`) is Monday-Friday.
 */
export function isBusinessDay(
  date: Date | string,
  tz: string = APP_TIMEZONE,
): boolean {
  const d = date instanceof Date ? date : new Date(date);
  const isoDow = Number(formatInTimeZone(d, tz, "i")); // 1=Mon..7=Sun
  return isoDow >= 1 && isoDow <= 5;
}

/**
 * Count of full business days elapsed between two instants, when both are
 * viewed in `tz`. Weekends don't count. If `later` is earlier than `earlier`
 * we return 0 (never negative). Same-calendar-day returns 0. Tomorrow-business
 * returns 1. Monday → following Monday returns 5 (weekend skipped).
 *
 * Holidays intentionally not modelled (same contract as `addBusinessDays`).
 */
export function businessDaysBetween(
  earlier: Date | string,
  later: Date | string,
  tz: string = APP_TIMEZONE,
): number {
  const a = earlier instanceof Date ? earlier : new Date(earlier);
  const b = later instanceof Date ? later : new Date(later);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    throw new RangeError("businessDaysBetween: invalid date input");
  }
  if (b.getTime() <= a.getTime()) return 0;

  // Extract calendar-date strings in the target timezone (e.g. "2026-04-22")
  // to guarantee day boundaries match WAT, not UTC.
  const aDateStr = formatInTimeZone(a, tz, "yyyy-MM-dd");
  const bDateStr = formatInTimeZone(b, tz, "yyyy-MM-dd");
  if (aDateStr === bDateStr) return 0;

  // Walk calendar days from aDateStr → bDateStr, counting Mon-Fri transitions.
  // Parse as local-neutral Date so getDay() reflects the calendar day we just
  // serialized (no TZ round-trip needed since we're only comparing weekdays).
  const [ay, am, ad] = aDateStr.split("-").map(Number);
  const [by, bm, bd] = bDateStr.split("-").map(Number);
  let cursor = new Date(ay, am - 1, ad);
  const end = new Date(by, bm - 1, bd);
  let count = 0;
  while (cursor.getTime() < end.getTime()) {
    cursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
    );
    const dow = cursor.getDay(); // 0=Sun..6=Sat
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}
