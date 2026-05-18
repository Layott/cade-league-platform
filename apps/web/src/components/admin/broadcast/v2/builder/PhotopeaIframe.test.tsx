/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhotopeaIframe } from "./PhotopeaIframe";

describe("PhotopeaIframe", () => {
  let saveActionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveActionMock = vi.fn().mockResolvedValue({
      assetId: "11111111-1111-4111-8111-111111111111",
      historyId: "h-1",
      flatPngAssetId: "flat-1",
      spriteAssetIds: [],
      newSizeBytes: 4,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a sandboxed iframe with the Photopea src", () => {
    render(
      <PhotopeaIframe
        assetId="11111111-1111-4111-8111-111111111111"
        psdSignedUrl="https://supabase/signed?token=abc"
        onSaved={vi.fn()}
        saveAction={saveActionMock}
      />,
    );
    const iframe = screen.getByTitle(/photopea/i) as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toContain("https://www.photopea.com");
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin",
    );
  });

  it("posts app.open with the signed url on iframe load", async () => {
    render(
      <PhotopeaIframe
        assetId="11111111-1111-4111-8111-111111111111"
        psdSignedUrl="https://supabase/signed?token=abc"
        onSaved={vi.fn()}
        saveAction={saveActionMock}
      />,
    );
    const iframe = screen.getByTitle(/photopea/i) as HTMLIFrameElement;
    const postSpy = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => {});
    fireEvent.load(iframe);
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [payload, origin] = postSpy.mock.calls[0];
    expect(JSON.stringify(payload)).toContain(
      "https://supabase/signed?token=abc",
    );
    expect(origin).toBe("https://www.photopea.com");
  });

  it("posts app.activeDocument.saveToOE when Save is clicked", async () => {
    render(
      <PhotopeaIframe
        assetId="11111111-1111-4111-8111-111111111111"
        psdSignedUrl="https://supabase/signed?token=abc"
        onSaved={vi.fn()}
        saveAction={saveActionMock}
      />,
    );
    const iframe = screen.getByTitle(/photopea/i) as HTMLIFrameElement;
    const postSpy = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => {});
    fireEvent.load(iframe);
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    postSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [savePayload] = postSpy.mock.calls[0];
    expect(JSON.stringify(savePayload)).toContain(
      "app.activeDocument.saveToOE",
    );
  });

  it("ignores postMessage events from wrong origin", async () => {
    render(
      <PhotopeaIframe
        assetId="11111111-1111-4111-8111-111111111111"
        psdSignedUrl="https://supabase/signed?token=abc"
        onSaved={vi.fn()}
        saveAction={saveActionMock}
      />,
    );

    const fakePsd = new Uint8Array([0x38, 0x42, 0x50, 0x53]).buffer;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: fakePsd,
        origin: "https://www.attacker.example",
      }),
    );

    // Give the handler a tick to (incorrectly) run if origin gate is missing.
    await new Promise((r) => setTimeout(r, 50));
    expect(saveActionMock).not.toHaveBeenCalled();
  });

  it("invokes saveAction with the PSD bytes when Photopea replies", async () => {
    const onSaved = vi.fn();
    render(
      <PhotopeaIframe
        assetId="11111111-1111-4111-8111-111111111111"
        psdSignedUrl="https://supabase/signed?token=abc"
        onSaved={onSaved}
        saveAction={saveActionMock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const psdBytes = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: psdBytes.buffer,
        origin: "https://www.photopea.com",
      }),
    );

    await waitFor(() => expect(saveActionMock).toHaveBeenCalled());
    const formData = saveActionMock.mock.calls[0][0] as FormData;
    expect(formData.get("assetId")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(formData.get("psd")).toBeInstanceOf(File);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("renders a Close button that invokes onClose", () => {
    const onClose = vi.fn();
    render(
      <PhotopeaIframe
        assetId="11111111-1111-4111-8111-111111111111"
        psdSignedUrl="https://supabase/signed?token=abc"
        onSaved={vi.fn()}
        saveAction={saveActionMock}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces 'Saving... Done.' status text through the save lifecycle", async () => {
    render(
      <PhotopeaIframe
        assetId="11111111-1111-4111-8111-111111111111"
        psdSignedUrl="https://supabase/signed?token=abc"
        onSaved={vi.fn()}
        saveAction={saveActionMock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    window.dispatchEvent(
      new MessageEvent("message", {
        data: new Uint8Array([0x38, 0x42, 0x50, 0x53]).buffer,
        origin: "https://www.photopea.com",
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("photopea-status").textContent).toMatch(/saving/i),
    );
    await waitFor(() =>
      expect(screen.getByTestId("photopea-status").textContent).toMatch(/done/i),
    );
  });
});
