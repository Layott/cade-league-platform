import { describe, it, expect, vi, beforeEach } from "vitest";

const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue("ok"),
}));
vi.mock("./realtime", () => ({ publish: publishMock }));

import { triggerOverlay, clearOverlay } from "./events";

type Handlers = Record<
  string,
  { select?: unknown; insert?: unknown; update?: unknown }
>;

function mkSb(handlers: Handlers) {
  return {
    from: vi.fn((table: string) => handlers[table]),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  };
}

function templateResolver(templateId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: templateId ? { id: templateId } : null,
    error: null,
  });
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({ maybeSingle })),
        })),
        is: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  };
}

describe("triggerOverlay", () => {
  beforeEach(() => publishMock.mockClear());

  it("rejects unknown templateKey", async () => {
    const sb = mkSb({
      overlay_templates: templateResolver("t-1"),
    });
    await expect(
      triggerOverlay(sb as never, {
        sessionId: "s",
        templateKey: "bogus",
        payload: {},
        userId: "u",
      }),
    ).rejects.toThrow(/unknown templateKey/);
  });

  it("rejects payload that fails Zod schema", async () => {
    const sb = mkSb({
      overlay_templates: templateResolver("t-1"),
    });
    await expect(
      triggerOverlay(sb as never, {
        sessionId: "s",
        templateKey: "scorebar",
        payload: { homeName: "a" }, // missing awayName/scores
        userId: "u",
      }),
    ).rejects.toThrow();
  });

  it("writes row and publishes realtime exactly once on happy path", async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: "ev-1" },
      error: null,
    });
    const sb = mkSb({
      overlay_templates: templateResolver("t-1"),
      overlay_events: {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({ single: insertSingle })),
        })),
      },
    });
    const out = await triggerOverlay(sb as never, {
      sessionId: "s",
      templateKey: "scorebar",
      payload: {
        homeName: "Anon-01",
        awayName: "Anon-02",
        homeScore: 3,
        awayScore: 1,
      },
      userId: "u",
    });
    expect(out).toEqual({ id: "ev-1" });
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      sb,
      "s",
      "overlay.triggered",
      expect.objectContaining({
        eventId: "ev-1",
        templateKey: "scorebar",
      }),
    );
  });

  it("throws when template row not found or inactive", async () => {
    const sb = mkSb({
      overlay_templates: templateResolver(null),
    });
    await expect(
      triggerOverlay(sb as never, {
        sessionId: "s",
        templateKey: "scorebar",
        payload: {
          homeName: "a",
          awayName: "b",
          homeScore: 0,
          awayScore: 0,
        },
        userId: "u",
      }),
    ).rejects.toThrow(/template not found/);
  });
});

describe("clearOverlay", () => {
  beforeEach(() => publishMock.mockClear());

  it("sets cleared_at and publishes overlay.cleared", async () => {
    // read-side chain
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "ev-1",
        stream_session_id: "s",
        template_id: "t-1",
        overlay_templates: { template_key: "scorebar" },
      },
      error: null,
    });
    // update-side chain
    const updateEq2 = vi
      .fn()
      .mockResolvedValue({ error: null });
    const sb = mkSb({
      overlay_events: {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({ maybeSingle })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ is: updateEq2 })),
        })),
      },
    });
    await clearOverlay(sb as never, "ev-1", "u");
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      sb,
      "s",
      "overlay.cleared",
      expect.objectContaining({ eventId: "ev-1", templateKey: "scorebar" }),
    );
  });
});
