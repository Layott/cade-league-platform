"use client";

import { useEffect } from "react";
import type { CardSearchResult } from "@/server/fcdb/search";
import { FutCard } from "./FutCard";

/**
 * Card inspector modal — opens from CardSearchDialog or FutCard.
 *
 * Shows the enlarged card (frame + portrait composite), the 6 main stats
 * as a Futbin-style grid, weak-foot + skill-moves stars, Futbin meta
 * rating, and price. Click Pick → picks the card + closes. ESC closes.
 */

type Props = {
  card: CardSearchResult | null;
  onClose: () => void;
  onPick?: () => void;
};

function Stat({ label, value }: { label: string; value: number | null }) {
  const shown = value == null ? "—" : value;
  const tone =
    value == null
      ? "text-[var(--chalk-3)]"
      : value >= 85
        ? "text-[var(--signal)]"
        : value >= 70
          ? "text-[var(--chalk-0)]"
          : "text-[var(--chalk-2)]";
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--ink-4)] py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        {label}
      </span>
      <span className={`font-display text-xl font-black tabular ${tone}`}>{shown}</span>
    </div>
  );
}

function Stars({ count }: { count: number | null }) {
  const n = count ?? 0;
  return (
    <span className="font-display text-base tracking-wide text-[#ffb020]">
      {"★".repeat(n)}
      <span className="text-[var(--ink-4)]">{"★".repeat(Math.max(0, 5 - n))}</span>
    </span>
  );
}

export function CardDetailModal({ card, onClose, onPick }: Props) {
  useEffect(() => {
    if (!card) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [card, onClose]);

  if (!card) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-detail-title"
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="card-detail-modal"
    >
      <div className="w-full max-w-xl rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-5 shadow-2xl">
        <div className="flex items-start gap-5">
          <div className="flex-shrink-0">
            <FutCard card={card} size="md" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="card-detail-title"
              className="truncate font-display text-xl font-bold text-[var(--chalk-0)]"
            >
              {card.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-baseline gap-3 text-[11px] uppercase tracking-[0.14em] text-[var(--chalk-2)]">
              <span className="font-display text-xl font-black text-[var(--chalk-0)]">
                {card.rating}
              </span>
              <span>{card.position}</span>
              {card.positionsAlt.length > 0 ? (
                <span className="text-[var(--chalk-3)]">
                  alt: {card.positionsAlt.join(" / ")}
                </span>
              ) : null}
              {card.variant ? (
                <span className="text-[var(--signal)]">{card.variant}</span>
              ) : null}
            </div>
            <div className="mt-1 text-[11px] text-[var(--chalk-2)]">
              {card.club ?? "—"} · {card.league ?? "—"} · {card.nation ?? "—"}
            </div>
            {card.priceCoins != null ? (
              <div className="mt-2 font-mono text-sm text-[var(--chalk-0)]">
                {card.priceCoins.toLocaleString()} <span className="text-[var(--chalk-3)]">coins</span>
              </div>
            ) : (
              <div className="mt-2 font-mono text-xs text-[var(--chalk-3)]">price unknown</div>
            )}
          </div>
        </div>

        {card.mainStats ? (
          <div className="mt-5 grid grid-cols-3 gap-x-5">
            <Stat label="PAC" value={card.mainStats.pac} />
            <Stat label="SHO" value={card.mainStats.sho} />
            <Stat label="PAS" value={card.mainStats.pas} />
            <Stat label="DRI" value={card.mainStats.dri} />
            <Stat label="DEF" value={card.mainStats.def} />
            <Stat label="PHY" value={card.mainStats.phy} />
          </div>
        ) : (
          <p className="mt-5 text-xs text-[var(--chalk-3)]">
            Main stats not yet captured — rescrape this card to populate.
          </p>
        )}

        <div className="mt-5 grid grid-cols-3 gap-x-5 text-[11px]">
          <div className="flex flex-col">
            <span className="uppercase tracking-[0.18em] text-[var(--chalk-3)]">Weak foot</span>
            <Stars count={card.weakFoot} />
          </div>
          <div className="flex flex-col">
            <span className="uppercase tracking-[0.18em] text-[var(--chalk-3)]">Skill moves</span>
            <Stars count={card.skillMoves} />
          </div>
          {card.metaRating ? (
            <div className="flex flex-col">
              <span className="uppercase tracking-[0.18em] text-[var(--chalk-3)]">Futbin meta</span>
              <span className="font-display text-base font-bold text-[var(--chalk-0)]">
                {card.metaRating}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--chalk-1)]"
          >
            Close
          </button>
          {onPick ? (
            <button
              type="button"
              onClick={onPick}
              data-testid="card-detail-pick"
              className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--primary-ink)] transition-colors hover:bg-[#82e21a]"
            >
              Pick this card
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
