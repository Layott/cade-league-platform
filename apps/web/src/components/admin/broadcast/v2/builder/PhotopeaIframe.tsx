"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type JSX,
} from "react";
import type { SavePsdResult } from "@/server/overlays/builder/photopea-bridge.types";

/**
 * Wave 2B — sandboxed Photopea iframe + postMessage save bridge.
 *
 * - Sandbox: `allow-scripts allow-same-origin` (Photopea needs both;
 *   `allow-same-origin` here refers to Photopea's OWN origin inside
 *   the sandbox, NOT to ours).
 * - Bootstrap: on `load`, post `{ type: 'app.open', file: <signedUrl> }`
 *   into the iframe so Photopea downloads our PSD.
 * - Save: button posts `{ type: 'app.activeDocument.saveToOE' }`.
 *   Photopea replies with raw PSD bytes via a `message` event whose
 *   `data` is an ArrayBuffer.
 * - Origin gate: `event.origin === 'https://www.photopea.com'`
 *   validated BEFORE the payload is read. Mismatches logged + dropped.
 * - Progress UI: indeterminate spinner during the action call;
 *   "Saving..." then "Done." status text.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12.
 */

const PHOTOPEA_EMBED_ORIGIN = "https://www.photopea.com";
const PHOTOPEA_SRC = `${PHOTOPEA_EMBED_ORIGIN}/`;

type Status = "idle" | "saving" | "done" | "error";

export type PhotopeaIframeProps = {
  assetId: string;
  psdSignedUrl: string;
  saveAction: (formData: FormData) => Promise<SavePsdResult>;
  onSaved?: (result: SavePsdResult) => void;
  onClose?: () => void;
};

export function PhotopeaIframe({
  assetId,
  psdSignedUrl,
  saveAction,
  onSaved,
  onClose,
}: PhotopeaIframeProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Track whether the operator has actively clicked Save. We only
  // accept binary postMessage payloads while a save is in flight to
  // prevent stray Photopea events from triggering uploads.
  const saveInFlight = useRef(false);

  /** Send a typed envelope INTO the Photopea iframe. */
  const postToPhotopea = useCallback((payload: unknown) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(payload, PHOTOPEA_EMBED_ORIGIN);
  }, []);

  /** Bootstrap: fire `app.open` once Photopea finishes loading. */
  const handleIframeLoad = useCallback(() => {
    postToPhotopea({
      type: "app.open",
      file: psdSignedUrl,
    });
  }, [postToPhotopea, psdSignedUrl]);

  /** Send the save command. */
  const handleSaveClick = useCallback(() => {
    setErrorMsg(null);
    setStatus("saving");
    saveInFlight.current = true;
    postToPhotopea({ type: "app.activeDocument.saveToOE" });
  }, [postToPhotopea]);

  /** Listen for Photopea replies. */
  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      // STRICT ORIGIN GATE — drop anything not from Photopea BEFORE
      // we touch `event.data`. This is the single most important
      // line in the bridge.
      if (event.origin !== PHOTOPEA_EMBED_ORIGIN) {
        // Log + drop. Don't surface to the user — would just be noise
        // from random extensions / devtools / other iframes.
        console.debug("[photopea-bridge] dropped non-photopea message", {
          origin: event.origin,
        });
        return;
      }

      // Only act on binary payloads when a save is in flight.
      if (!saveInFlight.current) return;
      if (!(event.data instanceof ArrayBuffer)) return;

      const psdBytes = new Uint8Array(event.data);
      if (
        psdBytes.byteLength < 4 ||
        psdBytes[0] !== 0x38 ||
        psdBytes[1] !== 0x42 ||
        psdBytes[2] !== 0x50 ||
        psdBytes[3] !== 0x53
      ) {
        setStatus("error");
        setErrorMsg("Photopea reply missing PSD magic; save aborted.");
        saveInFlight.current = false;
        return;
      }

      try {
        const fd = new FormData();
        fd.set("assetId", assetId);
        fd.set(
          "psd",
          new File([psdBytes], "edit.psd", {
            type: "image/vnd.adobe.photoshop",
          }),
        );
        const result = await saveAction(fd);
        setStatus("done");
        saveInFlight.current = false;
        onSaved?.(result);
      } catch (err) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
        saveInFlight.current = false;
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [assetId, saveAction, onSaved]);

  const sandboxProps: ComponentProps<"iframe"> = {
    // The combination Photopea requires. `allow-same-origin` here is
    // Photopea's OWN origin inside the sandbox — does NOT permit
    // Photopea to read our cookies (it's a different origin from
    // ours, so the same-origin policy still blocks cross-origin
    // reads).
    sandbox: "allow-scripts allow-same-origin",
  };

  return (
    <div
      data-testid="photopea-shell"
      className="flex h-full w-full flex-col bg-[var(--ink-1)]"
    >
      <header className="flex items-center justify-between border-b border-[var(--ink-4)] px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-1)]">
            Edit PSD in Photopea
          </h2>
          <span
            data-testid="photopea-status"
            className="text-[11px] uppercase tracking-[0.16em] text-[var(--chalk-3)]"
            aria-live="polite"
          >
            {status === "idle" && "Ready"}
            {status === "saving" && "Saving..."}
            {status === "done" && "Done."}
            {status === "error" && (
              <span className="text-[var(--signal-warn)]">
                Error: {errorMsg ?? "unknown"}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={status === "saving"}
            className="rounded-sm bg-[var(--signal)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-1)] disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-[var(--ink-4)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:bg-[var(--ink-2)]"
          >
            Close
          </button>
        </div>
      </header>

      <div className="relative flex-1">
        {status === "saving" && (
          <div
            data-testid="photopea-progress"
            className="absolute left-0 top-0 z-10 h-0.5 w-full animate-pulse bg-[var(--signal)]"
          />
        )}
        <iframe
          ref={iframeRef}
          title="Photopea editor"
          src={PHOTOPEA_SRC}
          onLoad={handleIframeLoad}
          className="h-full w-full border-0"
          {...sandboxProps}
        />
      </div>
    </div>
  );
}
