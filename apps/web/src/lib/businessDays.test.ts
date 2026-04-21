import { describe, it, expect } from "vitest";
import { addBusinessDays, isBusinessDay } from "./businessDays";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE } from "./time";

function fmt(d: Date): string {
  return formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

describe("addBusinessDays", () => {
  it("Friday + 5 biz days = next Friday (weekend skipped)", () => {
    // 2026-05-01 is a Friday. +5 biz: Mon 5/4, Tue 5/5, Wed 5/6, Thu 5/7, Fri 5/8.
    const base = new Date("2026-05-01T10:00:00+01:00");
    const result = addBusinessDays(base, 5);
    expect(fmt(result)).toBe("2026-05-08 23:59:59");
  });

  it("Monday + 5 biz days = next Monday", () => {
    const base = new Date("2026-05-04T10:00:00+01:00");
    const result = addBusinessDays(base, 5);
    expect(fmt(result)).toBe("2026-05-11 23:59:59");
  });

  it("Wednesday + 5 biz days = next Wednesday", () => {
    const base = new Date("2026-05-06T10:00:00+01:00");
    const result = addBusinessDays(base, 5);
    expect(fmt(result)).toBe("2026-05-13 23:59:59");
  });

  it("Saturday + 5 biz days lands on the Friday 5 biz days after the next Monday", () => {
    // Sat 2026-05-02 → count starts from Mon 5/4 as the first biz day we
    // advance to. Mon 5/4, Tue 5/5, Wed 5/6, Thu 5/7, Fri 5/8.
    const base = new Date("2026-05-02T10:00:00+01:00");
    const result = addBusinessDays(base, 5);
    expect(fmt(result)).toBe("2026-05-08 23:59:59");
  });

  it("Late-evening Friday still anchors to end-of-day on target Friday", () => {
    // 23:50 Fri 2026-05-01 is still Friday in WAT. +5 biz = Fri 2026-05-08.
    const base = new Date("2026-05-01T23:50:00+01:00");
    const result = addBusinessDays(base, 5);
    expect(fmt(result)).toBe("2026-05-08 23:59:59");
  });

  it("count=0 on a weekday returns end-of-day of that day", () => {
    const base = new Date("2026-05-06T10:00:00+01:00"); // Wed
    const result = addBusinessDays(base, 0);
    expect(fmt(result)).toBe("2026-05-06 23:59:59");
  });

  it("count=0 on a Saturday rolls forward to Monday end-of-day", () => {
    const base = new Date("2026-05-02T12:00:00+01:00"); // Sat
    const result = addBusinessDays(base, 0);
    expect(fmt(result)).toBe("2026-05-04 23:59:59");
  });

  it("rejects negative count", () => {
    expect(() => addBusinessDays(new Date(), -1)).toThrow(/non-negative/);
  });

  it("rejects non-integer count", () => {
    expect(() => addBusinessDays(new Date(), 1.5)).toThrow(/integer/);
  });

  it("rejects invalid base", () => {
    expect(() => addBusinessDays(new Date("not-a-date"), 5)).toThrow();
  });
});

describe("isBusinessDay", () => {
  it("Monday through Friday are business days", () => {
    for (const iso of [
      "2026-05-04T10:00:00+01:00", // Mon
      "2026-05-05T10:00:00+01:00", // Tue
      "2026-05-06T10:00:00+01:00", // Wed
      "2026-05-07T10:00:00+01:00", // Thu
      "2026-05-08T10:00:00+01:00", // Fri
    ]) {
      expect(isBusinessDay(new Date(iso))).toBe(true);
    }
  });

  it("Saturday and Sunday are not business days", () => {
    expect(isBusinessDay(new Date("2026-05-02T10:00:00+01:00"))).toBe(false);
    expect(isBusinessDay(new Date("2026-05-03T10:00:00+01:00"))).toBe(false);
  });
});
