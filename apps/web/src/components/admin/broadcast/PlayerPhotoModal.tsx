"use client";

/**
 * Plan 53 Task 12 — Photo picker modal.
 *
 * Wired into <PlayerPhotoModalLauncher> via lazy import. Fetches the
 * gallery feed from `/api/broadcast/v2/photos/[playerId]/gallery`, lets
 * the admin pick a global default pose AND override on a per-overlay
 * basis, persisted via POST/DELETE /api/broadcast/v2/photos/selections.
 *
 * Notes:
 *   - Plain `<img>` (not `next/image`). `apps/web/next.config.ts` has no
 *     `remotePatterns` so the optimizer 500s on Supabase storage URLs;
 *     T11's launcher set the precedent.
 *   - `PlayerPhotoUploadWidget` (T13) is lazy-loaded so the heavy bg-removal
 *     ONNX model + JSZip only ship when an admin actually starts an upload.
 *   - Mutation responses (`{ok:true}` or `{error}`) drive an inline
 *     `errorMsg` banner instead of crashing the modal on 401/403.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { PlayerPhotoCard } from "./PlayerPhotoModalLauncher.client";

const UploadWidget = lazy(() =>
  import("./PlayerPhotoUploadWidget").then((m) => ({
    default: m.PlayerPhotoUploadWidget,
  })),
);

type PoseSource = "manifest" | "upload";

type ResolvedPose = { poseIndex: number; source: PoseSource };

type GalleryPose = {
  poseIndex: number;
  thumbnailUrl: string;
  banned: boolean;
};

type UploadCoverage = "full" | "headshot+card" | "headshot" | "incomplete";

type UploadedPose = {
  poseIndex: number;
  thumbnailUrl: string;
  status: string;
  uploadedAt: string;
  coverage: UploadCoverage;
};

type GalleryResponse = {
  manifestPoses: GalleryPose[];
  uploadedPoses: UploadedPose[];
  effectiveGlobalPose: ResolvedPose;
  perOverlayOverrides: Record<string, ResolvedPose>;
};

// 15 overlay keys per Plan 53 §12.2 line 1451 — kept verbatim. Order is
// the visual order the admin sees when scanning the override matrix.
const OVERLAY_KEYS = [
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "08-lower-third",
  "09-secondary-score-bug",
  "10-up-next-bug",
  "11-match-scores-day",
  "14-top-scorers",
  "15-orgs",
  "16-coaches",
  "17-penalties",
  "19-player-squads",
  "01-long-intro",
  "05-stinger-winner",
] as const;

export function PlayerPhotoModal(props: {
  card: PlayerPhotoCard;
  onClose: () => void;
}) {
  const [gallery, setGallery] = useState<GalleryResponse | null>(null);
  const [globalPose, setGlobalPose] = useState<number>(props.card.poseIndex);
  const [globalSource, setGlobalSource] = useState<PoseSource>("manifest");
  const [overrides, setOverrides] = useState<
    Record<string, { poseIndex: number; source: PoseSource } | null>
  >({});
  const [showUpload, setShowUpload] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadGallery() {
    const r = await fetch(
      `/api/broadcast/v2/photos/${props.card.id}/gallery`,
      { cache: "no-store" },
    );
    if (!r.ok) {
      setErrorMsg(`Failed to load gallery (${r.status})`);
      return;
    }
    const g = (await r.json()) as GalleryResponse;
    setGallery(g);
    setGlobalPose(g.effectiveGlobalPose.poseIndex);
    setGlobalSource(g.effectiveGlobalPose.source);
    const init: Record<string, { poseIndex: number; source: PoseSource }> = {};
    for (const k of Object.keys(g.perOverlayOverrides)) {
      init[k] = {
        poseIndex: g.perOverlayOverrides[k].poseIndex,
        source: g.perOverlayOverrides[k].source,
      };
    }
    setOverrides(init);
  }

  useEffect(() => {
    loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.card.id]);

  async function setPose(
    poseIndex: number,
    overlayKey: string | null,
    source: PoseSource,
  ) {
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/broadcast/v2/photos/selections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: props.card.id,
          overlayKey,
          poseIndex,
          source,
        }),
      });
      if (!r.ok) {
        let message = `Save failed (${r.status})`;
        try {
          const j = (await r.json()) as { error?: string };
          if (j?.error) message = j.error;
        } catch {
          /* ignore */
        }
        setErrorMsg(message);
        return false;
      }
      return true;
    } catch (e) {
      setErrorMsg((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function clearOverride(overlayKey: string) {
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/broadcast/v2/photos/selections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: props.card.id,
          overlayKey,
        }),
      });
      if (!r.ok) {
        let message = `Clear failed (${r.status})`;
        try {
          const j = (await r.json()) as { error?: string };
          if (j?.error) message = j.error;
        } catch {
          /* ignore */
        }
        setErrorMsg(message);
        return false;
      }
      return true;
    } catch (e) {
      setErrorMsg((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const manifestUsable = useMemo(
    () => (gallery?.manifestPoses ?? []).filter((p) => !p.banned),
    [gallery],
  );

  if (!gallery) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        onClick={props.onClose}
      >
        <div
          className="rounded-lg border border-white/10 bg-[#0a0a0a] p-6 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {errorMsg ? (
            <p className="text-[#fe036d]">{errorMsg}</p>
          ) : (
            <p className="opacity-80">Loading gallery…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={props.onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${props.card.name} photo picker`}
    >
      <div
        className="max-h-[90vh] w-[800px] overflow-y-auto rounded-lg border border-white/10 bg-[#0a0a0a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">
            {props.card.name} — Photo Picker
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded px-2 py-1 text-white hover:bg-white/10"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {errorMsg && (
          <div className="mb-3 rounded border border-[#fe036d]/40 bg-[#fe036d]/10 px-3 py-2 text-xs text-[#fe036d]">
            {errorMsg}
          </div>
        )}

        <section className="mb-6">
          <h4 className="mb-2 text-sm font-semibold opacity-80">
            Global default
          </h4>
          <div className="flex flex-wrap gap-2">
            {gallery.manifestPoses.map((p) => {
              const selected =
                globalSource === "manifest" && globalPose === p.poseIndex;
              return (
                <button
                  key={`m-${p.poseIndex}`}
                  type="button"
                  disabled={p.banned || busy}
                  onClick={async () => {
                    const ok = await setPose(p.poseIndex, null, "manifest");
                    if (ok) {
                      setGlobalPose(p.poseIndex);
                      setGlobalSource("manifest");
                    }
                  }}
                  className={`relative rounded border-2 p-1 ${
                    selected ? "border-[#6bcd06]" : "border-transparent"
                  } ${p.banned ? "cursor-not-allowed opacity-30" : "hover:border-white/40"}`}
                  title={p.banned ? "Banned pose" : `manifest pose ${p.poseIndex}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnailUrl}
                    alt={`pose ${p.poseIndex}`}
                    width={80}
                    height={100}
                    className="h-[100px] w-[80px] rounded object-cover"
                    loading="lazy"
                  />
                  <span className="block text-center text-[10px]">
                    p{p.poseIndex}
                  </span>
                </button>
              );
            })}
            {gallery.uploadedPoses.map((p) => {
              const selected =
                globalSource === "upload" && globalPose === p.poseIndex;
              return (
                <button
                  key={`u-${p.poseIndex}`}
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await setPose(p.poseIndex, null, "upload");
                    if (ok) {
                      setGlobalPose(p.poseIndex);
                      setGlobalSource("upload");
                    }
                  }}
                  className={`relative rounded border-2 p-1 ${
                    selected ? "border-[#6bcd06]" : "border-transparent"
                  } hover:border-white/40`}
                  title={`upload pose ${p.poseIndex} · ${p.coverage}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnailUrl}
                    alt={`pose ${p.poseIndex}`}
                    width={80}
                    height={100}
                    className="h-[100px] w-[80px] rounded object-cover"
                    loading="lazy"
                  />
                  <span className="block text-center text-[10px]">
                    p{p.poseIndex}
                  </span>
                  <span className="absolute right-0 top-0 rounded-bl bg-[#fe036d] px-1 text-[8px] text-white">
                    {p.coverage}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="rounded border-2 border-dashed border-white/30 p-1 text-xs hover:border-[#6bcd06]"
              disabled={busy}
            >
              + Upload
            </button>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold opacity-80">
            Per-overlay overrides
          </h4>
          <div className="space-y-1 text-sm">
            {OVERLAY_KEYS.map((k) => {
              const current = overrides[k];
              const selectValue = current
                ? `${current.source}:${current.poseIndex}`
                : "";
              return (
                <div
                  key={k}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="font-mono text-xs">{k}</span>
                  <select
                    value={selectValue}
                    disabled={busy}
                    onChange={async (e) => {
                      const v = e.target.value;
                      if (v === "") {
                        const ok = await clearOverride(k);
                        if (ok) {
                          const next = { ...overrides };
                          delete next[k];
                          setOverrides(next);
                        }
                      } else {
                        const [src, idx] = v.split(":");
                        const source = src as PoseSource;
                        const poseIndex = Number(idx);
                        const ok = await setPose(poseIndex, k, source);
                        if (ok) {
                          setOverrides({
                            ...overrides,
                            [k]: { poseIndex, source },
                          });
                        }
                      }
                    }}
                    className="rounded bg-black/50 px-2 py-1 text-xs text-white"
                  >
                    <option value="">Use global</option>
                    {manifestUsable.map((p) => (
                      <option
                        key={`m-${p.poseIndex}`}
                        value={`manifest:${p.poseIndex}`}
                      >
                        manifest p{p.poseIndex}
                      </option>
                    ))}
                    {gallery.uploadedPoses.map((p) => (
                      <option
                        key={`u-${p.poseIndex}`}
                        value={`upload:${p.poseIndex}`}
                      >
                        upload p{p.poseIndex} ({p.coverage})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>

        {showUpload && (
          <Suspense
            fallback={
              <div className="mt-4 text-xs opacity-70">Loading uploader…</div>
            }
          >
            <UploadWidget
              playerId={props.card.id}
              onComplete={() => {
                setShowUpload(false);
                loadGallery();
              }}
              onCancel={() => setShowUpload(false)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
