import { describe, expect, it } from "vitest";
import {
  PhotopeaOriginSchema,
  PhotopeaSaveCommandSchema,
  PsdBytesEnvelopeSchema,
  SavePsdInputSchema,
  PHOTOPEA_EMBED_ORIGIN,
  type PsdBytesEnvelope,
  type SavePsdInput,
} from "./photopea-bridge.types";

describe("photopea-bridge.types", () => {
  it("locks PHOTOPEA_EMBED_ORIGIN to the canonical Photopea origin", () => {
    expect(PHOTOPEA_EMBED_ORIGIN).toBe("https://www.photopea.com");
  });

  it("PhotopeaOriginSchema accepts only the canonical origin string", () => {
    expect(PhotopeaOriginSchema.safeParse("https://www.photopea.com").success).toBe(
      true,
    );
    expect(PhotopeaOriginSchema.safeParse("https://photopea.com").success).toBe(
      false,
    );
    expect(PhotopeaOriginSchema.safeParse("http://www.photopea.com").success).toBe(
      false,
    );
    expect(
      PhotopeaOriginSchema.safeParse("https://www.photopea.com.evil.example/").success,
    ).toBe(false);
    expect(PhotopeaOriginSchema.safeParse("null").success).toBe(false);
    expect(PhotopeaOriginSchema.safeParse("").success).toBe(false);
  });

  it("PhotopeaSaveCommandSchema serializes the canonical save command", () => {
    const parsed = PhotopeaSaveCommandSchema.parse({
      type: "app.activeDocument.saveToOE",
    });
    expect(parsed.type).toBe("app.activeDocument.saveToOE");
  });

  it("PsdBytesEnvelopeSchema parses a valid ArrayBuffer payload", () => {
    const env: PsdBytesEnvelope = {
      kind: "psd-bytes",
      byteLength: 1024,
      payload: new ArrayBuffer(1024),
    };
    const parsed = PsdBytesEnvelopeSchema.parse(env);
    expect(parsed.byteLength).toBe(1024);
    expect(parsed.payload).toBeInstanceOf(ArrayBuffer);
  });

  it("PsdBytesEnvelopeSchema rejects oversized payloads (>100MB)", () => {
    const HUNDRED_MB = 100 * 1024 * 1024;
    const env = {
      kind: "psd-bytes",
      byteLength: HUNDRED_MB + 1,
      payload: new ArrayBuffer(0),
    };
    expect(PsdBytesEnvelopeSchema.safeParse(env).success).toBe(false);
  });

  it("PsdBytesEnvelopeSchema rejects size mismatch between header and payload", () => {
    const env = {
      kind: "psd-bytes",
      byteLength: 1024,
      payload: new ArrayBuffer(512),
    };
    expect(PsdBytesEnvelopeSchema.safeParse(env).success).toBe(false);
  });

  it("SavePsdInputSchema requires a uuid assetId and a Uint8Array body", () => {
    const input: SavePsdInput = {
      assetId: "11111111-1111-4111-8111-111111111111",
      psdBytes: new Uint8Array([0x38, 0x42, 0x50, 0x53]), // '8BPS' PSD magic
      note: "via Photopea",
    };
    const parsed = SavePsdInputSchema.parse(input);
    expect(parsed.assetId).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.psdBytes).toBeInstanceOf(Uint8Array);
  });

  it("SavePsdInputSchema rejects bytes that do not start with the 8BPS magic", () => {
    const input = {
      assetId: "11111111-1111-4111-8111-111111111111",
      psdBytes: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
    };
    expect(SavePsdInputSchema.safeParse(input).success).toBe(false);
  });

  it("SavePsdInputSchema rejects malformed assetId", () => {
    const input = {
      assetId: "not-a-uuid",
      psdBytes: new Uint8Array([0x38, 0x42, 0x50, 0x53]),
    };
    expect(SavePsdInputSchema.safeParse(input).success).toBe(false);
  });
});
