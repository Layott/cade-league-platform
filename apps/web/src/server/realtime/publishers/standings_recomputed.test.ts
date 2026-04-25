import { describe, it, expect, vi } from "vitest";
import {
  publishStandingsRecomputed,
  standingsRecomputedChannelName,
  STANDINGS_RECOMPUTED_EVENT,
} from "./standings_recomputed";

describe("standings_recomputed publisher", () => {
  it("uses public:standings:<seasonId> channel name", () => {
    expect(standingsRecomputedChannelName("s-9")).toBe(
      "public:standings:s-9",
    );
  });

  it("event name is 'standings.changed'", () => {
    expect(STANDINGS_RECOMPUTED_EVENT).toBe("standings.changed");
  });

  it("calls channel.send with correct shape", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const payload = { seasonId: "s", at: "2026-04-25T10:00:00Z" };
    const res = await publishStandingsRecomputed(sb as never, payload);
    expect(channel).toHaveBeenCalledWith("public:standings:s");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "standings.changed",
      payload,
    });
    expect(res).toBe("ok");
  });

  it("defaults to 'ok' when send returns nullish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const res = await publishStandingsRecomputed(sb as never, {
      seasonId: "s",
      at: "x",
    });
    expect(res).toBe("ok");
  });

  it("removes channel even on send error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    await expect(
      publishStandingsRecomputed(sb as never, { seasonId: "s", at: "x" }),
    ).rejects.toThrow("boom");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("tolerates removeChannel throwing", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn().mockRejectedValue(new Error("cleanup"));
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const res = await publishStandingsRecomputed(sb as never, {
      seasonId: "s",
      at: "x",
    });
    expect(res).toBe("ok");
  });
});
