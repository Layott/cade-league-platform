"use client";

import { useMemo, useState } from "react";
import { PrimaryButton } from "@/components/admin/buttons";
import { inputClass } from "@/components/admin/FormField";
import type { UnplayedMatch } from "@/server/matches/unplayed";
import { triggerOverlayAction } from "../../actions";

/**
 * Plan 45 — Structured up_next_bug form.
 *
 * Admin picks an un-played match from today's match_day dropdown (or leaves
 * the dropdown on "Manual entry" and types the three fields by hand). The
 * selected row auto-fills home / away display names + kickoffAt ISO. A
 * 3-input fallback grid stays visible for overrides regardless of pick.
 */
export function StructuredUpNextForm({
  sessionId,
  isLive,
  unplayed,
}: {
  sessionId: string;
  isLive: boolean;
  unplayed: UnplayedMatch[];
}) {
  const [slot, setSlot] = useState<"primary" | "secondary">("primary");
  const [matchId, setMatchId] = useState<string>("");
  const [homeName, setHomeName] = useState<string>("");
  const [awayName, setAwayName] = useState<string>("");
  const [kickoffAt, setKickoffAt] = useState<string>("");

  const picked = useMemo(
    () => unplayed.find((m) => m.id === matchId) ?? null,
    [unplayed, matchId],
  );

  const effectiveHome = picked
    ? picked.home.displayName ?? picked.home.gamerTag ?? "Home"
    : homeName.trim() || "Home";
  const effectiveAway = picked
    ? picked.away.displayName ?? picked.away.gamerTag ?? "Away"
    : awayName.trim() || "Away";
  const effectiveKickoff = picked?.kickoffAt
    ? picked.kickoffAt
    : kickoffAt.trim() || new Date().toISOString();

  const payload = {
    home: { displayName: effectiveHome },
    away: { displayName: effectiveAway },
    kickoffAt: effectiveKickoff,
    slot,
  };

  return (
    <div className="space-y-3" data-testid="structured-up-next">
      {unplayed.length === 0 ? (
        <div
          className="rounded-sm border border-[var(--flare)]/30 bg-[var(--flare)]/5 p-2 text-xs text-[var(--flare)]"
          data-testid="up-next-empty"
        >
          No un-played matches for today — enter manually.
        </div>
      ) : null}

      <fieldset
        className="flex items-center gap-3 rounded-sm border border-[var(--ink-4)]/50 bg-[var(--ink-3)]/30 px-2 py-1 text-[10px]"
        data-testid="up-next-slot"
      >
        <span className="font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Slot
        </span>
        <label className="flex items-center gap-1 text-[var(--chalk-1)]">
          <input
            type="radio"
            name="slot-local"
            value="primary"
            checked={slot === "primary"}
            onChange={() => setSlot("primary")}
          />
          primary
        </label>
        <label className="flex items-center gap-1 text-[var(--chalk-1)]">
          <input
            type="radio"
            name="slot-local"
            value="secondary"
            checked={slot === "secondary"}
            onChange={() => setSlot("secondary")}
          />
          secondary
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Match to announce
        <select
          value={matchId}
          onChange={(e) => setMatchId(e.target.value)}
          className={inputClass}
          data-testid="up-next-match-select"
        >
          <option value="">Manual entry (fill fields below)</option>
          {unplayed.map((m) => {
            const h = m.home.displayName ?? m.home.gamerTag ?? "?";
            const a = m.away.displayName ?? m.away.gamerTag ?? "?";
            return (
              <option key={m.id} value={m.id}>
                {h} vs {a}
                {m.scheduledTime ? ` · ${m.scheduledTime.slice(0, 5)}` : ""}
                {" · "}
                {m.status}
              </option>
            );
          })}
        </select>
      </label>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Home
          <input
            type="text"
            value={picked ? effectiveHome : homeName}
            onChange={(e) => setHomeName(e.target.value)}
            readOnly={picked !== null}
            className={inputClass + (picked ? " opacity-70" : "")}
            data-testid="up-next-home"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Away
          <input
            type="text"
            value={picked ? effectiveAway : awayName}
            onChange={(e) => setAwayName(e.target.value)}
            readOnly={picked !== null}
            className={inputClass + (picked ? " opacity-70" : "")}
            data-testid="up-next-away"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Kickoff ISO
          <input
            type="text"
            value={picked ? effectiveKickoff : kickoffAt}
            onChange={(e) => setKickoffAt(e.target.value)}
            readOnly={picked !== null}
            placeholder="2026-04-22T18:00:00Z"
            className={inputClass + (picked ? " opacity-70" : "")}
            data-testid="up-next-kickoff"
          />
        </label>
      </div>

      <form action={triggerOverlayAction} className="flex justify-end">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="templateKey" value="up_next_bug" />
        <input type="hidden" name="slot" value={slot} />
        <input type="hidden" name="payload" value={JSON.stringify(payload)} />
        <PrimaryButton
          type="submit"
          size="sm"
          disabled={!isLive}
          data-testid="up-next-trigger"
        >
          Trigger
        </PrimaryButton>
      </form>
    </div>
  );
}
