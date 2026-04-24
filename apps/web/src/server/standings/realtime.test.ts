import { describe, it, expect, vi } from "vitest";
import {
  publishStandingsChanged,
  standingsChannelName,
  STANDINGS_EVENT_CHANGED,
} from "./realtime";

describe("standings realtime helper", () => {
  it("forms public:standings:<seasonId> channel name", () => {
    expect(standingsChannelName("season-abc")).toBe("public:standings:season-abc");
  });

  it("exposes the stable event name constant", () => {
    expect(STANDINGS_EVENT_CHANGED).toBe("standings.changed");
  });

  it("calls supabase channel.send with correct shape", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishStandingsChanged
    >[0];
    const fixed = new Date("2026-05-18T10:00:00.000Z");
    const res = await publishStandingsChanged(sb, "season-xyz", fixed);
    expect(channel).toHaveBeenCalledWith("public:standings:season-xyz");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "standings.changed",
      payload: {
        seasonId: "season-xyz",
        at: fixed.toISOString(),
      },
    });
    expect(res).toBe("ok");
  });

  it("defaults return value to 'ok' when send resolves nullish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishStandingsChanged
    >[0];
    const res = await publishStandingsChanged(sb, "s", new Date());
    expect(res).toBe("ok");
  });

  it("removes the channel after send, even on error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishStandingsChanged
    >[0];
    await expect(publishStandingsChanged(sb, "s")).rejects.toThrow("boom");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("tolerates removeChannel throwing", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn().mockRejectedValue(new Error("cleanup"));
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishStandingsChanged
    >[0];
    // Should not reject — cleanup failure is swallowed.
    const res = await publishStandingsChanged(sb, "s");
    expect(res).toBe("ok");
  });
});
