import { describe, it, expect, vi } from "vitest";
import {
  publishSquadSubmitted,
  publishSquadStatusChanged,
  publishSquadChanged,
  squadsAdminChannelName,
  playerSquadChannelName,
  squadStandingsChannelName,
  SQUAD_EVENT_SUBMITTED,
  SQUAD_EVENT_STATUS_CHANGED,
  SQUAD_EVENT_UPDATED,
} from "./realtime";

describe("squads realtime helpers", () => {
  it("forms stable channel names", () => {
    expect(squadsAdminChannelName("2026-04-30")).toBe(
      "public:squads:2026-04-30",
    );
    expect(playerSquadChannelName("player-abc", "2026-04-30")).toBe(
      "public:squad:player-abc:2026-04-30",
    );
    expect(squadStandingsChannelName("season-1")).toBe(
      "public:standings:season-1",
    );
  });

  it("exposes stable event constants", () => {
    expect(SQUAD_EVENT_SUBMITTED).toBe("squad.submitted");
    expect(SQUAD_EVENT_STATUS_CHANGED).toBe("squad.status_changed");
    expect(SQUAD_EVENT_UPDATED).toBe("squad.updated");
  });

  it("publishSquadSubmitted sends correct payload on admin topic", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishSquadSubmitted
    >[0];
    const at = new Date("2026-04-30T12:00:00.000Z");
    const res = await publishSquadSubmitted(
      sb,
      {
        weekStartDate: "2026-04-30",
        playerId: "player-abc",
        submissionId: "sub-1",
      },
      at,
    );
    expect(channel).toHaveBeenCalledWith("public:squads:2026-04-30");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "squad.submitted",
      payload: {
        weekStartDate: "2026-04-30",
        playerId: "player-abc",
        submissionId: "sub-1",
        at: at.toISOString(),
      },
    });
    expect(res).toBe("ok");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("publishSquadStatusChanged scopes to per-player-week topic", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishSquadStatusChanged
    >[0];
    await publishSquadStatusChanged(sb, {
      submissionId: "sub-9",
      playerId: "p-42",
      weekStartDate: "2026-04-30",
      status: "approved",
    });
    expect(channel).toHaveBeenCalledWith("public:squad:p-42:2026-04-30");
    expect(send.mock.calls[0][0].event).toBe("squad.status_changed");
    expect(send.mock.calls[0][0].payload.status).toBe("approved");
  });

  it("cleanup runs even when send errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishSquadSubmitted
    >[0];
    await expect(
      publishSquadSubmitted(sb, {
        weekStartDate: "2026-04-30",
        playerId: "x",
        submissionId: "y",
      }),
    ).rejects.toThrow("boom");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("publishSquadChanged sends squad.updated on the per-season standings channel (2026-05-02)", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishSquadChanged
    >[0];
    const at = new Date("2026-05-02T12:00:00.000Z");
    const res = await publishSquadChanged(
      sb,
      {
        seasonId: "season-1",
        playerId: "p-1",
        matchDayId: "md-1",
        weekStartDate: "2026-04-30",
        submissionId: "sub-9",
      },
      at,
    );
    expect(channel).toHaveBeenCalledWith("public:standings:season-1");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "squad.updated",
      payload: {
        seasonId: "season-1",
        playerId: "p-1",
        matchDayId: "md-1",
        weekStartDate: "2026-04-30",
        submissionId: "sub-9",
        at: at.toISOString(),
      },
    });
    expect(res).toBe("ok");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
