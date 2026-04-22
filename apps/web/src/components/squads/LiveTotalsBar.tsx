"use client";

import { useMemo } from "react";
import { calculateChemistry } from "@/lib/chemistry";
import type { CardSearchResult } from "@/server/fcdb/search";

/**
 * Plan 30 — always-visible totals bar.
 *
 * Reads the parent's picker state (slot map + subs array), computes:
 *   - Coins spent / budget cap
 *   - Nigerian card count (by `nationIso === 'NG'`)
 *   - Chemistry (simplified heuristic)
 *   - Banned-type violations (count of cards whose itemType ∈ bannedTypes)
 *
 * Null prices render as "—" and a "some prices missing" warning renders
 * once per squad — the submission is still allowed; ref review flags it.
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
};

function formatCoins(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  return String(n);
}

export function LiveTotalsBar({ slots, subs, rule }: LiveTotalsBarProps) {
  const allCards = useMemo(() => {
    const starters = Object.values(slots).filter(
      (c): c is CardSearchResult => !!c,
    );
    const benched = subs.filter((c): c is CardSearchResult => !!c);
    return [...starters, ...benched];
  }, [slots, subs]);

  const totals = useMemo(() => {
    let coins = 0;
    let priceMissing = 0;
    let nigerianCount = 0;
    const bannedSet = new Set(
      (rule?.bannedItemTypes ?? []).map((t) => t.toLowerCase()),
    );
    let bannedCount = 0;
    for (const c of allCards) {
      if (c.priceCoins == null) priceMissing += 1;
      else coins += c.priceCoins;
      if ((c.nationIso ?? "").toUpperCase() === "NG") nigerianCount += 1;
      if (bannedSet.has((c.itemType ?? "").toLowerCase())) bannedCount += 1;
    }
    const chem = calculateChemistry(
      allCards.map((c) => ({
        club: c.club,
        league: c.league,
        nation: c.nation,
      })),
    );
    return { coins, priceMissing, nigerianCount, bannedCount, chem };
  }, [allCards, rule]);

  const overBudget =
    rule != null && totals.coins > rule.maxBudgetCoins;
  const shortNigerian =
    rule != null && totals.nigerianCount < rule.minNigerianItems;

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
        <Stat
          label="Chem"
          value={String(totals.chem)}
          accent="ok"
          testId="totals-chem"
        />
        <Stat
          label="Banned"
          value={String(totals.bannedCount)}
          accent={totals.bannedCount > 0 ? "warn" : "ok"}
          testId="totals-banned"
        />
      </div>
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
