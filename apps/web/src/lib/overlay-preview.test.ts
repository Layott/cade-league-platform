import { describe, it, expect } from "vitest";
import { encodePayloadForPreview } from "./overlay-preview";

describe("encodePayloadForPreview", () => {
  it("round-trips a simple object via base64-url JSON", () => {
    const encoded = encodePayloadForPreview({ hello: "world", n: 1 });
    expect(encoded).toBeTypeOf("string");
    expect(encoded.length).toBeGreaterThan(0);
    // base64-url omits `+`, `/`, `=`
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("handles unicode strings", () => {
    const encoded = encodePayloadForPreview({ name: "Dapọ̀ Ade" });
    expect(encoded.length).toBeGreaterThan(0);
  });

  it("returns empty string for unserialisable input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(encodePayloadForPreview(circular)).toBe("");
  });
});
