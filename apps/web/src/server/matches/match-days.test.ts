import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMatchDay } from "./match-days";

function mockSb(insertResult: { id: string } | null, insertError: Error | null = null) {
  const insertFn = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue(
        insertError
          ? { data: null, error: insertError }
          : { data: insertResult, error: null }
      ),
    })),
  }));
  return {
    from: vi.fn(() => ({ insert: insertFn })),
    _insertFn: insertFn,
  };
}

describe("createMatchDay", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects invalid date format", async () => {
    const sb = mockSb({ id: "x" });
    await expect(
      createMatchDay(sb as never, {
        seasonId: "11111111-1111-4111-8111-111111111111",
        matchDate: "2026/06/01",
        arrivalCutoffTime: "18:00",
        matchStartTime: "19:00",
        venueName: "v",
      } as never)
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("inserts row and returns id on happy path", async () => {
    const sb = mockSb({ id: "md-1" });
    const out = await createMatchDay(sb as never, {
      seasonId: "11111111-1111-4111-8111-111111111111",
      matchDate: "2026-06-01",
      arrivalCutoffTime: "18:00",
      matchStartTime: "19:00",
      venueName: "CADE HQ",
    });
    expect(out).toEqual({ id: "md-1" });
    expect(sb.from).toHaveBeenCalledWith("match_days");
  });

  it("maps camelCase to snake_case in insert payload", async () => {
    const sb = mockSb({ id: "md-2" });
    await createMatchDay(sb as never, {
      seasonId: "11111111-1111-4111-8111-111111111111",
      matchDate: "2026-06-02",
      arrivalCutoffTime: "17:30",
      matchStartTime: "18:30",
      venueName: "Venue",
      notes: "pre-match meal",
    });
    const payload = (sb._insertFn.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      season_id: "11111111-1111-4111-8111-111111111111",
      match_date: "2026-06-02",
      arrival_cutoff_time: "17:30",
      match_start_time: "18:30",
      venue_name: "Venue",
      notes: "pre-match meal",
    });
  });
});
