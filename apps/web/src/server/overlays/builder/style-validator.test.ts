import { describe, expect, it } from "vitest";
import { validateStyle } from "./style-validator";

describe("style-validator — happy paths", () => {
  it("accepts a complete text style", () => {
    const result = validateStyle("text", {
      fontFamily: "Agharti",
      fontSize: 64,
      fontWeight: 700,
      color: "#ffffff",
      textAlign: "center",
      letterSpacing: 0,
      lineHeight: 1.1,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a rect with fill + stroke + corner radius", () => {
    const result = validateStyle("rect", {
      fill: "#6bcd06",
      stroke: "#050505",
      strokeWidth: 2,
      cornerRadius: 8,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an image with assetId + cover fit", () => {
    const result = validateStyle("image", {
      imageAssetId: "asset-uuid-1234",
      imageFit: "cover",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts data-slot identical shape to text", () => {
    const result = validateStyle("data-slot", {
      fontFamily: "Quedora",
      fontSize: 32,
      color: "#fe036d",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a text with shadow sub-spec", () => {
    const result = validateStyle("text", {
      fontFamily: "Agharti",
      fontSize: 48,
      color: "#ffffff",
      shadow: {
        offsetX: 4,
        offsetY: 4,
        blur: 12,
        color: "#000000",
        opacity: 0.5,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a rect with NO style fields (empty object)", () => {
    const result = validateStyle("rect", {});
    expect(result.ok).toBe(true);
  });
});

describe("style-validator — rejection paths", () => {
  it("rejects expression(...) in any string value", () => {
    const result = validateStyle("text", {
      fontFamily: "Agharti",
      fontSize: 64,
      color: "expression(alert(1))",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/expression/i);
    }
  });

  it("rejects external url(...) in fill", () => {
    const result = validateStyle("rect", {
      fill: "url(http://evil.example.com/exfil.png)",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects @import in any string", () => {
    const result = validateStyle("text", {
      fontFamily: "@import url(http://bad)",
      fontSize: 64,
      color: "#fff",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects behavior: in any string", () => {
    const result = validateStyle("rect", {
      stroke: "behavior:url(#xss)",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects javascript: in any string (case-insensitive)", () => {
    const result = validateStyle("image", {
      imageAssetId: "JavaScript:alert(1)",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects text without required fontFamily", () => {
    const result = validateStyle("text", {
      fontSize: 64,
      color: "#fff",
    });
    expect(result.ok).toBe(false);
  });
});

describe("style-validator — edge cases", () => {
  it("accepts an all-undefined-fields object (treated as empty)", () => {
    const result = validateStyle("rect", {
      fill: undefined,
      stroke: undefined,
      strokeWidth: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts very large shadow offsets (no positional bounds)", () => {
    const result = validateStyle("text", {
      fontFamily: "Agharti",
      fontSize: 64,
      color: "#fff",
      shadow: {
        offsetX: 99999,
        offsetY: 99999,
        blur: 99999,
        color: "#000",
        opacity: 1,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a long but valid font name", () => {
    const result = validateStyle("text", {
      fontFamily: "Agharti".repeat(20),
      fontSize: 64,
      color: "#fff",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects fontFamily containing < or > chars", () => {
    const result = validateStyle("text", {
      fontFamily: "Agharti<script>",
      fontSize: 64,
      color: "#fff",
    });
    expect(result.ok).toBe(false);
  });
});
