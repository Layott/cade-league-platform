import { describe, it, expect, vi } from "vitest";
import {
  publishMatchEnded,
  matchEndedChannelName,
  MATCH_ENDED_EVENT,
} from "./match_ended";

describe("match_ended publisher", () => {
  it("uses public:standings:<seasonId> channel name", () => {
    expect(matchEndedChannelName("xyz")).toBe("public:standings:xyz");
  });

  it("event name is 'match.ended'", () => {
    expect(MATCH_ENDED_EVENT).toBe("match.ended");
  });

  it("calls channel.send with correct shape", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const payload = {
      seasonId: "s",
      matchId: "m",
      homePlayerId: "p1",
      awayPlayerId: "p2",
      homeScore: 1,
      awayScore: 1,
      resultType: "normal" as const,
      at: "2026-04-25T10:00:00Z",
    };
    const res = await publishMatchEnded(sb as never, payload);
    expect(channel).toHaveBeenCalledWith("public:standings:s");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "match.ended",
      payload,
    });
    expect(res).toBe("ok");
  });

  it("defaults to 'ok' when send returns nullish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const res = await publishMatchEnded(sb as never, {
      seasonId: "s",
      matchId: "m",
      homePlayerId: "p1",
      awayPlayerId: "p2",
      homeScore: 0,
      awayScore: 0,
      resultType: "void",
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
      publishMatchEnded(sb as never, {
        seasonId: "s",
        matchId: "m",
        homePlayerId: "p1",
        awayPlayerId: "p2",
        homeScore: 0,
        awayScore: 0,
        resultType: "forfeit",
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
    const res = await publishMatchEnded(sb as never, {
      seasonId: "s",
      matchId: "m",
      homePlayerId: "p1",
      awayPlayerId: "p2",
      homeScore: 0,
      awayScore: 0,
      resultType: "normal",
      at: "x",
    });
    expect(res).toBe("ok");
  });
});
