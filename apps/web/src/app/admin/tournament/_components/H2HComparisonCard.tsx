"use client";

import Image from "next/image";
import { getPlayerAvatarUrl } from "@/lib/player-photos";

/**
 * Plan 51 — single-player stat card for the H2H Lookup tab.
 *
 * Renders the same stat subset as the H2H broadcast overlays (Pos, P,
 * W-D-L, GF, GA, GD, Pts, Win Probability %) so the admin's read of
 * the comparison matches what gets shown on stream.
 */

export type H2HCard = {
  playerId: string;
  name: string;
  gamerTag: string;
  pos: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  /**
   * Win probability against the AVERAGE of the other selected players.
   * Integer percent in [0..100] — same shape as the browser-source
   * overlay payload (`/api/broadcast/sessions/[id]/h2h` +
   * `/api/tournament/h2h`). 2026-04-28 fix (Bug #14): was previously a
   * fraction in [0..1]; multiplied by 100 at the endpoint layer.
   */
  winProbPct: number;
};

export function H2HComparisonCard({ card }: { card: H2HCard }) {
  const photo = getPlayerAvatarUrl(card.gamerTag);
  return (
    <article
      className="flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid={`h2h-card-${card.playerId}`}
    >
      <header className="flex items-center gap-3 border-b border-[var(--ink-4)] pb-3">
        <span className="relative inline-flex h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--ink-3)]">
          {photo ? (
            <Image src={photo} alt="" fill sizes="48px" className="object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[12px] font-semibold uppercase text-[var(--chalk-3)]">
              {(card.name ?? "?").slice(0, 2)}
            </span>
          )}
        </span>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            {card.pos ? `#${card.pos}` : "—"}
          </span>
          <span className="font-display text-base font-semibold leading-tight text-[var(--chalk-0)]">
            {card.name}
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            {card.gamerTag}
          </span>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-y-2 text-[12px]">
        <Stat label="Played" value={card.played} />
        <Stat
          label="W-D-L"
          value={`${card.wins}-${card.draws}-${card.losses}`}
          mono
        />
        <Stat label="GF" value={card.gf} />
        <Stat label="GA" value={card.ga} />
        <Stat
          label="GD"
          value={card.gd > 0 ? `+${card.gd}` : `${card.gd}`}
          mono
        />
        <Stat label="Pts" value={card.pts} accent />
      </dl>
      <footer className="space-y-1.5 border-t border-[var(--ink-4)] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Win prob
          </span>
          <span
            className="font-mono text-[14px] font-bold tabular text-[var(--primary)]"
            data-testid="win-prob-pct"
          >
            {card.winProbPct.toFixed(1)}%
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--ink-3)]">
          <div
            className="h-full bg-[var(--primary)]"
            style={{ width: `${Math.min(100, Math.max(0, card.winProbPct))}%` }}
          />
        </div>
      </footer>
    </article>
  );
}

function Stat({
  label,
  value,
  mono = false,
  accent = false,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        {label}
      </dt>
      <dd
        className={
          (mono ? "font-mono tabular " : "") +
          (accent ? "font-display text-[16px] font-bold text-[var(--chalk-0)] " : "text-[var(--chalk-1)] ") +
          ""
        }
      >
        {value}
      </dd>
    </div>
  );
}
