"use client";

import { useCallback, useEffect, useState } from "react";
import { FileImage, Layers, X } from "lucide-react";
import { useBuilderStore } from "@/state/builder/store";
import {
  listPsdsAction,
  listLayersAction,
} from "@/app/admin/broadcast/v2/builder/[slug]/edit/psd-data-actions";
import { OpenInPhotopeaButton } from "@/components/admin/broadcast/v2/builder/OpenInPhotopeaButton";

type PsdRow = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  layerCount: number;
  flatAssetPath: string | null;
  createdAt: string;
};

type LayerRow = {
  id: string;
  psdLayerIndex: number;
  name: string;
  filePath: string;
  width: number | null;
  height: number | null;
};

/**
 * Wave 2A — PSD layer-picker drawer.
 *
 * Listens for `builder:open-psd-picker` window event (fired by the
 * Toolbar's "From PSD" sub-option), fetches PSDs via server action,
 * lets the user pick a PSD then a layer (or "Flatten" for the whole
 * composite). Each pick calls `addElement(...)` on the builder store
 * with an `image` element whose `content.assetId` is the layer's
 * asset id (server-side image renderer resolves to a storage path).
 *
 * Flatten path stores the flat PNG's storage path directly (not its
 * row id) so the compiler can serve it without an extra DB lookup.
 * This is the only place where assetId is a path rather than a uuid;
 * the image-element renderer in the compiler tolerates both shapes.
 */
export function PsdPlaceDrawer({
  designSlug,
  photopeaEnabled = false,
}: {
  designSlug?: string;
  photopeaEnabled?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  const [psds, setPsds] = useState<PsdRow[] | null>(null);
  const [layers, setLayers] = useState<LayerRow[] | null>(null);
  const [activePsd, setActivePsd] = useState<PsdRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPsds, setLoadingPsds] = useState(false);
  const [loadingLayers, setLoadingLayers] = useState(false);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const addElement = useBuilderStore((s) => s.addElement);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
      setActivePsd(null);
      setLayers(null);
      setError(null);
    }
    window.addEventListener("builder:open-psd-picker", onOpen);
    return () => window.removeEventListener("builder:open-psd-picker", onOpen);
  }, []);

  useEffect(() => {
    if (!open || psds !== null) return;
    setLoadingPsds(true);
    listPsdsAction()
      .then((res) => {
        if (res.ok) {
          setPsds(res.psds as PsdRow[]);
        } else {
          setError(res.error);
          setPsds([]);
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPsds([]);
      })
      .finally(() => setLoadingPsds(false));
  }, [open, psds]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const pickPsd = useCallback((psd: PsdRow) => {
    setActivePsd(psd);
    setLayers(null);
    setError(null);
    setLoadingLayers(true);
    listLayersAction(psd.id)
      .then((res) => {
        if (res.ok) setLayers(res.layers as LayerRow[]);
        else {
          setError(res.error);
          setLayers([]);
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLayers([]);
      })
      .finally(() => setLoadingLayers(false));
  }, []);

  const placeLayer = useCallback(
    (layer: LayerRow) => {
      if (!activeSceneId) return;
      const w = layer.width ?? 200;
      const h = layer.height ?? 200;
      addElement(activeSceneId, "image", {
        transform: {
          x: Math.max(0, 960 - w / 2),
          y: Math.max(0, 540 - h / 2),
          width: w,
          height: h,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
        },
        style: {},
        content: { assetId: layer.id, imageFit: "cover", imageSourceName: layer.name },
        zIndex: 0,
      });
      setOpen(false);
    },
    [activeSceneId, addElement],
  );

  const placeFlat = useCallback(
    (psd: PsdRow) => {
      if (!activeSceneId || !psd.flatAssetPath) return;
      const w = psd.width ?? 1920;
      const h = psd.height ?? 1080;
      addElement(activeSceneId, "image", {
        transform: {
          x: Math.max(0, 960 - w / 2),
          y: Math.max(0, 540 - h / 2),
          width: w,
          height: h,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
        },
        style: {},
        content: { assetId: psd.flatAssetPath, imageFit: "cover", imageSourceName: psd.originalFilename },
        zIndex: 0,
      });
      setOpen(false);
    },
    [activeSceneId, addElement],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="presentation">
      <div
        role="dialog"
        aria-label="Place PSD"
        className="flex h-[80vh] w-[min(960px,90vw)] flex-col rounded-lg border border-white/10 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-lg font-semibold text-white">Place PSD</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid flex-1 grid-cols-2 gap-0 overflow-hidden">
          <section className="overflow-y-auto border-r border-white/10 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
              PSDs
            </h3>
            {loadingPsds && <p className="text-sm text-white/60">Loading…</p>}
            {error && <p className="text-sm text-red-300">{error}</p>}
            {psds && psds.length === 0 && !error && (
              <p className="text-sm text-white/50">No PSDs uploaded yet.</p>
            )}
            <ul className="space-y-1">
              {(psds ?? []).map((p) => (
                <li key={p.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => pickPsd(p)}
                    className={`flex flex-1 items-center gap-2 rounded px-3 py-2 text-left text-sm transition ${
                      activePsd?.id === p.id ? "bg-[#6bcd06]/15 text-[#6bcd06]" : "text-white/80 hover:bg-white/5"
                    }`}
                  >
                    <FileImage size={14} />
                    <span className="flex-1 truncate">{p.originalFilename}</span>
                    <span className="text-xs text-white/40">{p.layerCount}L</span>
                  </button>
                  {designSlug && (
                    <OpenInPhotopeaButton
                      designSlug={designSlug}
                      assetId={p.id}
                      assetType="psd"
                      photopeaEnabled={photopeaEnabled}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="overflow-y-auto p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
              Layers
            </h3>
            {!activePsd && <p className="text-sm text-white/50">Pick a PSD on the left to see its layers.</p>}
            {activePsd && (
              <>
                <button
                  type="button"
                  onClick={() => placeFlat(activePsd)}
                  disabled={!activePsd.flatAssetPath}
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded bg-[#6bcd06] px-3 py-2 text-sm font-semibold text-black disabled:bg-zinc-700 disabled:text-white/50"
                >
                  <Layers size={14} />
                  Flatten — place full composite
                </button>
                {loadingLayers && <p className="text-sm text-white/60">Loading layers…</p>}
                <ul className="space-y-1">
                  {(layers ?? []).map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        aria-label={`Place: ${l.name}`}
                        onClick={() => placeLayer(l)}
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"
                      >
                        <span className="text-xs text-white/40">#{l.psdLayerIndex}</span>
                        <span className="flex-1 truncate">{l.name}</span>
                        {l.width && l.height && (
                          <span className="text-xs text-white/40">
                            {l.width}×{l.height}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
