"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { getPlayerAvatarUrl } from "@/lib/player-photos";

/**
 * Plan 51 — live-refreshing standings table.
 *
 * The server component does the initial render with `initialRows`; this
 * client component subscribes to `public:standings:<seasonId>` for the
 * `standings.changed` event, debounces the burst, and re-fetches the
 * tiebreaker-sorted standings via `/api/tournament/leaderboard?seasonId=...`.
 *
 * "Form (last 5)" is rendered as colored W/D/L pills derived from the most
 * recent five confirmed match_results for each player. Form is computed
 * server-side and ships as the `form` string ("WDLWW") on each row.
 */

export type LeaderboardRow = {
  pos: number;
  playerId: string;
  name: string;
  gamerTag: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  form: string; // up-to-10-char string of W/D/L (2026-05-10: expanded from 5 to 10)
  pointsAdj: number; // -3pts style abbreviation feeder
  gdAdj: number;
};

const COLS: Array<{ key: string; label: string; align?: "left" | "center" | "right" }> = [
  { key: "pos", label: "Pos", align: "center" },
  { key: "player", label: "Player" },
  { key: "p", label: "P", align: "center" },
  { key: "wdl", label: "W-D-L", align: "center" },
  { key: "gf", label: "GF", align: "center" },
  { key: "ga", label: "GA", align: "center" },
  { key: "gd", label: "GD", align: "center" },
  // 2026-05-15 — DED column surfaces disciplinary deductions on both
  // points + goal difference so the impact baked into Pts + GD is
  // visible at a glance. "—" when the player has no live deduction.
  { key: "ded", label: "DED", align: "center" },
  { key: "pts", label: "Pts", align: "center" },
  { key: "form", label: "Form", align: "center" },
];

export function LiveLeaderboard({
  seasonId,
  initialRows,
}: {
  seasonId: string | null;
  initialRows: LeaderboardRow[];
}) {
  const [rows, setRows] = useState<LeaderboardRow[]>(initialRows);
  const inflightRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useMemo(
    () => async () => {
      if (!seasonId) return;
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const res = await fetch(
          `/api/tournament/leaderboard?seasonId=${encodeURIComponent(seasonId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { rows: LeaderboardRow[] };
        if (Array.isArray(body.rows)) setRows(body.rows);
      } catch {
        // best-effort — original render survives
      } finally {
        inflightRef.current = false;
      }
    },
    [seasonId],
  );

  useEffect(() => {
    if (!seasonId) return;
    const sb = getBrowserSupabase();
    const ch = sb.channel(`public:standings:${seasonId}`, {
      config: { broadcast: { self: false } },
    });
    const onEvent = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void refetch(), 200);
    };
    ch.on("broadcast", { event: "standings.changed" }, onEvent);
    ch.on("broadcast", { event: "score.changed" }, onEvent);
    ch.on("broadcast", { event: "walkover.confirmed" }, onEvent);
    ch.subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try {
        sb.removeChannel(ch);
      } catch {
        /* best-effort */
      }
    };
  }, [seasonId, refetch]);

  if (!seasonId) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-8 text-center text-[12px] text-[var(--chalk-3)]">
        No active season — start the season to see standings.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="live-leaderboard"
    >
      <table className="w-full text-sm text-[var(--chalk-1)]">
        <thead>
          <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60">
            {COLS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={
                  "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] " +
                  (c.align === "right"
                    ? "text-right "
                    : c.align === "center"
                      ? "text-center "
                      : "text-left ")
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLS.length} className="px-4 py-8 text-center text-[12px] text-[var(--chalk-3)]">
                No standings rows yet — they appear after the first result is entered.
              </td>
            </tr>
          ) : (
            rows.map((r, idx) => (
              <tr
                key={r.playerId}
                data-testid={`standings-row-${r.playerId}`}
                className={
                  "border-b border-[var(--ink-4)]/70 last:border-b-0 " +
                  (idx % 2 === 1 ? "bg-[var(--ink-3)]/30" : "")
                }
              >
                <td className="px-3 py-3 text-center font-mono text-[12px] tabular text-[var(--chalk-2)]">
                  {r.pos}
                </td>
                <td className="px-3 py-3">
                  <PlayerCell name={r.name} gamerTag={r.gamerTag} />
                </td>
                <td className="px-3 py-3 text-center font-mono tabular">{r.played}</td>
                <td className="px-3 py-3 text-center font-mono tabular text-[12px]">
                  {r.wins}-{r.draws}-{r.losses}
                </td>
                <td className="px-3 py-3 text-center font-mono tabular">{r.gf}</td>
                <td className="px-3 py-3 text-center font-mono tabular">{r.ga}</td>
                <td className="px-3 py-3 text-center font-mono tabular">
                  {r.gd > 0 ? `+${r.gd}` : r.gd}
                </td>
                <td className="px-3 py-3 text-center">
                  <DedCell pointsAdj={r.pointsAdj} gdAdj={r.gdAdj} />
                </td>
                <td className="px-3 py-3 text-center font-mono tabular font-semibold text-[var(--chalk-0)]">
                  {r.pts}
                </td>
                <td className="px-3 py-3 text-center">
                  <FormPills form={r.form} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function PlayerCell({
  name,
  gamerTag,
}: {
  name: string;
  gamerTag: string;
}) {
  const photo = getPlayerAvatarUrl(gamerTag);
  return (
    <div className="flex items-center gap-3">
      <span className="relative inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[var(--ink-3)]">
        {photo ? (
          <Image
            src={photo}
            alt=""
            fill
            sizes="32px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase text-[var(--chalk-3)]">
            {(name ?? "?").slice(0, 2)}
          </span>
        )}
      </span>
      <div className="flex flex-col">
        <span className="font-display text-sm font-semibold text-[var(--chalk-0)]">
          {name}
        </span>
      </div>
    </div>
  );
}

function DedCell({ pointsAdj, gdAdj }: { pointsAdj: number; gdAdj: number }) {
  // pointsAdj / gdAdj arrive negative (or 0) from loadLeaderboard.
  const ptsDed = pointsAdj < 0 ? -pointsAdj : 0;
  const gdDed = gdAdj < 0 ? -gdAdj : 0;
  if (ptsDed === 0 && gdDed === 0) {
    return <span className="font-mono text-[12px] tabular text-[var(--chalk-3)]">—</span>;
  }
  return (
    <span
      data-testid="sanction-badge"
      title={`Disciplinary deductions${ptsDed > 0 ? ` · ${ptsDed} pts` : ""}${gdDed > 0 ? ` · ${gdDed} GD` : ""}`}
      className="inline-flex flex-col items-center gap-0.5 rounded-sm border border-[var(--flare)]/60 bg-[var(--flare)]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none tracking-[0.05em] text-[var(--flare)]"
    >
      {ptsDed > 0 ? <span className="tabular">−{ptsDed} pts</span> : null}
      {gdDed > 0 ? <span className="tabular">−{gdDed} gd</span> : null}
    </span>
  );
}

function FormPills({ form }: { form: string }) {
  if (!form) return <span className="text-[10px] text-[var(--chalk-3)]">—</span>;
  // 2026-05-10 — slice(-10) to render the full 10-match form window. The
  // server `buildFormMap` already caps at FORM_WINDOW_LENGTH=10; this
  // mirror keeps the UI safe if a longer string ever arrives.
  const chars = form.toUpperCase().split("").slice(-10);
  return (
    <div className="inline-flex gap-0.5" aria-label={`Form ${chars.join(",")}`}>
      {chars.map((c, i) => {
        const cls =
          c === "W"
            ? "bg-[var(--primary)] text-[var(--primary-ink)]"
            : c === "L"
              ? "bg-[var(--flare)] text-white"
              : c === "D"
                ? "bg-[var(--ink-4)] text-[var(--chalk-1)]"
                : "bg-transparent border border-[var(--ink-4)] text-[var(--chalk-3)]";
        return (
          <span
            key={i}
            className={
              "inline-flex h-4 w-4 items-center justify-center rounded-[2px] text-[9px] font-bold " +
              cls
            }
          >
            {c}
          </span>
        );
      })}
    </div>
  );
}
