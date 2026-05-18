import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parsePsd, MAX_PSD_BYTES, SOFT_WARN_PSD_BYTES } from "./psd-parser";

const FIXTURE = path.join(__dirname, "__fixtures__", "tiny.psd");

describe("parsePsd", () => {
  it("constants are 100 MB / 50 MB", () => {
    expect(MAX_PSD_BYTES).toBe(100 * 1024 * 1024);
    expect(SOFT_WARN_PSD_BYTES).toBe(50 * 1024 * 1024);
  });

  it("extracts every layer from a 2-layer fixture PSD", async () => {
    const buffer = await readFile(FIXTURE);
    const result = await parsePsd(buffer);
    expect(result.flatPng).toBeInstanceOf(Buffer);
    expect(result.flatPng.byteLength).toBeGreaterThan(0);
    expect(result.flatPng.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(result.layers.length).toBeGreaterThanOrEqual(2);
    for (const layer of result.layers) {
      expect(typeof layer.name).toBe("string");
      expect(layer.bounds).toEqual(
        expect.objectContaining({
          left: expect.any(Number),
          top: expect.any(Number),
          right: expect.any(Number),
          bottom: expect.any(Number),
        }),
      );
      expect(layer.png).toBeInstanceOf(Buffer);
      expect(layer.png.byteLength).toBeGreaterThan(0);
      expect(layer.png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("returns canvas dimensions", async () => {
    const buffer = await readFile(FIXTURE);
    const result = await parsePsd(buffer);
    expect(result.canvasWidth).toBeGreaterThan(0);
    expect(result.canvasHeight).toBeGreaterThan(0);
  });

  it("rejects buffers above MAX_PSD_BYTES", async () => {
    const huge = Buffer.alloc(MAX_PSD_BYTES + 1, 0);
    await expect(parsePsd(huge)).rejects.toThrow(/exceeds 100/i);
  });

  it("rejects empty / non-PSD buffers gracefully", async () => {
    await expect(parsePsd(Buffer.alloc(0))).rejects.toThrow();
    await expect(parsePsd(Buffer.from("not a psd"))).rejects.toThrow();
  });

  it("OOM / unexpected parser exceptions wrap into PsdParseError with friendly message", async () => {
    // Buffer must be >=26 bytes and start with '8BPS' magic to pass pre-checks,
    // but contain garbage content so ag-psd raises during parsing.
    const garbage = Buffer.alloc(64);
    garbage.write("8BPS", 0, "ascii");    // magic
    garbage.writeUInt16BE(1, 4);          // version = 1 (PSD)
    // rest is zeroes — ag-psd will fail on malformed section lengths
    await expect(parsePsd(garbage)).rejects.toMatchObject({
      name: "PsdParseError",
      message: expect.stringMatching(/could not parse/i),
    });
  });
});
