import { describe, it, expect } from "vitest";
import {
  V2_OVERLAY_KEYS,
  V2_MULTI_INSTANCE_KEYS,
  V2_OVERLAY_LABELS,
  isV2MultiInstanceKey,
  v2OverlayUrl,
} from "./overlay-keys";

describe("V2_OVERLAY_KEYS", () => {
  it("exposes 17 keys (16 from Plan 51 + 19-player-squads added 2026-04-30)", () => {
    expect(V2_OVERLAY_KEYS.length).toBe(17);
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
  it("includes session + token + preview + active=0 default when preview=true", () => {
    // Preview iframes carry `active=0` by default so the injector knows
    // not to seed the iframe with stream data when the overlay is OFF.
    const url = v2OverlayUrl("01-brb", "S-1", "TOK", true);
    expect(url).toBe(
      "/overlay/v2/01-brb?session=S-1&token=TOK&preview=1&active=0",
    );
  });

  it("preview URL with active=true sends active=1", () => {
    const url = v2OverlayUrl("15-orgs", "S-9", "TOK", true, true);
    expect(url).toBe(
      "/overlay/v2/15-orgs?session=S-9&token=TOK&preview=1&active=1",
    );
  });

  it("omits token when null in preview mode", () => {
    const url = v2OverlayUrl("02-timer", "S-2", null, true);
    expect(url).toBe("/overlay/v2/02-timer?session=S-2&preview=1&active=0");
  });

  // Ambient (2026-04-26): live URLs are stable + carry no session/token.
  it("emits stable URL with NO session/token when preview=false (ambient OBS URL)", () => {
    const url = v2OverlayUrl("07-leaderboard", "S-3", "TOK", false);
    expect(url).toBe("/overlay/v2/07-leaderboard");
  });

  it("active arg is ignored when preview=false (live URLs)", () => {
    const url = v2OverlayUrl("07-leaderboard", "S-3", "TOK", false, true);
    expect(url).toBe("/overlay/v2/07-leaderboard");
  });

  it("preserves slot on live URLs (each lower-third anchor needs its own browser source)", () => {
    const url = v2OverlayUrl("08-lower-third", "S-4", "TOK", false, false, 2);
    expect(url).toBe("/overlay/v2/08-lower-third?slot=2");
  });

  it("preserves slot on preview URLs alongside session/preview/active", () => {
    const url = v2OverlayUrl("08-lower-third", "S-4", "TOK", true, false, 1);
    expect(url).toBe(
      "/overlay/v2/08-lower-third?session=S-4&token=TOK&preview=1&active=0&slot=1",
    );
  });
});
