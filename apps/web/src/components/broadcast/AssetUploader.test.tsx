import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetUploader } from "./AssetUploader";

/**
 * Plan 48 — RTL smoke coverage for AssetUploader. Ensures:
 *   - renders with expected accessible text
 *   - POSTs /api/broadcast/asset-upload-url + then PUTs to signed URL
 *   - onUploaded fires with publicUrl
 *   - surfaces error banner when sign step fails
 */

function makeFile(name: string, size = 1234, type = "image/png") {
  // JSDOM's File honours a 'type' option; set a fake size via Object.
  const f = new File([new Uint8Array(size)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("AssetUploader", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const onUploaded = vi.fn();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    onUploaded.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an Upload button for image kind", () => {
    render(
      <AssetUploader
        kind="image"
        onUploaded={onUploaded}
        data-testid="test-uploader"
      />,
    );
    const btn = screen.getByTestId("test-uploader-button");
    expect(btn.textContent?.toLowerCase()).toContain("upload");
  });

  it("signs → PUTs → calls onUploaded with publicUrl", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("asset-upload-url")) {
        return new Response(
          JSON.stringify({
            uploadUrl: "https://signed.example/upload/abc",
            publicUrl: "https://public.example/overlay-assets/x.png",
            storagePath: "images/2026/04/x.png",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // the signed PUT
      return new Response(null, { status: 200 });
    });

    render(
      <AssetUploader
        kind="image"
        onUploaded={onUploaded}
        data-testid="u"
      />,
    );
    const input = screen.getByTestId("u-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("hello.png")] } });
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(onUploaded).toHaveBeenCalledWith(
      "https://public.example/overlay-assets/x.png",
    );
    // Status line with publicUrl
    const urlLine = await screen.findByTestId("u-url");
    expect(urlLine.textContent).toContain("public.example");
  });

  it("surfaces error when sign step fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );
    render(
      <AssetUploader
        kind="image"
        onUploaded={onUploaded}
        data-testid="u"
      />,
    );
    const input = screen.getByTestId("u-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("x.png")] } });
    const err = await screen.findByTestId("u-error");
    expect(err.textContent?.toLowerCase()).toContain("sign");
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("uses video accept for video kind", () => {
    render(
      <AssetUploader
        kind="video"
        onUploaded={onUploaded}
        data-testid="v"
      />,
    );
    const input = screen.getByTestId("v-input") as HTMLInputElement;
    expect(input.accept).toContain("video/mp4");
    expect(input.accept).toContain("video/webm");
  });
});
