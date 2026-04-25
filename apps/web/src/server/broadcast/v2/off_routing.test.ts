import { describe, it, expect } from "vitest";
import {
  offActionCategory,
  isMultiInstance,
  offButtonCanFire,
  MULTI_INSTANCE_KEYS,
} from "./off_routing";

describe("offActionCategory()", () => {
  it("routes 'score_bug' to the score_bug action", () => {
    expect(offActionCategory("score_bug")).toBe("score_bug");
  });

  it("routes 'lower_third' to instance action", () => {
    expect(offActionCategory("lower_third")).toBe("instance");
  });

  it("routes everything else to single_event", () => {
    for (const k of [
      "stinger_intro",
      "layout_4pip",
      "h2h_2",
      "leaderboard_animated",
      "up_next_bug",
      "layout_timer",
      "starting_soon_basic",
      "top_scorers",
      "featured_comment",
    ]) {
      expect(offActionCategory(k)).toBe("single_event");
    }
  });

  it("up_next_bug + layout_timer are NOT multi-instance (Plan 48.4 regression guard)", () => {
    expect(isMultiInstance("up_next_bug")).toBe(false);
    expect(isMultiInstance("layout_timer")).toBe(false);
  });

  it("MULTI_INSTANCE_KEYS contains exactly 'lower_third'", () => {
    expect(MULTI_INSTANCE_KEYS.size).toBe(1);
    expect(MULTI_INSTANCE_KEYS.has("lower_third")).toBe(true);
  });
});

describe("offButtonCanFire()", () => {
  it("score_bug always can fire (slot is implicit)", () => {
    expect(
      offButtonCanFire({
        category: "score_bug",
      }),
    ).toBe(true);
  });

  it("score_bug forced disable -> cannot fire", () => {
    expect(
      offButtonCanFire({
        category: "score_bug",
        disabled: true,
      }),
    ).toBe(false);
  });

  it("instance category requires instanceId", () => {
    expect(
      offButtonCanFire({
        category: "instance",
        instanceId: null,
      }),
    ).toBe(false);
    expect(
      offButtonCanFire({
        category: "instance",
        instanceId: "i-1",
      }),
    ).toBe(true);
  });

  it("instance with empty string is treated as missing", () => {
    expect(
      offButtonCanFire({
        category: "instance",
        instanceId: "",
      }),
    ).toBe(false);
  });

  it("single_event category requires latestEventId", () => {
    expect(
      offButtonCanFire({
        category: "single_event",
        latestEventId: null,
      }),
    ).toBe(false);
    expect(
      offButtonCanFire({
        category: "single_event",
        latestEventId: "ev-1",
      }),
    ).toBe(true);
  });

  it("forced disable always wins", () => {
    expect(
      offButtonCanFire({
        category: "single_event",
        latestEventId: "ev-1",
        disabled: true,
      }),
    ).toBe(false);
  });

  it("ignores instanceId on single_event category", () => {
    expect(
      offButtonCanFire({
        category: "single_event",
        instanceId: "i-1",
      }),
    ).toBe(false);
  });

  it("ignores latestEventId on instance category", () => {
    expect(
      offButtonCanFire({
        category: "instance",
        latestEventId: "ev-1",
      }),
    ).toBe(false);
  });
});
