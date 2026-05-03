"use client";

/**
 * Plan 53 Task 12 — Launcher.
 *
 * Renders the per-player card button + thumbnail. Clicking it opens the
 * <PlayerPhotoModal> via React.lazy so the modal bundle (and the lazy
 * upload widget chained behind it) only ships when the admin actually
 * opens a picker.
 *
 * Plain `<img>` is used (not `next/image`) — `apps/web/next.config.ts`
 * has no `remotePatterns` so Supabase storage URLs would 500 through
 * the optimizer. Public-asset paths under `/overlays/v2/_assets/...`
 * also work fine via plain `<img>`.
 */
import { Suspense, lazy, useState } from "react";

const PlayerPhotoModal = lazy(() =>
  import("./PlayerPhotoModal").then((m) => ({ default: m.PlayerPhotoModal })),
);

export type PlayerPhotoCard = {
  id: string;
  slug: string;
  name: string;
  thumbUrl: string;
  poseIndex: number;
};

export function PlayerPhotoModalLauncher(props: { card: PlayerPhotoCard }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex flex-col items-center gap-1 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-2 text-left hover:border-[var(--signal)] focus:border-[var(--signal)] focus:outline-none"
        data-testid={`player-photo-card-${props.card.slug}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={props.card.thumbUrl}
          alt={props.card.name}
          width={120}
          height={150}
          className="h-[150px] w-[120px] rounded-sm object-cover"
          loading="lazy"
        />
        <span className="mt-1 w-full truncate text-center text-xs font-semibold text-[var(--chalk-1)]">
          {props.card.name}
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          pose {props.card.poseIndex}
        </span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <PlayerPhotoModal card={props.card} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
