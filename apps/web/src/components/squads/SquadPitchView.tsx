"use client";

import { useMemo } from "react";
import { FutCard } from "./FutCard";
import {
  getFormationSlots,
  formationLabel,
  type FormationKey,
} from "./PitchLayout";
import type { CardSearchResult } from "@/server/fcdb/search";
import { inferFormationFromItems as inferFormationFromItemsImpl } from "./formationInference";

// Re-export the helper from its non-client home so existing client-side
// imports of `inferFormationFromItems` from this module keep working.
// Server Components MUST import from `./formationInference` directly.
export { inferFormationFromItemsImpl as inferFormationFromItems };

/**
 * Read-only Futbin-style pitch visualizer for submitted squads.
 *
 * Mirrors the SquadPickerBuilder's pitch layout so the player, admin, and
 * public profile views all see the same card-on-pitch shape a player drew
 * up in the picker. No drag, no click-to-replace — purely a display.
 *
 * Given `squad_player_items` rows (with an optional `fc_player` join into
 * `fc26_players`), the view:
 *   1. Infers a formation from the saved slot positions (Plan 10 change
 *      request already stores `new_formation` but the original submission
 *      has no formation column — we infer using the same heuristic as
 *      /player/squad/change and enrich it by matching the full position
 *      tuple against the 21 known formations).
 *   2. Places each card at its canonical pitch coordinate for that
 *      formation, with the card's `FutCard` tile stacked over a subs
 *      strip below the pitch (slot_index >= 11).
 *   3. Falls back to the solid-colour gold/silver/bronze band when the
 *      joined `fc_player` row is missing the Futbin CDN art URLs
 *      (Kaggle / fut.gg dormant rows — no portraits scraped).
 *
 * The shape of `items` is intentionally loose (only what's read off the
 * list queries + picker submit payload) so callers don't have to massage
 * their own shape first.
 */

export type SquadPitchViewItem = {
  id: string;
  slot_index: number;
  name: string;
  rating: number;
  /** Lineup position (e.g. "CB", "LW") — the slot role the player played. */
  position: string;
  item_type: string;
  nationality_flag: string | null;
  /** Optional enrichment from fc26_players via `resolved_fc_player_id`. */
  fc_player?: {
    id: string;
    name: string;
    rating: number;
    position: string;
    item_type: string;
    nation_iso: string | null;
    nation: string | null;
    attributes: Record<string, unknown> | null;
  } | null;
};

export type SquadPitchViewProps = {
  items: SquadPitchViewItem[];
  /** Override the inferred formation (e.g. a Plan 10 change request row
   *  saved a new_formation value). Leave undefined for the auto-inference
   *  path. */
  formation?: FormationKey;
  /** Compact mode for inline admin displays — renders a 420px-wide pitch
   *  instead of the default 560px. */
  compact?: boolean;
};

export function SquadPitchView({
  items,
  formation: formationOverride,
  compact = false,
}: SquadPitchViewProps) {
  const starters = useMemo(
    () => items.filter((it) => it.slot_index >= 0 && it.slot_index <= 10),
    [items],
  );
  const subs = useMemo(
    () =>
      items
        .filter((it) => it.slot_index >= 11)
        .sort((a, b) => a.slot_index - b.slot_index),
    [items],
  );

  const formation = useMemo<FormationKey>(() => {
    if (formationOverride) return formationOverride;
    return inferFormationFromItemsImpl(starters);
  }, [formationOverride, starters]);

  const slotDefs = getFormationSlots(formation);
  const itemBySlot = useMemo(() => {
    const m = new Map<number, SquadPitchViewItem>();
    for (const it of starters) m.set(it.slot_index, it);
    return m;
  }, [starters]);

  const pitchClass = compact
    ? "relative mx-auto aspect-[3/4] w-full max-w-[420px] overflow-hidden rounded-sm border border-[var(--ink-4)] bg-gradient-to-b from-[#0d2417] via-[#0a1c12] to-[#081a10]"
    : "relative mx-auto aspect-[3/4] w-full max-w-[560px] overflow-hidden rounded-sm border border-[var(--ink-4)] bg-gradient-to-b from-[#0d2417] via-[#0a1c12] to-[#081a10]";

  return (
    <div
      data-testid="squad-pitch-view"
      data-formation={formation}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Formation
        </div>
        <div
          className="font-display text-sm font-bold tracking-[0.12em] text-[var(--chalk-0)]"
          data-testid="squad-pitch-formation-label"
        >
          {formationLabel(formation)}
        </div>
      </div>

      <div className={pitchClass}>
        {/* Field markings — kept in sync with PitchLayout. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-[5%] right-[5%] top-[50%] border-t border-[rgba(254,3,109,0.45)]" />
          <div className="absolute left-1/2 top-1/2 h-[18%] w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(254,3,109,0.45)]" />
          <div className="absolute left-[22%] right-[22%] top-[2%] h-[14%] border-b border-l border-r border-[rgba(254,3,109,0.45)]" />
          <div className="absolute left-[22%] right-[22%] bottom-[2%] h-[14%] border-l border-r border-t border-[rgba(254,3,109,0.45)]" />
        </div>

        {slotDefs.map((s) => {
          const it = itemBySlot.get(s.slotIndex) ?? null;
          const card = it ? toCardLike(it) : null;
          return (
            <div
              key={s.slotIndex}
              style={{ top: `${s.top}%`, left: `${s.left}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
            >
              <div className="flex flex-col items-center gap-0.5">
                <FutCard
                  card={card}
                  size="sm"
                  dataTestId={`squad-pitch-slot-${s.slotIndex}`}
                />
                <span className="rounded-sm bg-black/40 px-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/80">
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {subs.length > 0 ? (
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Subs
          </div>
          <div
            className="mt-2 flex flex-wrap gap-3"
            data-testid="squad-pitch-subs"
          >
            {subs.map((it) => (
              <div
                key={it.id}
                className="flex flex-col items-center gap-1"
                data-testid={`squad-pitch-sub-${it.slot_index}`}
              >
                <FutCard card={toCardLike(it)} size="sm" />
                <span className="rounded-sm bg-black/30 px-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--chalk-3)]">
                  {it.position}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// `inferFormationFromItems` extracted to ./formationInference (non-client).
// Re-exported via the module-top `export { ... }` so client callers keep
// the same import path.

/**
 * Shape a squad_player_items row (with optional fc26_players join) into
 * the `CardSearchResult` the FutCard component expects. When the join is
 * missing (legacy / dormant row) we synthesize a minimal CardSearchResult
 * so FutCard still renders the rating-band tile with the item-level name.
 */
function toCardLike(it: SquadPitchViewItem): CardSearchResult {
  const fc = it.fc_player ?? null;
  const attrs =
    fc?.attributes && typeof fc.attributes === "object"
      ? (fc.attributes as Record<string, unknown>)
      : null;
  const cardImageUrl =
    attrs && typeof attrs.card_image_url === "string"
      ? (attrs.card_image_url as string)
      : null;
  const cardBgUrl =
    attrs && typeof attrs.card_bg_url === "string"
      ? (attrs.card_bg_url as string)
      : null;
  const futbinVariant =
    attrs && typeof attrs.futbin_variant === "string"
      ? (attrs.futbin_variant as string)
      : null;
  const futggVariant =
    attrs && typeof attrs.futgg_variant === "string"
      ? (attrs.futgg_variant as string)
      : null;

  // Prefer the FC-catalog data when available, otherwise fall back to the
  // denormalised item columns (always populated at submit time).
  const rating = fc?.rating ?? it.rating;
  const itemType = fc?.item_type ?? it.item_type;
  const nationIso = fc?.nation_iso ?? it.nationality_flag;
  const nation = fc?.nation ?? null;
  const name = fc?.name ?? it.name;

  return {
    id: fc?.id ?? it.id,
    slug: fc?.id ?? it.id,
    name,
    rating,
    // Use the lineup position from the saved slot, not the card's
    // canonical position — matches what the picker displayed.
    position: it.position,
    positionsAlt: [],
    club: null,
    league: null,
    nation,
    nationIso,
    itemType,
    priceCoins: null,
    cardImageUrl,
    cardBgUrl,
    variant:
      futbinVariant ??
      futggVariant ??
      (itemType && itemType !== "normal" ? itemType : null),
    mainStats: null,
    weakFoot: null,
    skillMoves: null,
    metaRating: null,
    futbinNationId: null,
    futbinLeagueId: null,
    futbinClubId: null,
  };
}
