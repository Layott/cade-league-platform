import { describe, it, expect, vi } from "vitest";
import {
  publishScoreChanged,
  scoreChangedChannelName,
  SCORE_CHANGED_EVENT,
} from "./score_changed";

describe("score_changed publisher", () => {
  it("uses public:standings:<seasonId> channel name", () => {
    expect(scoreChangedChannelName("season-1")).toBe("public:standings:season-1");
  });

  it("event name is 'score.changed'", () => {
    expect(SCORE_CHANGED_EVENT).toBe("score.changed");
  });

  it("calls channel.send with correct shape", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const payload = {
      seasonId: "s1",
      matchId: "m1",
      homePlayerId: "p1",
      awayPlayerId: "p2",
      homeScore: 2,
      awayScore: 1,
      at: "2026-04-25T10:00:00Z",
    };
    const res = await publishScoreChanged(sb as never, payload);
    expect(channel).toHaveBeenCalledWith("public:standings:s1");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "score.changed",
      payload,
    });
    expect(res).toBe("ok");
  });

  it("defaults to 'ok' when send returns nullish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const res = await publishScoreChanged(sb as never, {
      seasonId: "s",
      matchId: "m",
      homePlayerId: "p1",
      awayPlayerId: "p2",
      homeScore: 0,
      awayScore: 0,
      at: "2026-04-25T10:00:00Z",
    });
    expect(res).toBe("ok");
  });

  it("removes channel even on send error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    await expect(
      publishScoreChanged(sb as never, {
        seasonId: "s",
        matchId: "m",
        homePlayerId: "a",
        awayPlayerId: "b",
        homeScore: 0,
        awayScore: 0,
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
    const res = await publishScoreChanged(sb as never, {
      seasonId: "s",
      matchId: "m",
      homePlayerId: "a",
      awayPlayerId: "b",
      homeScore: 0,
      awayScore: 0,
      at: "x",
    });
    expect(res).toBe("ok");
  });
});
