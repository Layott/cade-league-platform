import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isOverlayActive,
  isInstanceActive,
  probeAllActiveStates,
} from "./overlay_active_state";

vi.mock("@/server/broadcast/events", () => ({
  getActiveForTemplate: vi.fn(),
}));
vi.mock("@/server/overlays/instances", () => ({
  listActiveInstances: vi.fn(),
}));

import { getActiveForTemplate } from "@/server/broadcast/events";
import { listActiveInstances } from "@/server/overlays/instances";

const sb = {} as unknown as Parameters<typeof isOverlayActive>[0];

beforeEach(() => {
  vi.mocked(getActiveForTemplate).mockReset();
  vi.mocked(listActiveInstances).mockReset();
});

describe("isOverlayActive", () => {
  it("returns false when no row in overlay_events", async () => {
    vi.mocked(getActiveForTemplate).mockResolvedValue(null);
    const r = await isOverlayActive(sb, "s1", "01-brb");
    expect(r).toBe(false);
  });

  it("returns true when overlay_events row found", async () => {
    vi.mocked(getActiveForTemplate).mockResolvedValue({
      id: "evt1",
      stream_session_id: "s1",
      template_id: "tpl1",
      template_key: "layout_brb_basic",
      payload: {},
      triggered_at: "2026-04-25T00:00:00Z",
      cleared_at: null,
    });
    const r = await isOverlayActive(sb, "s1", "01-brb");
    expect(r).toBe(true);
  });

  it("returns true for multi-instance key when any slot active", async () => {
    vi.mocked(listActiveInstances).mockResolvedValue([
      {
        id: "i2",
        streamSessionId: "s1",
        templateKey: "lower_third",
        instanceSlot: 2,
        payload: {},
        triggeredAt: "2026-04-25T00:00:00Z",
        clearedAt: null,
        triggeredBy: null,
      },
    ]);
    const r = await isOverlayActive(sb, "s1", "08-lower-third");
    expect(r).toBe(true);
  });

  it("returns false for multi-instance key when no slots active", async () => {
    vi.mocked(listActiveInstances).mockResolvedValue([]);
    const r = await isOverlayActive(sb, "s1", "08-lower-third");
    expect(r).toBe(false);
  });
});

describe("isInstanceActive", () => {
  it("returns true when slot N is active", async () => {
    vi.mocked(listActiveInstances).mockResolvedValue([
      {
        id: "i2",
        streamSessionId: "s1",
        templateKey: "lower_third",
        instanceSlot: 2,
        payload: {},
        triggeredAt: "2026-04-25T00:00:00Z",
        clearedAt: null,
        triggeredBy: null,
      },
    ]);
    expect(await isInstanceActive(sb, "s1", "08-lower-third", 2)).toBe(true);
    expect(await isInstanceActive(sb, "s1", "08-lower-third", 1)).toBe(false);
  });

  it("falls back to single-instance probe for non-multi keys", async () => {
    vi.mocked(getActiveForTemplate).mockResolvedValue(null);
    const r = await isInstanceActive(sb, "s1", "01-brb", 1);
    expect(r).toBe(false);
  });
});

describe("probeAllActiveStates", () => {
  it("returns single map + multi map shape", async () => {
    vi.mocked(getActiveForTemplate).mockResolvedValue(null);
    vi.mocked(listActiveInstances).mockResolvedValue([
      {
        id: "i1",
        streamSessionId: "s1",
        templateKey: "lower_third",
        instanceSlot: 1,
        payload: {},
        triggeredAt: "2026-04-25T00:00:00Z",
        clearedAt: null,
        triggeredBy: null,
      },
      {
        id: "i3",
        streamSessionId: "s1",
        templateKey: "lower_third",
        instanceSlot: 3,
        payload: {},
        triggeredAt: "2026-04-25T00:00:00Z",
        clearedAt: null,
        triggeredBy: null,
      },
    ]);
    const r = await probeAllActiveStates(sb, "s1");
    // 18 keys probed (16 Plan 51 + 19-player-squads + 20-highlight)
    expect(Object.keys(r.single).length).toBe(18);
    // lower-third shows slot 1 + 3 active
    expect(r.multi["08-lower-third"]).toEqual([true, false, true]);
    // single mirror is true (any slot)
    expect(r.single["08-lower-third"]).toBe(true);
    // BRB stays false (mock returns null)
    expect(r.single["01-brb"]).toBe(false);
  });
});
