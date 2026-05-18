import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TINY_PSD = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "server",
  "overlays",
  "builder",
  "__fixtures__",
  "tiny.psd",
);

// vi.hoisted so mocks are available when vi.mock factory runs (hoisted to top).
const { gateMock, uploadPsdMock } = vi.hoisted(() => ({
  gateMock: vi.fn(),
  uploadPsdMock: vi.fn(),
}));

vi.mock("./assets-actions-gate", () => ({
  gate: gateMock,
}));
vi.mock("@/server/overlays/builder/assets", () => ({
  uploadPsd: (...args: unknown[]) => uploadPsdMock(...args),
  PsdUploadError: class PsdUploadError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "PsdUploadError";
    }
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { uploadPsdAction } from "./assets-actions";

describe("uploadPsdAction", () => {
  beforeEach(() => {
    gateMock.mockReset();
    uploadPsdMock.mockReset();
    gateMock.mockResolvedValue({
      sb: { __mock: true } as never,
      actor: { userId: "u-1", roles: ["admin"] },
    });
    uploadPsdMock.mockResolvedValue({
      parentAssetId: "00000000-0000-4000-8000-000000000001",
      flatAssetId: "00000000-0000-4000-8000-000000000002",
      layerAssetIds: ["00000000-0000-4000-8000-000000000003"],
      canvasWidth: 64,
      canvasHeight: 64,
    });
  });

  it("returns ok:true with parent + flat + layer ids on happy path", async () => {
    const fd = new FormData();
    const bytes = await readFile(TINY_PSD);
    fd.append("file", new File([bytes], "tiny.psd", { type: "image/vnd.adobe.photoshop" }));
    const res = await uploadPsdAction(fd);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.parentAssetId).toBeTruthy();
      expect(res.layerAssetIds).toHaveLength(1);
      expect(res.softWarnLarge).toBe(false);
    }
  });

  it("returns ok:false code=missing_file when no file in FormData", async () => {
    const res = await uploadPsdAction(new FormData());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("missing_file");
    }
  });

  it("returns ok:false code=bad_extension when filename does not end in .psd", async () => {
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("bytes")], "tiny.png", { type: "image/png" }));
    const res = await uploadPsdAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("bad_extension");
    }
  });

  it("returns ok:false code=too_large for files > 100 MB without invoking uploadPsd", async () => {
    const fd = new FormData();
    const huge = Buffer.alloc(101 * 1024 * 1024, 0);
    fd.append("file", new File([huge], "huge.psd", { type: "image/vnd.adobe.photoshop" }));
    const res = await uploadPsdAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("too_large");
    }
    expect(uploadPsdMock).not.toHaveBeenCalled();
  });

  it("returns ok:true with softWarnLarge=true for files > 50 MB but <= 100 MB", async () => {
    const fd = new FormData();
    const mid = Buffer.alloc(60 * 1024 * 1024, 0);
    fd.append("file", new File([mid], "mid.psd", { type: "image/vnd.adobe.photoshop" }));
    const res = await uploadPsdAction(fd);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.softWarnLarge).toBe(true);
    }
  });

  it("returns ok:false code=parse_failed when uploadPsd throws PsdUploadError", async () => {
    uploadPsdMock.mockRejectedValueOnce(
      Object.assign(new Error("could not parse PSD"), { name: "PsdUploadError" }),
    );
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("not a psd")], "broken.psd", { type: "image/vnd.adobe.photoshop" }));
    const res = await uploadPsdAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("parse_failed");
    }
  });

  it("returns ok:false code=forbidden when gate throws Forbidden", async () => {
    gateMock.mockRejectedValueOnce(new Error("Forbidden: missing overlay.design.manage"));
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("x")], "tiny.psd", { type: "image/vnd.adobe.photoshop" }));
    const res = await uploadPsdAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("forbidden");
    }
  });

  it("returns ok:false code=rate_limited when gate throws rate_limited", async () => {
    gateMock.mockRejectedValueOnce(new Error("rate_limited"));
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("x")], "tiny.psd", { type: "image/vnd.adobe.photoshop" }));
    const res = await uploadPsdAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("rate_limited");
    }
  });
});
