import { describe, it, expect, vi } from "vitest";
import {
  publishSnapshotCaptured,
  snapshotCapturedChannelName,
  SNAPSHOT_CAPTURED_EVENT,
} from "./snapshot_captured";

describe("snapshot_captured publisher", () => {
  it("uses public:standings:<seasonId> channel name", () => {
    expect(snapshotCapturedChannelName("s")).toBe("public:standings:s");
  });

  it("event name is 'snapshot.captured'", () => {
    expect(SNAPSHOT_CAPTURED_EVENT).toBe("snapshot.captured");
  });

  it("calls channel.send with correct shape", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const payload = {
      seasonId: "s",
      matchDayId: 7,
      snapshotId: 42,
      at: "2026-04-25T10:00:00Z",
    };
    const res = await publishSnapshotCaptured(sb as never, payload);
    expect(channel).toHaveBeenCalledWith("public:standings:s");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "snapshot.captured",
      payload,
    });
    expect(res).toBe("ok");
  });

  it("defaults to 'ok' when send returns nullish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel };
    const res = await publishSnapshotCaptured(sb as never, {
      seasonId: "s",
      matchDayId: 1,
      snapshotId: 1,
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
      publishSnapshotCaptured(sb as never, {
        seasonId: "s",
        matchDayId: 1,
        snapshotId: 1,
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
    const res = await publishSnapshotCaptured(sb as never, {
      seasonId: "s",
      matchDayId: 1,
      snapshotId: 1,
      at: "x",
    });
    expect(res).toBe("ok");
  });
});
