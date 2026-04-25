"use client";

import { useMemo, useState } from "react";
import { SecondaryButton } from "@/components/admin/buttons";
import { H2HPlayerPicker, type PickerPlayer } from "../_components/H2HPlayerPicker";
import {
  H2HComparisonCard,
  type H2HCard,
} from "../_components/H2HComparisonCard";

/**
 * Plan 51 — H2H Lookup tab client logic.
 *
 * Renders the player picker + N comparison cards. Refresh re-fetches
 * `/api/tournament/h2h?ids=a,b,c` so the user can re-pull live stats
 * mid-event without leaving the tab.
 */

export type H2HInitial = {
  players: PickerPlayer[];
  cards: H2HCard[]; // pre-rendered for the initial selection
  initialSelection: string[];
};

export function H2HLookupClient({
  players,
  cards,
  initialSelection,
}: H2HInitial) {
  const [selected, setSelected] = useState<string[]>(initialSelection);
  const [data, setData] = useState<H2HCard[]>(cards);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardsById = useMemo(
    () => new Map(data.map((c) => [c.playerId, c])),
    [data],
  );

  async function refresh(ids: string[]) {
    if (ids.length < 2) {
      setData([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `/api/tournament/h2h?ids=${ids.join(",")}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ""}`);
      }
      const body = (await res.json()) as { cards: H2HCard[] };
      setData(body.cards ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(next: string[]) {
    setSelected(next);
    void refresh(next);
  }

  const ordered = selected
    .map((id) => cardsById.get(id))
    .filter((c): c is H2HCard => Boolean(c));

  return (
    <section className="space-y-5" data-testid="h2h-lookup-client">
      <H2HPlayerPicker
        players={players}
        selected={selected}
        onChange={handleChange}
      />
      <div className="flex items-center gap-3">
        <SecondaryButton
          type="button"
          size="sm"
          disabled={loading || selected.length < 2}
          onClick={() => void refresh(selected)}
          data-testid="h2h-refresh"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </SecondaryButton>
        {error ? (
          <span role="alert" className="text-[11px] text-[var(--flare)]">
            {error}
          </span>
        ) : null}
      </div>

      {selected.length < 2 ? (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-8 text-center text-[12px] text-[var(--chalk-3)]">
          Select 2-5 players to compare.
        </div>
      ) : (
        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          data-testid="h2h-cards"
        >
          {ordered.map((c) => (
            <H2HComparisonCard key={c.playerId} card={c} />
          ))}
        </div>
      )}
    </section>
  );
}
