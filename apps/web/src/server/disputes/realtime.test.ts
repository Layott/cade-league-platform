import { describe, it, expect, vi } from "vitest";
import {
  publishDisputeSubmitted,
  publishDisputeRuled,
  DISPUTES_ADMIN_CHANNEL,
  playerDisputesChannelName,
  DISPUTE_EVENT_SUBMITTED,
  DISPUTE_EVENT_RULED,
} from "./realtime";

describe("disputes realtime helpers", () => {
  it("stable channel names + event constants", () => {
    expect(DISPUTES_ADMIN_CHANNEL).toBe("public:disputes:admin");
    expect(playerDisputesChannelName("user-x")).toBe("public:dispute:user-x");
    expect(DISPUTE_EVENT_SUBMITTED).toBe("dispute.submitted");
    expect(DISPUTE_EVENT_RULED).toBe("dispute.ruled");
  });

  it("publishDisputeSubmitted targets admin topic", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishDisputeSubmitted
    >[0];
    await publishDisputeSubmitted(sb, {
      disputeId: "d-1",
      raisedByUserId: "u-1",
    });
    expect(channel).toHaveBeenCalledWith("public:disputes:admin");
    expect(send.mock.calls[0][0].event).toBe("dispute.submitted");
  });

  it("publishDisputeRuled scopes to per-user topic", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishDisputeRuled
    >[0];
    await publishDisputeRuled(sb, {
      disputeId: "d-2",
      raisedByUserId: "u-2",
      status: "resolved",
    });
    expect(channel).toHaveBeenCalledWith("public:dispute:u-2");
    expect(send.mock.calls[0][0].payload.status).toBe("resolved");
  });
});
