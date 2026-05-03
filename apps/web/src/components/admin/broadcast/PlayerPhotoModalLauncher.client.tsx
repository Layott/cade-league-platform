"use client";

/**
 * Plan 53 Task 11 — Launcher SHELL.
 *
 * Renders the per-player card button + thumbnail + name + pose label.
 * Click is wired to a no-op so the parent server panel renders cleanly
 * before Task 12 lands the modal. T12 swaps the body for a `useState`
 * + `<PlayerPhotoModal>` shell while keeping this same prop contract.
 *
 * Plain `<img>` is used (not `next/image`) — `apps/web/next.config.ts`
 * has no `remotePatterns` so Supabase storage URLs would 500 through
 * the optimizer. Public-asset paths under `/overlays/v2/_assets/...`
 * also work fine via plain `<img>`.
 */
export type PlayerPhotoCard = {
  id: string;
  slug: string;
  name: string;
  thumbUrl: string;
  poseIndex: number;
};

export function PlayerPhotoModalLauncher(props: { card: PlayerPhotoCard }) {
  return (
    <button
      type="button"
      onClick={() => {
        /* T12 wires modal here */
      }}
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
  );
}
