import { describe, it, expect, vi } from "vitest";
import { publish, channelName } from "./realtime";

describe("realtime.publish", () => {
  it("forms overlay:<sessionId> channel name", () => {
    expect(channelName("abc-123")).toBe("overlay:abc-123");
  });

  it("calls supabase channel.send with correct shape", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publish
    >[0];
    const res = await publish(sb, "sess-1", "overlay.triggered", {
      eventId: "ev-1",
    });
    expect(channel).toHaveBeenCalledWith("overlay:sess-1");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "overlay.triggered",
      payload: { eventId: "ev-1" },
    });
    expect(res).toBe("ok");
  });

  it("defaults return value to 'ok' when send resolves nullish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publish
    >[0];
    const res = await publish(sb, "s", "overlay.cleared", {});
    expect(res).toBe("ok");
  });
});
