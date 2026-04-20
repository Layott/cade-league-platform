import { formatInTimeZone } from "date-fns-tz";

export const APP_TIMEZONE = "Africa/Lagos" as const;

export function formatWat(date: Date | string, pattern: string): string {
  return formatInTimeZone(date, APP_TIMEZONE, pattern);
}

export function toWatIso(date: Date | string): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssxxx");
}
