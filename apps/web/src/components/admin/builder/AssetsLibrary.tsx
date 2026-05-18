"use client";

import { useCallback, useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileImage, FilePlus2 } from "lucide-react";
import { uploadPsdAction } from "@/app/admin/broadcast/v2/builder/assets-actions";
import type { UploadPsdResponse } from "@/app/admin/broadcast/v2/builder/assets-schemas";
import { OpenInPhotopeaButton } from "@/components/admin/broadcast/v2/builder/OpenInPhotopeaButton";

type PsdAsset = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  layerCount: number;
  flatAssetPath: string | null;
  createdAt: string;
};

type Toast =
  | { kind: "info"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "error"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Wave 2A — `/admin/broadcast/v2/builder/assets` PSD library.
 *
 * Three tabs (PSDs / Images / Fonts); only PSDs is functional in Wave 2A.
 * Drop-zone accepts .psd files, posts to uploadPsdAction, surfaces a
 * loading + error toast, then revalidates the listing via router.refresh().
 */
export function AssetsLibrary({
  psdAssets,
  photopeaEnabled = false,
}: {
  psdAssets: PsdAsset[];
  photopeaEnabled?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"psds" | "images" | "fonts">("psds");
  const [toast, setToast] = useState<Toast | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      // Clear any previous toast. The "in flight" state is communicated by
      // the isPending flag (renders "Parsing PSD…" inside the drop-zone) so
      // we do NOT set a toast here — that would create two simultaneous
      // "parsing psd" elements in the DOM and break strict findByText calls.
      setToast(null);
      const fd = new FormData();
      fd.append("file", file);
      startTransition(async () => {
        let res: UploadPsdResponse;
        try {
          res = await uploadPsdAction(fd);
        } catch (e) {
          setToast({
            kind: "error",
            message: e instanceof Error ? e.message : "Upload failed",
          });
          return;
        }
        if (res.ok) {
          if (res.softWarnLarge) {
            setToast({
              kind: "warn",
              message: `Large file uploaded — ${file.name} parsed but may load slowly`,
            });
          } else {
            setToast({
              kind: "info",
              message: `Parsed ${file.name} → ${res.layerAssetIds.length} layers`,
            });
          }
          router.refresh();
        } else {
          setToast({ kind: "error", message: res.error });
        }
      });
    },
    [router],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      handleFile(file);
    },
    [handleFile],
  );

  const onPicker = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Asset Library</h1>
          <p className="mt-1 text-sm text-white/60">
            PSDs, images, and fonts available to every overlay design.
          </p>
        </div>
        <nav className="flex gap-2 rounded-md bg-white/5 p-1">
          {(["psds", "images", "fonts"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-4 py-1.5 text-sm capitalize transition ${
                tab === t ? "bg-[#6bcd06] text-black" : "text-white/70 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === "psds" && (
        <section>
          <div
            data-testid="psd-dropzone"
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className={`flex items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 text-sm transition ${
              isPending ? "border-[#6bcd06]/60 bg-[#6bcd06]/5" : "border-white/15 bg-white/[0.02]"
            }`}
          >
            {isPending ? (
              <span className="text-white/80">Parsing PSD…</span>
            ) : (
              <>
                <FilePlus2 size={18} className="text-white/60" />
                <span className="text-white/80">Drop a .psd file here, or</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer rounded bg-[#6bcd06] px-3 py-1.5 text-xs font-semibold text-black"
                >
                  Upload PSD
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".psd,image/vnd.adobe.photoshop"
                  className="hidden"
                  onChange={onPicker}
                />
              </>
            )}
          </div>

          {toast && (
            <div
              role="status"
              className={`mt-3 rounded px-3 py-2 text-sm ${
                toast.kind === "error"
                  ? "bg-red-900/40 text-red-100"
                  : toast.kind === "warn"
                    ? "bg-yellow-900/40 text-yellow-100"
                    : "bg-zinc-900 text-white/80"
              }`}
            >
              {toast.message}
            </div>
          )}

          {psdAssets.length === 0 ? (
            <p className="mt-8 text-center text-sm text-white/50">
              No PSDs uploaded yet — drop one above to begin.
            </p>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {psdAssets.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                >
                  <div className="flex items-center gap-2 text-white">
                    <FileImage size={16} className="text-white/60" />
                    <span className="truncate text-sm font-medium">
                      {a.originalFilename}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-1 text-xs text-white/60">
                    <dt>Size</dt>
                    <dd className="text-right">{formatBytes(a.sizeBytes)}</dd>
                    <dt>Dimensions</dt>
                    <dd className="text-right">
                      {a.width && a.height ? `${a.width}×${a.height}` : "—"}
                    </dd>
                    <dt>Layers</dt>
                    <dd className="text-right">{a.layerCount} layers</dd>
                  </dl>
                  <div className="mt-1 flex justify-end">
                    <OpenInPhotopeaButton
                      designSlug="library"
                      assetId={a.id}
                      assetType="psd"
                      photopeaEnabled={photopeaEnabled}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "images" && (
        <p className="mt-12 text-center text-white/60">
          Image upload ships in Wave 1B.
        </p>
      )}
      {tab === "fonts" && (
        <p className="mt-12 text-center text-white/60">
          Font upload ships in Wave 1B.
        </p>
      )}
    </div>
  );
}
