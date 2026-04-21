import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { APP_TIMEZONE } from "@/lib/time";

/**
 * Return the YYYY-MM-DD date string for the Monday on or before `now` in WAT.
 * This matches the `content_posts.week_start_monday_ck` constraint.
 */
export function currentWeekStart(
  now: Date = new Date(),
  tz: string = APP_TIMEZONE,
): string {
  // ISO day of week: 1=Mon..7=Sun
  const isoDow = Number(formatInTimeZone(now, tz, "i"));
  const dateStr = formatInTimeZone(now, tz, "yyyy-MM-dd");

  // Subtract (isoDow - 1) days to land on Monday.
  const [y, m, d] = dateStr.split("-").map((p) => Number(p));
  const anchor = new Date(y, m - 1, d);
  anchor.setDate(anchor.getDate() - (isoDow - 1));

  const y2 = anchor.getFullYear();
  const m2 = String(anchor.getMonth() + 1).padStart(2, "0");
  const d2 = String(anchor.getDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

/**
 * True iff the YYYY-MM-DD is a Monday (ISO dow=1). Used to pre-validate
 * input before hitting the DB CHECK.
 */
export function isMonday(yyyyMmDd: string, tz: string = APP_TIMEZONE): boolean {
  const instant = fromZonedTime(`${yyyyMmDd}T12:00:00`, tz);
  const isoDow = Number(formatInTimeZone(instant, tz, "i"));
  return isoDow === 1;
}
