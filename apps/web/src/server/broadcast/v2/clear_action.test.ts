import { describe, it, expect } from "vitest";
import {
  buildClearOverlayFormData,
  buildClearInstanceFormData,
  buildClearScoreBugFormData,
  resolveClearAction,
} from "./clear_action";

describe("buildClearOverlayFormData()", () => {
  it("produces FormData with sessionId + eventId", () => {
    const fd = buildClearOverlayFormData({
      sessionId: "s-1",
      eventId: "ev-9",
    });
    expect(fd.get("sessionId")).toBe("s-1");
    expect(fd.get("eventId")).toBe("ev-9");
  });

  it("rejects missing sessionId", () => {
    expect(() =>
      buildClearOverlayFormData({ sessionId: "", eventId: "ev-1" }),
    ).toThrow(/sessionId is required/);
  });

  it("rejects missing eventId", () => {
    expect(() =>
      buildClearOverlayFormData({ sessionId: "s-1", eventId: "" }),
    ).toThrow(/eventId is required/);
  });
});

describe("buildClearInstanceFormData()", () => {
  it("produces FormData with sessionId + instanceId", () => {
    const fd = buildClearInstanceFormData({
      sessionId: "s-1",
      instanceId: "i-9",
    });
    expect(fd.get("sessionId")).toBe("s-1");
    expect(fd.get("instanceId")).toBe("i-9");
  });

  it("rejects missing instanceId", () => {
    expect(() =>
      buildClearInstanceFormData({ sessionId: "s-1", instanceId: "" }),
    ).toThrow(/instanceId is required/);
  });
});

describe("buildClearScoreBugFormData()", () => {
  it("produces FormData with sessionId + slot", () => {
    const fd = buildClearScoreBugFormData({
      sessionId: "s-1",
      slot: "primary",
    });
    expect(fd.get("sessionId")).toBe("s-1");
    expect(fd.get("slot")).toBe("primary");
  });

  it("rejects an invalid slot", () => {
    expect(() =>
      buildClearScoreBugFormData({
        sessionId: "s-1",
        // @ts-expect-error — purposely bad slot
        slot: "tertiary",
      }),
    ).toThrow(/slot must be 'primary' or 'secondary'/);
  });

  it("accepts secondary slot", () => {
    const fd = buildClearScoreBugFormData({
      sessionId: "s-1",
      slot: "secondary",
    });
    expect(fd.get("slot")).toBe("secondary");
  });
});

describe("resolveClearAction()", () => {
  it("routes score_bug to score_bug category", () => {
    const r = resolveClearAction({
      templateKey: "score_bug",
      sessionId: "s-1",
      slot: "primary",
    });
    expect(r.category).toBe("score_bug");
    expect(r.canFire).toBe(true);
    expect(r.formData.get("slot")).toBe("primary");
  });

  it("routes lower_third to instance category", () => {
    const r = resolveClearAction({
      templateKey: "lower_third",
      sessionId: "s-1",
      instanceId: "i-1",
    });
    expect(r.category).toBe("instance");
    expect(r.canFire).toBe(true);
    expect(r.formData.get("instanceId")).toBe("i-1");
  });

  it("routes other templates to single_event category", () => {
    const r = resolveClearAction({
      templateKey: "stinger_intro",
      sessionId: "s-1",
      latestEventId: "ev-1",
    });
    expect(r.category).toBe("single_event");
    expect(r.canFire).toBe(true);
    expect(r.formData.get("eventId")).toBe("ev-1");
  });

  it("instance category cannot fire when instanceId missing", () => {
    const r = resolveClearAction({
      templateKey: "lower_third",
      sessionId: "s-1",
    });
    expect(r.canFire).toBe(false);
    // FormData still produced (with empty instanceId) — disabled flag
    // governs submission.
    expect(r.formData.get("instanceId")).toBe("");
  });

  it("single_event cannot fire when eventId missing", () => {
    const r = resolveClearAction({
      templateKey: "layout_timer",
      sessionId: "s-1",
    });
    expect(r.canFire).toBe(false);
    expect(r.formData.get("eventId")).toBe("");
  });

  it("forced disable wins regardless of input availability", () => {
    const r = resolveClearAction({
      templateKey: "stinger_intro",
      sessionId: "s-1",
      latestEventId: "ev-1",
      disabled: true,
    });
    expect(r.canFire).toBe(false);
  });

  it("default slot for score_bug is 'primary'", () => {
    const r = resolveClearAction({
      templateKey: "score_bug",
      sessionId: "s-1",
    });
    expect(r.formData.get("slot")).toBe("primary");
  });

  it("up_next_bug is NOT instance (Plan 48.4 regression guard)", () => {
    const r = resolveClearAction({
      templateKey: "up_next_bug",
      sessionId: "s-1",
      latestEventId: "ev-7",
    });
    expect(r.category).toBe("single_event");
    expect(r.canFire).toBe(true);
  });

  it("layout_timer is NOT instance (Plan 48.4 regression guard)", () => {
    const r = resolveClearAction({
      templateKey: "layout_timer",
      sessionId: "s-1",
      latestEventId: "ev-7",
    });
    expect(r.category).toBe("single_event");
    expect(r.canFire).toBe(true);
  });
});
