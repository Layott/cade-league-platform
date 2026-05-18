import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetsLibrary } from "./AssetsLibrary";

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: routerRefreshMock }),
}));

const { uploadActionMock } = vi.hoisted(() => ({
  uploadActionMock: vi.fn(),
}));

vi.mock("@/app/admin/broadcast/v2/builder/assets-actions", () => ({
  uploadPsdAction: (...args: unknown[]) => uploadActionMock(...args),
}));

describe("AssetsLibrary", () => {
  beforeEach(() => {
    uploadActionMock.mockReset();
    routerRefreshMock.mockReset();
    uploadActionMock.mockResolvedValue({
      ok: true,
      parentAssetId: "p-1",
      flatAssetId: "f-1",
      layerAssetIds: ["l-1", "l-2"],
      canvasWidth: 1920,
      canvasHeight: 1080,
      softWarnLarge: false,
    });
  });

  it("renders the PSD tab with empty-state when no PSDs yet", () => {
    render(<AssetsLibrary psdAssets={[]} />);
    expect(screen.getByText(/no psds uploaded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload psd/i })).toBeInTheDocument();
  });

  it("renders a card per PSD with layer count + size", () => {
    render(
      <AssetsLibrary
        psdAssets={[
          {
            id: "p-1",
            originalFilename: "scoreboard.psd",
            width: 1920,
            height: 1080,
            sizeBytes: 12 * 1024 * 1024,
            layerCount: 18,
            flatAssetPath: "psd/p-1-flat.png",
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    expect(screen.getByText("scoreboard.psd")).toBeInTheDocument();
    expect(screen.getByText(/18 layers/i)).toBeInTheDocument();
    expect(screen.getByText(/12\.0 MB/)).toBeInTheDocument();
  });

  it("calls uploadPsdAction when a PSD is dropped onto the dropzone", async () => {
    render(<AssetsLibrary psdAssets={[]} />);
    const drop = screen.getByTestId("psd-dropzone");
    const file = new File([Buffer.from("8BPS-stub")], "drop.psd", { type: "image/vnd.adobe.photoshop" });
    fireEvent.drop(drop, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(uploadActionMock).toHaveBeenCalledTimes(1));
    const fd = uploadActionMock.mock.calls[0][0] as FormData;
    expect((fd.get("file") as File).name).toBe("drop.psd");
  });

  it("shows parsing status while upload is in flight", async () => {
    let resolve!: (v: unknown) => void;
    uploadActionMock.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    render(<AssetsLibrary psdAssets={[]} />);
    const drop = screen.getByTestId("psd-dropzone");
    const file = new File([Buffer.from("x")], "spin.psd", { type: "image/vnd.adobe.photoshop" });
    fireEvent.drop(drop, { dataTransfer: { files: [file] } });
    expect(await screen.findByText(/parsing psd/i)).toBeInTheDocument();
    resolve({ ok: true, parentAssetId: "p", flatAssetId: "f", layerAssetIds: [], canvasWidth: 1, canvasHeight: 1, softWarnLarge: false });
    await waitFor(() => expect(screen.queryByText(/parsing psd/i)).not.toBeInTheDocument());
  });

  it("surfaces error toast when upload returns ok:false", async () => {
    uploadActionMock.mockResolvedValueOnce({
      ok: false,
      code: "too_large",
      error: "File is 200 MB; max 100 MB",
    });
    render(<AssetsLibrary psdAssets={[]} />);
    const drop = screen.getByTestId("psd-dropzone");
    const file = new File([Buffer.from("x")], "huge.psd", { type: "image/vnd.adobe.photoshop" });
    fireEvent.drop(drop, { dataTransfer: { files: [file] } });
    expect(await screen.findByText(/200 MB/)).toBeInTheDocument();
  });

  it("shows soft warning when softWarnLarge=true", async () => {
    uploadActionMock.mockResolvedValueOnce({
      ok: true,
      parentAssetId: "p-1",
      flatAssetId: "f-1",
      layerAssetIds: ["l-1"],
      canvasWidth: 1920,
      canvasHeight: 1080,
      softWarnLarge: true,
    });
    render(<AssetsLibrary psdAssets={[]} />);
    const drop = screen.getByTestId("psd-dropzone");
    const file = new File([Buffer.from("x")], "big.psd", { type: "image/vnd.adobe.photoshop" });
    fireEvent.drop(drop, { dataTransfer: { files: [file] } });
    expect(await screen.findByText(/large file/i)).toBeInTheDocument();
  });
});
