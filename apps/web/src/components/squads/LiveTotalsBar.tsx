"use client";

import { useMemo, useState } from "react";
import { computeChemistry, type SlotFill, type ChemistryCard } from "@/lib/chemistry";
import type { CardSearchResult } from "@/server/fcdb/search";
import {
  getFormationSlots,
  type FormationKey,
} from "./PitchLayout";

/**
 * Futbin's internal nation_id for Nigeria (FC26). Env-driven so it can
 * be flipped if Futbin's registry shifts between FC years — default 133
 * matches Nigeria's ID in earlier FIFA titles and is the current best
 * guess for FC26. NEXT_PUBLIC_ so it's readable client-side.
 *
 * Counterpart on the server: `server/squads/validate.ts`. Keep in sync.
 */
const NG_FUTBIN_NATION_ID: number = (() => {
  const raw = process.env.NEXT_PUBLIC_NG_FUTBIN_NATION_ID;
  if (!raw) return 133;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 133;
})();

/**
 * Plan 30.1 — always-visible totals bar.
 *
 * Reads the parent's picker state (slot map + subs array + formation), computes:
 *   - Coins spent / budget cap
 *   - Nigerian card count (by `nationIso === 'NG'`)
 *   - Chemistry (full FC26 rules — tier-based, positional gate, icon/hero)
 *   - Banned-type violations (count of cards whose itemType ∈ bannedTypes)
 *
 * Null prices render as "—" and a "some prices missing" warning renders
 * once per squad — the submission is still allowed; ref review flags it.
 *
 * Out-of-position warnings surface as an amber strip under the totals bar.
 */

export type LiveTotalsRule = {
  maxBudgetCoins: number;
  minNigerianItems: number;
  bannedItemTypes: string[];
};

export type LiveTotalsBarProps = {
  slots: Record<number, CardSearchResult | null>;
  subs: Array<CardSearchResult | null>;
  rule: LiveTotalsRule | null;
  /** Optional — required for full FC26 chemistry (positional gate). If
   * omitted, chem falls back to 0 and a note is shown. */
  formation?: FormationKey;
};

function formatCoins(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  return String(n);
}

function cardToChem(card: CardSearchResult): ChemistryCard {
  return {
    club: card.club,
    league: card.league,
    nation: card.nation,
    position: card.position,
    positionsAlt: card.positionsAlt,
    itemType: card.itemType,
    // Pass the Futbin variant slug so deriveChemBonus() recognizes
    // promo subclasses (Cornerstones, Festival Captains, Heroes, etc.)
    // and applies their non-default chem-symbol contributions.
    variant: card.variant,
    name: card.name,
  };
}

export function LiveTotalsBar({ slots, subs, rule, formation }: LiveTotalsBarProps) {
  const [chemBreakdownOpen, setChemBreakdownOpen] = useState(false);

  const totals = useMemo(() => {
    // Slot 0 = goalkeeper. GK is excluded from both the budget and the
    // Nigerian-minimum counts per league rules (mirrors the server-side
    // logic in server/squads/validate.ts).
    const starterEntries = Object.entries(slots)
      .map(([k, c]) => ({ slot: Number(k), card: c }))
      .filter((e): e is { slot: number; card: CardSearchResult } => !!e.card);
    const nonGkStarters = starterEntries.filter((e) => e.slot !== 0);
    const gkStarter = starterEntries.find((e) => e.slot === 0)?.card ?? null;
    const benched = subs.filter((c): c is CardSearchResult => !!c);

    let coins = 0;
    let priceMissing = 0;
    let nigerianCount = 0;
    const bannedSet = new Set(
      (rule?.bannedItemTypes ?? []).map((t) => t.toLowerCase()),
    );
    let bannedCount = 0;

    // Coins: sum over non-GK starters + ALL subs (GK excluded only for the
    //   starting XI position).
    // Nigerian: ONLY non-GK starters (slot 1..10). Subs do NOT count toward
    //   the "min N Nigerian in starting XI" rule — this matches
    //   `server/squads/validate.ts` which filters to slotIndex 0..10 and
    //   then excludes slot 0.
    const isNG = (c: CardSearchResult) => {
      // Futbin-internal nation_id wins when present — authoritative
      // because the scrapers pull it from Futbin's CDN-keyed nation icon.
      if (c.futbinNationId != null && c.futbinNationId === NG_FUTBIN_NATION_ID) {
        return true;
      }
      const iso = (c.nationIso ?? "").toUpperCase();
      if (iso === "NG" || iso === "NGA") return true;
      // Futbin frequently leaves nation_iso empty but fills `nation` with
      // the country name. Accept that too.
      return (c.nation ?? "").trim().toLowerCase() === "nigeria";
    };
    for (const { card: c } of nonGkStarters) {
      if (c.priceCoins == null) priceMissing += 1;
      else coins += c.priceCoins;
      if (isNG(c)) nigerianCount += 1;
    }
    for (const c of benched) {
      if (c.priceCoins == null) priceMissing += 1;
      else coins += c.priceCoins;
      // NOTE: bench Nigerian cards do NOT count toward the minimum.
    }

    // Banned-type check DOES include GK — a banned keeper is still banned.
    const allCards = [
      ...starterEntries.map((e) => e.card),
      ...benched,
    ];
    for (const c of allCards) {
      if (bannedSet.has((c.itemType ?? "").toLowerCase())) bannedCount += 1;
    }
    // Avoid shadow-reporting the GK as price-missing when it's actually present
    // (price_missing counter only matters for budget cards — i.e. non-GK).
    if (gkStarter && gkStarter.priceCoins == null) {
      // GK is price-missing but doesn't count toward coins; still flag for
      // transparency so the player knows their GK price is unknown — mirror
      // behaviour matches what players expect.
      priceMissing += 1;
    }

    // Full FC26 chemistry requires the formation (for per-slot position
    // codes). If it's not given (should not happen in practice — picker
    // always passes it), default to 0 with a note.
    let totalChem = 0;
    let warnings: string[] = [];
    let perSlot: number[] = [];
    if (formation) {
      const defs = getFormationSlots(formation);
      const starting: SlotFill[] = defs.map((d) => {
        const c = slots[d.slotIndex] ?? null;
        return {
          card: c ? cardToChem(c) : null,
          positionInLineup: d.label,
        };
      });
      const subFills: SlotFill[] = subs.map((c) => ({
        card: c ? cardToChem(c) : null,
        // Subs don't have a lineup position — we use the card's canonical
        // position so an in-pos-for-their-own-position sub can still earn
        // tier chem. If no card, use an empty string so null slots yield 0.
        positionInLineup: c ? c.position : "",
      }));
      const chem = computeChemistry(starting, formation, subFills);
      totalChem = chem.totalChem;
      warnings = chem.warnings;
      perSlot = chem.perSlot;
    }

    return {
      coins,
      priceMissing,
      nigerianCount,
      bannedCount,
      totalChem,
      warnings,
      perSlot,
    };
  }, [slots, subs, rule, formation]);

  const overBudget =
    rule != null && totals.coins > rule.maxBudgetCoins;
  const shortNigerian =
    rule != null && totals.nigerianCount < rule.minNigerianItems;

  const formationDefs = formation ? getFormationSlots(formation) : [];

  return (
    <div
      data-testid="live-totals-bar"
      className="sticky top-4 flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3 text-xs"
    >
      <div className="grid grid-cols-4 gap-3">
        <Stat
          label="Coins"
          value={`${formatCoins(totals.coins)}${rule ? " / " + formatCoins(rule.maxBudgetCoins) : ""}`}
          accent={overBudget ? "warn" : "ok"}
          testId="totals-coins"
        />
        <Stat
          label="Nigerian"
          value={`${totals.nigerianCount}${rule ? " / " + rule.minNigerianItems : ""}`}
          accent={shortNigerian ? "warn" : "ok"}
          testId="totals-nigerian"
        />
        <button
          type="button"
          onClick={() => setChemBreakdownOpen((o) => !o)}
          className="text-left"
          data-testid="totals-chem-toggle"
          aria-expanded={chemBreakdownOpen}
        >
          <Stat
            label="Chem"
            value={`${totals.totalChem}/33`}
            accent="ok"
            testId="totals-chem"
          />
        </button>
        <Stat
          label="Banned"
          value={String(totals.bannedCount)}
          accent={totals.bannedCount > 0 ? "warn" : "ok"}
          testId="totals-banned"
        />
      </div>

      {chemBreakdownOpen && formation ? (
        <div
          data-testid="totals-chem-breakdown"
          className="rounded-sm bg-[var(--ink-3)] px-2 py-1 text-[10px] text-[var(--chalk-2)]"
        >
          <div className="mb-1 font-semibold uppercase tracking-[0.14em] text-[var(--chalk-3)]">
            Per-slot chem
          </div>
          <div className="grid grid-cols-4 gap-x-3 gap-y-0.5">
            {formationDefs.map((d, i) => (
              <div key={d.slotIndex} className="flex justify-between font-mono">
                <span className="text-[var(--chalk-3)]">{d.label}</span>
                <span className="text-[var(--chalk-1)]">
                  {totals.perSlot[i] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {totals.warnings.length > 0 ? (
        <div
          data-testid="totals-chem-warnings"
          className="rounded-sm border border-[#ffb020] bg-[rgba(255,176,32,0.08)] px-2 py-1 text-[11px] text-[#ffcc4d]"
        >
          <div className="font-semibold uppercase tracking-[0.14em]">
            {totals.warnings.length} card
            {totals.warnings.length === 1 ? "" : "s"} out of position — chem
            penalty applies
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {totals.warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {totals.warnings.length > 5 ? (
              <li className="italic">
                +{totals.warnings.length - 5} more…
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {totals.priceMissing > 0 ? (
        <div
          data-testid="totals-price-missing"
          className="rounded-sm bg-[var(--ink-3)] px-2 py-1 text-[11px] text-[var(--chalk-2)]"
        >
          {totals.priceMissing} card(s) missing price data — coins total is
          an undercount. Ref will validate.
        </div>
      ) : null}
      <div className="text-[10px] italic text-[var(--chalk-3)]">
        Chemistry is indicative; final verdict is the ref&apos;s.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  testId,
}: {
  label: string;
  value: string;
  accent: "ok" | "warn";
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-start rounded-sm bg-[var(--ink-1)] px-2 py-1"
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </span>
      <span
        className={
          "mt-0.5 font-display text-sm font-bold " +
          (accent === "warn" ? "text-[var(--flare)]" : "text-[var(--chalk-0)]")
        }
      >
        {value}
      </span>
    </div>
  );
}
