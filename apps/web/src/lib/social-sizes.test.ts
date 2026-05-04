import { describe, expect, it } from "vitest";

import {
  SIZE_PRESETS,
  getSizePreset,
  isValidSize,
  parseSize,
  type SocialSize,
} from "./social-sizes";

describe("SIZE_PRESETS", () => {
  it("ships exactly the 3 Phase 1 sizes (no scope creep)", () => {
    const keys = Object.keys(SIZE_PRESETS).sort();
    expect(keys).toEqual(["1080x1080", "1080x1920", "1200x675"]);
  });

  it("each preset has positive integer width + height + non-empty label/aspect", () => {
    for (const [key, preset] of Object.entries(SIZE_PRESETS)) {
      expect(preset.width, `${key}.width`).toBeGreaterThan(0);
      expect(preset.height, `${key}.height`).toBeGreaterThan(0);
      expect(Number.isInteger(preset.width), `${key}.width int`).toBe(true);
      expect(Number.isInteger(preset.height), `${key}.height int`).toBe(true);
      expect(preset.label.length, `${key}.label`).toBeGreaterThan(0);
      expect(preset.aspect, `${key}.aspect`).toMatch(/^\d+:\d+$/);
    }
  });

  it("the dimension key matches the preset width/height", () => {
    for (const [key, preset] of Object.entries(SIZE_PRESETS)) {
      expect(`${preset.width}x${preset.height}`).toBe(key);
    }
  });
});

describe("isValidSize", () => {
  it("returns true for every key of SIZE_PRESETS", () => {
    for (const key of Object.keys(SIZE_PRESETS)) {
      expect(isValidSize(key), key).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isValidSize("1080x1350")).toBe(false);
    expect(isValidSize("")).toBe(false);
    expect(isValidSize("not-a-size")).toBe(false);
    expect(isValidSize("1920x1080")).toBe(false); // landscape variant not in Phase 1
  });

  it("returns false for case-mismatched input (strict comparison)", () => {
    expect(isValidSize("1080X1920")).toBe(false);
  });

  it("narrows the type when used as a guard", () => {
    const candidate: string = "1080x1080";
    if (isValidSize(candidate)) {
      // type-narrowing assertion: this assignment compiles under strict mode
      const narrowed: SocialSize = candidate;
      expect(narrowed).toBe("1080x1080");
    } else {
      throw new Error("expected guard to pass for known key");
    }
  });
});

describe("parseSize", () => {
  it("returns the same string for valid inputs", () => {
    expect(parseSize("1080x1920")).toBe("1080x1920");
    expect(parseSize("1080x1080")).toBe("1080x1080");
    expect(parseSize("1200x675")).toBe("1200x675");
  });

  it("throws a descriptive error for unknown sizes", () => {
    expect(() => parseSize("9999x9999")).toThrowError(
      /Unknown social size "9999x9999"/,
    );
  });

  it("error message lists every valid preset key", () => {
    let caught: unknown;
    try {
      parseSize("garbage");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    for (const key of Object.keys(SIZE_PRESETS)) {
      expect(msg, `error message must mention ${key}`).toContain(key);
    }
  });

  it("throws on empty string", () => {
    expect(() => parseSize("")).toThrowError(/Unknown social size/);
  });
});

describe("getSizePreset", () => {
  it("returns the matching preset record", () => {
    const preset = getSizePreset("1080x1920");
    expect(preset.width).toBe(1080);
    expect(preset.height).toBe(1920);
    expect(preset.aspect).toBe("9:16");
  });
});
