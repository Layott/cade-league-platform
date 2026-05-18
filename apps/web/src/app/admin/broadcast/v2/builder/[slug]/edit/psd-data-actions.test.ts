import { describe, expect, it, vi, beforeEach } from "vitest";

const { gateMock, listPsdAssetsMock, listPsdLayersMock } = vi.hoisted(() => ({
  gateMock: vi.fn(),
  listPsdAssetsMock: vi.fn(),
  listPsdLayersMock: vi.fn(),
}));

vi.mock("../../assets-actions-gate", () => ({ gate: gateMock }));
vi.mock("@/server/overlays/builder/assets", () => ({
  listPsdAssets: (...a: unknown[]) => listPsdAssetsMock(...a),
  listPsdLayers: (...a: unknown[]) => listPsdLayersMock(...a),
}));

import { listPsdsAction, listLayersAction } from "./psd-data-actions";

describe("psd-data-actions", () => {
  beforeEach(() => {
    gateMock.mockReset();
    listPsdAssetsMock.mockReset();
    listPsdLayersMock.mockReset();
    gateMock.mockResolvedValue({
      sb: { __mock: true } as never,
      actor: { userId: "u-1", roles: ["admin"] },
    });
  });

  it("listPsdsAction returns rows on happy path", async () => {
    listPsdAssetsMock.mockResolvedValueOnce([
      { id: "p-1", originalFilename: "a.psd", width: 1, height: 1, sizeBytes: 1, layerCount: 1, flatAssetPath: null, createdAt: "now" },
    ]);
    const res = await listPsdsAction();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.psds).toHaveLength(1);
  });

  it("listPsdsAction returns ok:false on Forbidden", async () => {
    gateMock.mockRejectedValueOnce(new Error("Forbidden: missing overlay.design.manage"));
    const res = await listPsdsAction();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("forbidden");
  });

  it("listLayersAction returns layers ordered by index", async () => {
    listPsdLayersMock.mockResolvedValueOnce([
      { id: "l-1", psdLayerIndex: 0, name: "Bg", filePath: "psd/x-layer-0.png", width: 64, height: 64 },
      { id: "l-2", psdLayerIndex: 1, name: "Fg", filePath: "psd/x-layer-1.png", width: 32, height: 32 },
    ]);
    const res = await listLayersAction("p-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.layers).toHaveLength(2);
      expect(res.layers[0].name).toBe("Bg");
    }
  });

  it("listLayersAction returns ok:false on Forbidden", async () => {
    gateMock.mockRejectedValueOnce(new Error("Forbidden: missing overlay.design.manage"));
    const res = await listLayersAction("p-1");
    expect(res.ok).toBe(false);
  });
});
