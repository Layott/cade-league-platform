import { describe, it, expect, vi } from "vitest";
import {
  publishFixturesChanged,
  fixturesChannelName,
  resolveSeasonIdFromMatchDay,
  FIXTURES_EVENT_CHANGED,
} from "./realtime";

describe("fixtures realtime helper", () => {
  it("forms per-season channel name + stable event constant", () => {
    expect(fixturesChannelName("season-1")).toBe("public:fixtures:season-1");
    expect(FIXTURES_EVENT_CHANGED).toBe("fixtures.changed");
  });

  it("publishFixturesChanged sends correct payload", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishFixturesChanged
    >[0];
    const at = new Date("2026-04-30T12:00:00.000Z");
    await publishFixturesChanged(sb, "season-xyz", "result_confirmed", at);
    expect(channel).toHaveBeenCalledWith("public:fixtures:season-xyz");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "fixtures.changed",
      payload: {
        seasonId: "season-xyz",
        reason: "result_confirmed",
        at: at.toISOString(),
      },
    });
  });

  it("resolveSeasonIdFromMatchDay returns the season on hit", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { season_id: "season-9" }, error: null });
    const is = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ is });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const sb = { from } as unknown as Parameters<
      typeof resolveSeasonIdFromMatchDay
    >[0];
    expect(await resolveSeasonIdFromMatchDay(sb, "md-1")).toBe("season-9");
    expect(from).toHaveBeenCalledWith("match_days");
  });

  it("resolveSeasonIdFromMatchDay returns null on miss", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const is = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ is });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const sb = { from } as unknown as Parameters<
      typeof resolveSeasonIdFromMatchDay
    >[0];
    expect(await resolveSeasonIdFromMatchDay(sb, "md-2")).toBeNull();
  });

  it("resolveSeasonIdFromMatchDay swallows query errors", async () => {
    const from = vi.fn(() => {
      throw new Error("boom");
    });
    const sb = { from } as unknown as Parameters<
      typeof resolveSeasonIdFromMatchDay
    >[0];
    expect(await resolveSeasonIdFromMatchDay(sb, "md-3")).toBeNull();
  });
});
