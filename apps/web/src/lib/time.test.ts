import { describe, it, expect } from "vitest";
import { formatWat, toWatIso, APP_TIMEZONE } from "./time";

describe("time utilities", () => {
  it("APP_TIMEZONE is Africa/Lagos", () => {
    expect(APP_TIMEZONE).toBe("Africa/Lagos");
  });

  it("formatWat formats UTC to WAT (UTC+1, no DST)", () => {
    const d = new Date("2026-04-20T15:00:00Z");
    expect(formatWat(d, "yyyy-MM-dd HH:mm")).toBe("2026-04-20 16:00");
  });

  it("toWatIso returns WAT offset", () => {
    const d = new Date("2026-04-20T15:00:00Z");
    expect(toWatIso(d)).toMatch(/^2026-04-20T16:00:00\+01:00$/);
  });
});
