import { describe, it, expect } from "vitest";
import {
  V2_OVERLAY_KEYS,
  V2_MULTI_INSTANCE_KEYS,
  V2_OVERLAY_LABELS,
  isV2MultiInstanceKey,
  v2OverlayUrl,
} from "./overlay-keys";

describe("V2_OVERLAY_KEYS", () => {
  it("exposes 16 keys (per Plan 51 §8.2 — animated-bg + partners-strip excluded)", () => {
    expect(V2_OVERLAY_KEYS.length).toBe(16);
  });

  it("every key has a human label", () => {
    for (const k of V2_OVERLAY_KEYS) {
      expect(V2_OVERLAY_LABELS[k]).toBeTruthy();
    }
  });

  it("only `08-lower-third` is multi-instance", () => {
    expect([...V2_MULTI_INSTANCE_KEYS]).toEqual(["08-lower-third"]);
  });
});

describe("isV2MultiInstanceKey()", () => {
  it("returns true for 08-lower-third", () => {
    expect(isV2MultiInstanceKey("08-lower-third")).toBe(true);
  });

  it("returns false for everything else", () => {
    for (const k of V2_OVERLAY_KEYS) {
      if (k === "08-lower-third") continue;
      expect(isV2MultiInstanceKey(k)).toBe(false);
    }
  });

  it("returns false for unknown keys", () => {
    expect(isV2MultiInstanceKey("not-a-key")).toBe(false);
  });
});

describe("v2OverlayUrl()", () => {
  it("includes session + token + preview when supplied", () => {
    const url = v2OverlayUrl("01-brb", "S-1", "TOK", true);
    expect(url).toBe("/overlay/v2/01-brb?session=S-1&token=TOK&preview=1");
  });

  it("omits token when null", () => {
    const url = v2OverlayUrl("02-timer", "S-2", null);
    expect(url).toBe("/overlay/v2/02-timer?session=S-2");
  });

  it("omits preview when false", () => {
    const url = v2OverlayUrl("07-leaderboard", "S-3", "TOK", false);
    expect(url).toBe("/overlay/v2/07-leaderboard?session=S-3&token=TOK");
  });
});
