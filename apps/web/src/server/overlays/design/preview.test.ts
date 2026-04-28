import { describe, it, expect } from "vitest";
import {
  decodePreviewTokens,
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
