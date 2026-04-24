import { describe, it, expect, vi } from "vitest";
import {
  publishAppealSubmitted,
  publishAppealRuled,
  APPEALS_ADMIN_CHANNEL,
  playerAppealsChannelName,
  APPEAL_EVENT_SUBMITTED,
  APPEAL_EVENT_RULED,
} from "./realtime";

describe("appeals realtime helpers", () => {
  it("stable channel names + event constants", () => {
    expect(APPEALS_ADMIN_CHANNEL).toBe("public:appeals:admin");
    expect(playerAppealsChannelName("user-x")).toBe("public:appeal:user-x");
    expect(APPEAL_EVENT_SUBMITTED).toBe("appeal.submitted");
    expect(APPEAL_EVENT_RULED).toBe("appeal.ruled");
  });

  it("publishAppealSubmitted sends correct payload on admin topic", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishAppealSubmitted
    >[0];
    const at = new Date("2026-04-30T12:00:00.000Z");
    await publishAppealSubmitted(
      sb,
      { appealId: "a-1", submittedByUserId: "u-1" },
      at,
    );
    expect(channel).toHaveBeenCalledWith("public:appeals:admin");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "appeal.submitted",
      payload: {
        appealId: "a-1",
        submittedByUserId: "u-1",
        at: at.toISOString(),
      },
    });
  });

  it("publishAppealRuled scopes to per-user topic", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    const removeChannel = vi.fn();
    const channel = vi.fn(() => ({ send }));
    const sb = { channel, removeChannel } as unknown as Parameters<
      typeof publishAppealRuled
    >[0];
    await publishAppealRuled(sb, {
      appealId: "a-2",
      submittedByUserId: "u-2",
      status: "ruled",
    });
    expect(channel).toHaveBeenCalledWith("public:appeal:u-2");
    expect(send.mock.calls[0][0].payload.status).toBe("ruled");
  });
});
