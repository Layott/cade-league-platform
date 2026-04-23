"use client";

import type { CardSearchResult } from "@/server/fcdb/search";

/**
 * Plan 30 — FC-style card tile.
 *
 * Compact rectangle showing rating + position badge + name + nation. When
 * `card.cardImageUrl` is present (populated by the fut.gg image scraper,
 * `_scrape_futgg_images.js`), the full FUT card art is rendered at the
 * primary visual slot; otherwise we fall back to the solid-colour band
 * (75+ gold, 65-74 silver, <65 bronze; icon / hero / special get tints
 * that override the rating band).
 *
 * Size `sm` (used in the picker slot) is ~64×80. Size `md` (used in the
 * typeahead result row) is ~120×150.
 */

export type FutCardProps = {
  card: CardSearchResult | null;
  onClick?: () => void;
  size?: "sm" | "md";
  dataTestId?: string;
};

type Band = {
  bg: string;
  ring: string;
  text: string;
};

function bandFor(card: CardSearchResult): Band {
  const it = (card.itemType ?? "").toLowerCase();
  if (it === "icon") {
    return {
      bg: "bg-[#f0e5c3]",
      ring: "ring-1 ring-[#c8a94a]",
      text: "text-[#1f1a0d]",
    };
  }
  if (it === "hero") {
    return {
      bg: "bg-[#e7c4ff]",
      ring: "ring-1 ring-[#7a3bd1]",
      text: "text-[#1c0d2e]",
    };
  }
  if (it === "special" || it === "totw" || it === "evolution") {
    return {
      bg: "bg-[#0a0a0a]",
      ring: "ring-1 ring-[#fe036d]",
      text: "text-[#fff]",
    };
  }
  if (card.rating >= 75) {
    return {
      bg: "bg-[#c6a645]",
      ring: "ring-1 ring-[#8f7824]",
      text: "text-[#1c1504]",
    };
  }
  if (card.rating >= 65) {
    return {
      bg: "bg-[#a6a6a6]",
      ring: "ring-1 ring-[#6b6b6b]",
      text: "text-[#0a0a0a]",
    };
  }
  return {
    bg: "bg-[#a77d5a]",
    ring: "ring-1 ring-[#5e432b]",
    text: "text-[#1c1004]",
  };
}

export function FutCard({ card, onClick, size = "sm", dataTestId }: FutCardProps) {
  if (!card) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={dataTestId}
        className={
          "flex flex-col items-center justify-center rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-1)]/60 text-[var(--chalk-3)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)] " +
          (size === "md"
            ? "h-[150px] w-[120px] text-sm"
            : "h-[80px] w-[64px] text-xs")
        }
      >
        <span className="text-lg leading-none">+</span>
        <span className="mt-1 font-display uppercase tracking-[0.14em]">Add</span>
      </button>
    );
  }

  const band = bandFor(card);
  const dims =
    size === "md"
      ? "h-[150px] w-[120px] p-2"
      : "h-[80px] w-[64px] p-1";
  const ratingSize = size === "md" ? "text-2xl" : "text-lg";
  const nameSize = size === "md" ? "text-[11px]" : "text-[9px]";
  const variantSize = size === "md" ? "text-[9px]" : "text-[7px]";
  const hasPortrait = Boolean(card.cardImageUrl);
  // Fallback: if the row hasn't been re-scraped since the cardBgUrl
  // capture patch, synthesise the frame URL from the known variant label.
  // Real Futbin pattern (observed in scraped HTML, 2026-04-23):
  //   https://cdn3.futbin.com/content/fifa26/img/cards/tiny/{variant_underscored}.png
  // Variants are canonically stored hyphenated ("5-toty", "72-heroes",
  // "111-fantasy-fc"); Futbin's CDN uses underscores for the filename,
  // so convert on the way out.
  const fallbackFrameUrl =
    !card.cardBgUrl && card.variant
      ? `https://cdn3.futbin.com/content/fifa26/img/cards/tiny/${card.variant.toLowerCase().replace(/-/g, "_")}.png`
      : null;
  const frameUrl = card.cardBgUrl ?? fallbackFrameUrl;
  const hasFrame = Boolean(frameUrl);
  const hasImage = hasPortrait || hasFrame;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      data-card-id={card.id}
      title={`${card.name} — ${card.rating} — ${card.variant ?? "Normal"}`}
      className={
        `relative flex flex-col items-center justify-between overflow-hidden rounded-sm ${
          hasImage ? "bg-transparent" : band.bg
        } ${hasFrame ? "" : band.ring} ${band.text} ${dims} transition-transform hover:scale-[1.03]`
      }
    >
      {/* Card frame (gold/icon/hero/promo shell). Rendered FIRST so the
          portrait sits above it and the text overlays sit on top of both. */}
      {frameUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frameUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            // Frame URL was a guess (synthesised from variant) and the
            // CDN path didn't match. Hide so the portrait + band tile
            // can render cleanly instead.
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      {hasPortrait ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.cardImageUrl ?? ""}
          alt={`${card.name} ${card.rating} ${card.variant ?? ""}`.trim()}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      ) : null}

      <div className="relative flex w-full items-start justify-between">
        <div
          className={`font-display font-black leading-none ${ratingSize} ${
            hasImage ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" : ""
          }`}
        >
          {card.rating}
        </div>
        <div className="flex flex-col items-end">
          <div
            className={`text-[9px] font-semibold uppercase tracking-[0.14em] ${
              hasImage ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" : ""
            }`}
          >
            {card.position}
          </div>
          {card.nationIso ? (
            <div
              className={`mt-0.5 text-[8px] font-mono opacity-80 ${
                hasImage ? "text-white" : ""
              }`}
            >
              {card.nationIso}
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative w-full truncate text-center">
        <div
          className={`truncate font-display font-bold uppercase tracking-[0.08em] ${nameSize} ${
            hasImage ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" : ""
          }`}
        >
          {shortName(card.name)}
        </div>
        {card.variant ? (
          <div
            className={`truncate uppercase tracking-[0.14em] ${variantSize} ${
              hasImage ? "text-[#6bcd06] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" : "text-[var(--chalk-3)]"
            }`}
          >
            {card.variant}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return last.length >= 3 ? last : name;
}
