import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useBuilderStore } from "@/state/builder/store";
import { PsdPlaceDrawer } from "./PsdPlaceDrawer";

const { listPsdsMock, listLayersMock } = vi.hoisted(() => ({
  listPsdsMock: vi.fn(),
  listLayersMock: vi.fn(),
}));

vi.mock("@/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions", () => ({
  listPsdsAction: () => listPsdsMock(),
  listLayersAction: (id: string) => listLayersMock(id),
}));

function fixtureDesign() {
  return {
    id: "d1",
    slug: "test",
    title: "T",
    mode: "single" as const,
    status: "draft" as const,
    canvasWidth: 1920,
    canvasHeight: 1080,
    scenes: [{
      id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
      transitionIn: "fade", transitionOut: "fade", elements: [],
    }],
  };
}

describe("PsdPlaceDrawer", () => {
  beforeEach(() => {
    listPsdsMock.mockReset();
    listLayersMock.mockReset();
    useBuilderStore.setState({
      design: fixtureDesign(),
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("does not render until the open-psd-picker event fires", () => {
    render(<PsdPlaceDrawer />);
    expect(screen.queryByRole("dialog", { name: /place psd/i })).not.toBeInTheDocument();
  });

  it("opens on builder:open-psd-picker, lists PSDs", async () => {
    listPsdsMock.mockResolvedValueOnce({
      ok: true,
      psds: [{
        id: "p-1", originalFilename: "score.psd", width: 1920, height: 1080,
        sizeBytes: 1024, layerCount: 3, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
      }],
    });
    render(<PsdPlaceDrawer />);
    window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
    expect(await screen.findByRole("dialog", { name: /place psd/i })).toBeInTheDocument();
    expect(await screen.findByText("score.psd")).toBeInTheDocument();
  });

  it("clicking a PSD loads its layers", async () => {
    listPsdsMock.mockResolvedValueOnce({
      ok: true,
      psds: [{
        id: "p-1", originalFilename: "score.psd", width: 1, height: 1,
        sizeBytes: 1, layerCount: 2, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
      }],
    });
    listLayersMock.mockResolvedValueOnce({
      ok: true,
      layers: [
        { id: "l-1", psdLayerIndex: 0, name: "Bg", filePath: "psd/p-1-layer-0.png", width: 1920, height: 1080 },
        { id: "l-2", psdLayerIndex: 1, name: "Score", filePath: "psd/p-1-layer-1.png", width: 400, height: 200 },
      ],
    });
    render(<PsdPlaceDrawer />);
    window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
    fireEvent.click(await screen.findByText("score.psd"));
    expect(await screen.findByText("Bg")).toBeInTheDocument();
    expect(await screen.findByText("Score")).toBeInTheDocument();
  });

  it("clicking a layer spawns an image element with the layer assetId", async () => {
    listPsdsMock.mockResolvedValueOnce({
      ok: true,
      psds: [{
        id: "p-1", originalFilename: "score.psd", width: 1, height: 1,
        sizeBytes: 1, layerCount: 1, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
      }],
    });
    listLayersMock.mockResolvedValueOnce({
      ok: true,
      layers: [
        { id: "l-1", psdLayerIndex: 0, name: "Bg", filePath: "psd/p-1-layer-0.png", width: 1920, height: 1080 },
      ],
    });
    render(<PsdPlaceDrawer />);
    window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
    fireEvent.click(await screen.findByText("score.psd"));
    fireEvent.click(await screen.findByRole("button", { name: /^place: bg$/i }));
    await waitFor(() => {
      const els = useBuilderStore.getState().design!.scenes[0].elements;
      expect(els).toHaveLength(1);
      expect(els[0].elementType).toBe("image");
      expect(els[0].content?.assetId).toBe("l-1");
    });
  });

  it("clicking Flatten spawns an image element with the flat PNG assetId", async () => {
    listPsdsMock.mockResolvedValueOnce({
      ok: true,
      psds: [{
        id: "p-1", originalFilename: "score.psd", width: 1920, height: 1080,
        sizeBytes: 1, layerCount: 0, flatAssetPath: "psd/p-1-flat.png", createdAt: "now",
      }],
    });
    listLayersMock.mockResolvedValueOnce({ ok: true, layers: [] });
    render(<PsdPlaceDrawer />);
    window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
    fireEvent.click(await screen.findByText("score.psd"));
    fireEvent.click(await screen.findByRole("button", { name: /flatten/i }));
    await waitFor(() => {
      const els = useBuilderStore.getState().design!.scenes[0].elements;
      expect(els[0].content?.assetId).toBe("psd/p-1-flat.png");
    });
  });

  it("surfaces error message when listPsdsAction returns ok:false", async () => {
    listPsdsMock.mockResolvedValueOnce({ ok: false, code: "forbidden", error: "Forbidden: missing overlay.design.manage" });
    render(<PsdPlaceDrawer />);
    window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
  });

  it("Esc closes the dialog", async () => {
    listPsdsMock.mockResolvedValueOnce({ ok: true, psds: [] });
    render(<PsdPlaceDrawer />);
    window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
    expect(await screen.findByRole("dialog", { name: /place psd/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /place psd/i })).not.toBeInTheDocument();
    });
  });
});
