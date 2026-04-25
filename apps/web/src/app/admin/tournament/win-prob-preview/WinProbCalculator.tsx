"use client";

import { useEffect, useState } from "react";
import { SecondaryButton } from "@/components/admin/buttons";

/**
 * Plan 51 — Win-Prob Preview calculator.
 *
 * Pick A + B from the 13-player dropdown. The component fetches
 * /api/tournament/win-probability and renders the formula breakdown
 * (H2H 0.4 + Season 0.4 + Last5 0.2) plus the final pA/pB/pDraw triple
 * with progress bars. Auto-refetches whenever A or B changes.
 */

export type CalcPlayer = { id: string; name: string; gamerTag: string };

type ApiResponse = {
  a: CalcPlayer;
  b: CalcPlayer;
  breakdown: {
    h2hScoreA: number | null;
    seasonScoreA: number;
    last5ScoreA: number;
    seasonScoreB: number;
    last5ScoreB: number;
    weights: { h2h: number; season: number; last5: number };
    h2hRecord: {
      totalMatches: number;
      aWins: number;
      bWins: number;
      draws: number;
    } | null;
  };
  probability: { pA: number; pB: number; pDraw: number };
};

export function WinProbCalculator({
  players,
  defaultA,
  defaultB,
}: {
  players: CalcPlayer[];
  defaultA: string;
  defaultB: string;
}) {
  const [aId, setAId] = useState(defaultA);
  const [bId, setBId] = useState(defaultB);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aId || !bId || aId === bId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/tournament/win-probability?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status}${t ? `: ${t}` : ""}`);
        }
        return (await r.json()) as ApiResponse;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Calc failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aId, bId]);

  function swap() {
    setAId(bId);
    setBId(aId);
  }

  return (
    <section className="space-y-5" data-testid="win-prob-calculator">
      <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-[1fr_auto_1fr]">
        <PlayerSelect
          label="Player A"
          name="a"
          value={aId}
          onChange={setAId}
          players={players}
          excludeId={bId}
          testId="winprob-a"
        />
        <SecondaryButton
          type="button"
          size="sm"
          onClick={swap}
          data-testid="winprob-swap"
        >
          ⇄ Swap
        </SecondaryButton>
        <PlayerSelect
          label="Player B"
          name="b"
          value={bId}
          onChange={setBId}
          players={players}
          excludeId={aId}
          testId="winprob-b"
        />
      </div>

      {aId === bId ? (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-4 text-center text-[12px] text-[var(--chalk-3)]">
          Pick two different players.
        </div>
      ) : loading && !data ? (
        <div className="text-center text-[12px] text-[var(--chalk-3)]">
          Computing...
        </div>
      ) : error ? (
        <div role="alert" className="text-[12px] text-[var(--flare)]">
          {error}
        </div>
      ) : data ? (
        <Breakdown data={data} />
      ) : null}
    </section>
  );
}

function PlayerSelect({
  label,
  name,
  value,
  onChange,
  players,
  excludeId,
  testId,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (id: string) => void;
  players: CalcPlayer[];
  excludeId: string;
  testId: string;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </span>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
        data-testid={testId}
      >
        {players.map((p) => (
          <option key={p.id} value={p.id} disabled={p.id === excludeId}>
            {p.gamerTag} ({p.name})
          </option>
        ))}
      </select>
    </label>
  );
}

function Breakdown({ data }: { data: ApiResponse }) {
  const { breakdown, probability, a, b } = data;
  const wpA = probability.pA * 100;
  const wpB = probability.pB * 100;
  const wpDraw = probability.pDraw * 100;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 md:grid-cols-3">
        <ProbCell
          label={`${a.gamerTag || a.name} wins`}
          pct={wpA}
          color="primary"
          testId="prob-a"
        />
        <ProbCell label="Draw" pct={wpDraw} color="neutral" testId="prob-draw" />
        <ProbCell
          label={`${b.gamerTag || b.name} wins`}
          pct={wpB}
          color="secondary"
          testId="prob-b"
        />
      </div>

      <details className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]/60" open>
        <summary className="cursor-pointer px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] hover:text-[var(--chalk-0)]">
          Formula breakdown
        </summary>
        <div className="space-y-3 px-4 py-3 text-[12px] text-[var(--chalk-1)]">
          <p className="text-[11px] leading-relaxed text-[var(--chalk-2)]">
            <code className="text-[var(--primary)]">strength = 0.4·H2H + 0.4·Season + 0.2·Last5</code>{" "}
            (when no H2H history, falls back to{" "}
            <code className="text-[var(--primary)]">0.6·Season + 0.4·Last5</code>).
          </p>
          <BreakdownRow
            label="H2H score A"
            value={breakdown.h2hScoreA}
            weight={breakdown.weights.h2h}
            note={
              breakdown.h2hRecord
                ? `${breakdown.h2hRecord.aWins}W-${breakdown.h2hRecord.draws}D-${breakdown.h2hRecord.bWins}L · ${breakdown.h2hRecord.totalMatches} matches`
                : "no prior matches"
            }
          />
          <BreakdownRow
            label="Season score A"
            value={breakdown.seasonScoreA}
            weight={breakdown.weights.season}
          />
          <BreakdownRow
            label="Last-5 score A"
            value={breakdown.last5ScoreA}
            weight={breakdown.weights.last5}
          />
          <hr className="border-[var(--ink-4)]" />
          <BreakdownRow
            label="Season score B"
            value={breakdown.seasonScoreB}
            weight={breakdown.weights.season}
          />
          <BreakdownRow
            label="Last-5 score B"
            value={breakdown.last5ScoreB}
            weight={breakdown.weights.last5}
          />
        </div>
      </details>
    </div>
  );
}

function ProbCell({
  label,
  pct,
  color,
  testId,
}: {
  label: string;
  pct: number;
  color: "primary" | "secondary" | "neutral";
  testId?: string;
}) {
  const fill =
    color === "primary"
      ? "bg-[var(--primary)]"
      : color === "secondary"
        ? "bg-[#fe036d]"
        : "bg-[var(--ink-4)]";
  const text =
    color === "primary"
      ? "text-[var(--primary)]"
      : color === "secondary"
        ? "text-[#fe036d]"
        : "text-[var(--chalk-1)]";
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          {label}
        </span>
        <span className={`font-mono text-[18px] font-bold tabular ${text}`}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--ink-3)]">
        <div
          className={`h-full ${fill}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  weight,
  note,
}: {
  label: string;
  value: number | null;
  weight: number;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono tabular">
      <span className="text-[11px] text-[var(--chalk-3)]">
        {label} {note ? <span className="ml-2 text-[10px]">({note})</span> : null}
      </span>
      <span className="text-[11px] text-[var(--chalk-1)]">
        {value === null ? "—" : value.toFixed(3)}{" "}
        <span className="text-[var(--chalk-3)]">× {weight.toFixed(1)}</span>
      </span>
    </div>
  );
}
