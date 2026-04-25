import { describe, it, expect, vi } from "vitest";
import {
  publishWalkoverConfirmed,
  walkoverConfirmedChannelName,
  WALKOVER_CONFIRMED_EVENT,
} from "./walkover_confirmed";

describe("walkover_confirmed publisher", () => {
  it("uses public:standings:<seasonId> channel name", () => {
    expect(walkoverConfirmedChannelName("s")).toBe("public:standings:s");
  });

  it("event name is 'walkover.confirmed'", () => {
    expect(WALKOVER_CONFIRMED_EVENT).toBe("walkover.confirmed");
  });

  it("calls channel.send with correct shape", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const payload = {
      seasonId: "s",
      matchId: "m",
      winnerPlayerId: "p1",
      initiatedBy: "admin" as const,
      at: "2026-04-25T10:00:00Z",
    };
    const res = await publishWalkoverConfirmed(sb as never, payload);
    expect(channel).toHaveBeenCalledWith("public:standings:s");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "walkover.confirmed",
      payload,
    });
    expect(res).toBe("ok");
  });

  it("defaults to 'ok' when send returns nullish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const res = await publishWalkoverConfirmed(sb as never, {
      seasonId: "s",
      matchId: "m",
      winnerPlayerId: "p1",
      initiatedBy: "ref",
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
      publishWalkoverConfirmed(sb as never, {
        seasonId: "s",
        matchId: "m",
        winnerPlayerId: "p1",
        initiatedBy: "admin",
        at: "x",
      }),
    ).rejects.toThrow("boom");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("tolerates removeChannel throwing", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn().mockRejectedValue(new Error("cleanup"));
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const res = await publishWalkoverConfirmed(sb as never, {
      seasonId: "s",
      matchId: "m",
      winnerPlayerId: "p1",
      initiatedBy: "ref",
      at: "x",
    });
    expect(res).toBe("ok");
  });
});
