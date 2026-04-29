import { describe, it, expect } from "vitest";
import {
  decodePreviewTokens,
  decodePreviewTextTokens,
  decodePreviewPartnerTokens,
  decodePreviewAnimTokens,
  encodePreviewTokens,
  escapeCssValue,
} from "./preview";

/**
 * Phase 3 — preview-token decoder tests.
 *
 * Covers the security envelope around the admin live-preview path: only
 * known token_keys are accepted, malformed input returns null silently,
 * CSS metacharacters are rejected. The SSR overlay route streams these
 * values directly into a `<style>` tag so any breakdown here would be a
 * cross-iframe injection vector.
 */

function b64encode(o: unknown): string {
  return Buffer.from(JSON.stringify(o), "utf-8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

describe("decodePreviewTokens — happy path", () => {
  it("decodes a valid base64-encoded JSON token map", async () => {
    const input = { "accent-color": "#fe036d", scale: "1.25" };
    const out = await decodePreviewTokens(b64encode(input));
    expect(out).toEqual(input);
  });

  it("accepts an empty object", async () => {
    const out = await decodePreviewTokens(b64encode({}));
    expect(out).toEqual({});
  });

  it("round-trips via encodePreviewTokens", async () => {
    const input = { "bg-color": "#050505", "font-display": "Agharti" };
    const enc = encodePreviewTokens(input);
    const out = await decodePreviewTokens(enc);
    expect(out).toEqual(input);
  });
});

describe("decodePreviewTokens — null / invalid", () => {
  it("returns null when raw is undefined", async () => {
    expect(await decodePreviewTokens(undefined)).toBeNull();
  });

  it("returns null when raw is empty string", async () => {
    expect(await decodePreviewTokens("")).toBeNull();
  });

  it("returns null when raw is not valid base64-decodable JSON", async () => {
    expect(await decodePreviewTokens("not_b64@%!")).toBeNull();
  });

  it("returns null when JSON is malformed", async () => {
    const bad = Buffer.from("{not-json", "utf-8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(await decodePreviewTokens(bad)).toBeNull();
  });

  it("returns null when value is not a string", async () => {
    expect(
      await decodePreviewTokens(b64encode({ "accent-color": 42 })),
    ).toBeNull();
  });

  it("returns null when token_key is unknown", async () => {
    expect(
      await decodePreviewTokens(
        b64encode({ "evil-key": "#fff", "accent-color": "#fff" }),
      ),
    ).toBeNull();
  });

  it("returns null when value contains a forbidden CSS metacharacter", async () => {
    expect(
      await decodePreviewTokens(
        b64encode({ "accent-color": "red; }/*hack" }),
      ),
    ).toBeNull();
  });

  it("returns null when value exceeds 200 chars", async () => {
    const long = "x".repeat(201);
    expect(
      await decodePreviewTokens(b64encode({ "accent-color": long })),
    ).toBeNull();
  });

  it("returns null when too many keys are passed (>32)", async () => {
    // Build an oversized map of allowed token keys by repeating one.
    // Unknown keys would short-circuit; we use the same key 33 times via
    // numeric suffix to hit the size guard ahead of the unknown-key one.
    const obj: Record<string, string> = {};
    for (let i = 0; i < 33; i++) obj[`unknown-${i}`] = "#000000";
    expect(await decodePreviewTokens(b64encode(obj))).toBeNull();
  });
});

describe("escapeCssValue", () => {
  it("strips CSS metacharacters", () => {
    expect(escapeCssValue("red; }/*hack")).toBe("red /*hack");
  });

  it("leaves clean values untouched", () => {
    expect(escapeCssValue("#6bcd06")).toBe("#6bcd06");
    expect(escapeCssValue("Agharti")).toBe("Agharti");
  });
});

/* Wave 2 Stage 2 — text-token decoder tests. */
describe("decodePreviewTextTokens (Wave 2 Stage 2)", () => {
  it("returns null for missing param", async () => {
    expect(await decodePreviewTextTokens(undefined)).toBeNull();
    expect(await decodePreviewTextTokens(null)).toBeNull();
    expect(await decodePreviewTextTokens("")).toBeNull();
  });

  it("returns null for malformed base64", async () => {
    expect(await decodePreviewTextTokens("not-valid-base64-!!!")).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    const b64 = Buffer.from("{not json", "utf-8").toString("base64");
    expect(await decodePreviewTextTokens(b64)).toBeNull();
  });

  it("decodes a valid single-element override", async () => {
    const payload = {
      title: {
        visible: true,
        content: "GAME ON",
        styles: {
          color: "#fe036d",
          fontFamily: "Agharti",
          fontSize: "120px",
          fontWeight: 900,
        },
      },
    };
    const b64 = b64encode(payload);
    const decoded = await decodePreviewTextTokens(b64);
    expect(decoded).not.toBeNull();
    expect(decoded?.title.content).toBe("GAME ON");
    expect(decoded?.title.styles?.color).toBe("#fe036d");
    expect(decoded?.title.styles?.fontWeight).toBe(900);
  });

  it("rejects non-kebab-case element IDs", async () => {
    const payload = {
      Bad_Id_With_Caps: {
        content: "x",
      },
    };
    const b64 = b64encode(payload);
    expect(await decodePreviewTextTokens(b64)).toBeNull();
  });

  it("rejects content with HTML metacharacters", async () => {
    const payload = {
      title: {
        content: "<script>alert(1)</script>",
      },
    };
    const b64 = b64encode(payload);
    expect(await decodePreviewTextTokens(b64)).toBeNull();
  });

  it("rejects color values with CSS metacharacters", async () => {
    const payload = {
      title: {
        styles: {
          color: "red; }/*hack",
        },
      },
    };
    const b64 = b64encode(payload);
    expect(await decodePreviewTextTokens(b64)).toBeNull();
  });

  it("rejects font outside the brand allowlist", async () => {
    const payload = {
      title: {
        styles: {
          fontFamily: "ComicSans",
        },
      },
    };
    const b64 = b64encode(payload);
    expect(await decodePreviewTextTokens(b64)).toBeNull();
  });

  it("rejects fontWeight outside 100..900 range", async () => {
    const payload = {
      title: {
        styles: {
          fontWeight: 1500,
        },
      },
    };
    const b64 = b64encode(payload);
    expect(await decodePreviewTextTokens(b64)).toBeNull();
  });

  it("accepts an empty map", async () => {
    const b64 = b64encode({});
    const decoded = await decodePreviewTextTokens(b64);
    expect(decoded).toEqual({});
  });

  it("rejects oversize maps (>64 elements)", async () => {
    const payload: Record<string, { content: string }> = {};
    for (let i = 0; i < 65; i++) {
      payload[`element-${i}`] = { content: `x` };
    }
    const b64 = b64encode(payload);
    expect(await decodePreviewTextTokens(b64)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 3 — partner token decoder                             *
 * ------------------------------------------------------------------ */

describe("decodePreviewPartnerTokens", () => {
  const validLayout = {
    visible: true,
    positionXPx: 0,
    positionYPx: 1020,
    anchor: "bottom-center",
    orientation: "horizontal",
    scalePct: 100,
    itemSpacingPx: 64,
    justification: "center",
    zIndex: 12,
  };
  const validLogo = {
    partnerKey: "gameevo",
    label: "GameEvo Esports",
    alt: "GameEvo Esports",
    fileUrl: "/overlays/v2/_assets/logos/processed/gameevo.png",
    visible: true,
    sort: 0,
  };

  it("returns null when raw is undefined", async () => {
    expect(await decodePreviewPartnerTokens(undefined)).toBeNull();
  });

  it("decodes a valid layout-only payload", async () => {
    const b64 = b64encode({ layout: validLayout });
    const out = await decodePreviewPartnerTokens(b64);
    expect(out).toEqual({ layout: validLayout });
  });

  it("decodes a valid logos-only payload", async () => {
    const b64 = b64encode({ logos: [validLogo] });
    const out = await decodePreviewPartnerTokens(b64);
    expect(out).toEqual({ logos: [validLogo] });
  });

  it("decodes a combined layout + logos payload", async () => {
    const payload = { layout: validLayout, logos: [validLogo] };
    const b64 = b64encode(payload);
    const out = await decodePreviewPartnerTokens(b64);
    expect(out).toEqual(payload);
  });

  it("rejects unknown anchor values", async () => {
    const b64 = b64encode({
      layout: { ...validLayout, anchor: "way-off" },
    });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects scalePct out of range", async () => {
    const b64 = b64encode({ layout: { ...validLayout, scalePct: 999 } });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects negative item spacing", async () => {
    const b64 = b64encode({
      layout: { ...validLayout, itemSpacingPx: -10 },
    });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects logos with non-kebab-case partnerKey", async () => {
    const b64 = b64encode({
      logos: [{ ...validLogo, partnerKey: "Bad Key With Spaces" }],
    });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects logos with CSS metacharacters in fileUrl", async () => {
    const b64 = b64encode({
      logos: [{ ...validLogo, fileUrl: "/x.png; }/*hack" }],
    });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects logos with HTML metacharacters in label", async () => {
    const b64 = b64encode({
      logos: [{ ...validLogo, label: "<script>alert(1)</script>" }],
    });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects logos with javascript: URL", async () => {
    const b64 = b64encode({
      logos: [{ ...validLogo, fileUrl: "javascript:alert(1)" }],
    });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects oversized logo arrays (>32)", async () => {
    const logos = Array.from({ length: 33 }, (_, i) => ({
      ...validLogo,
      partnerKey: `partner-${i}`,
    }));
    const b64 = b64encode({ logos });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("rejects unknown top-level keys (strict)", async () => {
    const b64 = b64encode({
      layout: validLayout,
      hostile: { foo: "bar" },
    });
    expect(await decodePreviewPartnerTokens(b64)).toBeNull();
  });

  it("returns null on malformed base64", async () => {
    expect(await decodePreviewPartnerTokens("not!!!base64???")).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const fake = Buffer.from("not-json-at-all", "utf-8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(await decodePreviewPartnerTokens(fake)).toBeNull();
  });

  it("accepts an empty object (no layout, no logos)", async () => {
    const b64 = b64encode({});
    const out = await decodePreviewPartnerTokens(b64);
    expect(out).toEqual({});
  });

  it("decodes both http(s) URLs and root-relative URLs", async () => {
    const httpsLogo = {
      ...validLogo,
      partnerKey: "external",
      fileUrl: "https://cdn.example.com/x.png",
    };
    const b64 = b64encode({ logos: [validLogo, httpsLogo] });
    const out = await decodePreviewPartnerTokens(b64);
    expect(out?.logos).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 4 — animation preview decoder                         *
 * ------------------------------------------------------------------ */

describe("decodePreviewAnimTokens", () => {
  const validEntryPhase = {
    enabled: true,
    animType: "slide-left",
    durationMs: 420,
    delayMs: 60,
    easing: "cubic-bezier(0.16,1,0.3,1)",
    iterationCount: "1",
  };

  it("returns null when raw is undefined / empty", async () => {
    expect(await decodePreviewAnimTokens(undefined)).toBeNull();
    expect(await decodePreviewAnimTokens(null)).toBeNull();
    expect(await decodePreviewAnimTokens("")).toBeNull();
  });

  it("returns null on malformed base64", async () => {
    expect(await decodePreviewAnimTokens("not!base64!")).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const fake = Buffer.from("{not json", "utf-8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(await decodePreviewAnimTokens(fake)).toBeNull();
  });

  it("decodes a valid single-element entry phase", async () => {
    const payload = {
      title: { entry: validEntryPhase },
    };
    const b64 = b64encode(payload);
    const out = await decodePreviewAnimTokens(b64);
    expect(out).not.toBeNull();
    expect(out?.title?.entry?.animType).toBe("slide-left");
    expect(out?.title?.entry?.durationMs).toBe(420);
  });

  it("decodes multi-phase entries (entry + continuous + exit)", async () => {
    const payload = {
      title: {
        entry: validEntryPhase,
        exit: { ...validEntryPhase, animType: "fade", easing: "ease-in" },
        continuous: {
          ...validEntryPhase,
          animType: "pulse",
          iterationCount: "infinite",
          easing: "ease-in-out",
        },
      },
    };
    const b64 = b64encode(payload);
    const out = await decodePreviewAnimTokens(b64);
    expect(out?.title?.entry).toBeDefined();
    expect(out?.title?.exit?.animType).toBe("fade");
    expect(out?.title?.continuous?.iterationCount).toBe("infinite");
  });

  it("rejects non-kebab-case element ID", async () => {
    const payload = { Bad_Title: { entry: validEntryPhase } };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("rejects unknown anim_type", async () => {
    const payload = {
      title: { entry: { ...validEntryPhase, animType: "explode" } },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("rejects durationMs outside 50..5000", async () => {
    const payload = {
      title: { entry: { ...validEntryPhase, durationMs: 99999 } },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("rejects easing outside the allowlist", async () => {
    const payload = {
      title: { entry: { ...validEntryPhase, easing: "magic-curve" } },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("accepts cubic-bezier easings", async () => {
    const payload = {
      title: {
        entry: { ...validEntryPhase, easing: "cubic-bezier(0,0,1,1)" },
      },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).not.toBeNull();
  });

  it("rejects iterationCount outside 'infinite' or digits", async () => {
    const payload = {
      title: { entry: { ...validEntryPhase, iterationCount: "many" } },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("rejects custom-css with url()", async () => {
    const payload = {
      title: {
        entry: {
          ...validEntryPhase,
          animType: "custom-css",
          customCssKeyframes: "0% { background: url(http://x.com/a.png) }",
        },
      },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("rejects custom-css with @-rules", async () => {
    const payload = {
      title: {
        entry: {
          ...validEntryPhase,
          animType: "custom-css",
          customCssKeyframes: "0% { opacity: 0 } @import url(x);",
        },
      },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("rejects custom-css with angle brackets", async () => {
    const payload = {
      title: {
        entry: {
          ...validEntryPhase,
          animType: "custom-css",
          customCssKeyframes: "0% { color: <script>alert(1)</script> }",
        },
      },
    };
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("accepts safe custom-css keyframes", async () => {
    const payload = {
      title: {
        entry: {
          ...validEntryPhase,
          animType: "custom-css",
          customCssKeyframes:
            "0% { opacity: 0 } 50% { opacity: 0.5 } 100% { opacity: 1 }",
        },
      },
    };
    const out = await decodePreviewAnimTokens(b64encode(payload));
    expect(out?.title?.entry?.customCssKeyframes).toContain("opacity");
  });

  it("rejects oversized maps (>64 elements)", async () => {
    const payload: Record<string, { entry: typeof validEntryPhase }> = {};
    for (let i = 0; i < 65; i++) {
      payload[`element-${i}`] = { entry: validEntryPhase };
    }
    expect(await decodePreviewAnimTokens(b64encode(payload))).toBeNull();
  });

  it("accepts an empty object", async () => {
    const b64 = b64encode({});
    expect(await decodePreviewAnimTokens(b64)).toEqual({});
  });
});
