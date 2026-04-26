"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import {
  submitMatchResultAction,
  type SubmitMatchResultState,
} from "./actions";

/**
 * Plan 51 — client form for Results Entry tab.
 *
 * Two-stage selector: pick a match-day, then pick a fixture inside that
 * day. The form posts to `submitMatchResultAction`. After a successful
 * submit the form clears + the success banner stays visible for 5s before
 * fading.
 *
 * Bugfix 2026-04-26:
 *   - When a fixture with an existing confirmed result is reselected, the
 *     score inputs prefill with the saved scores (was always 0-0).
 *   - Forfeit option now offers per-side variants ("Home forfeits" sets
 *     0-3 to away; "Away forfeits" sets 3-0 to home) so admins can choose
 *     either side, not just whichever input score happens to be higher.
 */

export type MatchDayOption = {
  id: string;
  label: string;
  matches: MatchOption[];
};

export type MatchOption = {
  id: string;
  label: string;
  homeName: string;
  awayName: string;
  hasResult: boolean;
  scheduledTime: string | null;
  existingHomeScore: number | null;
  existingAwayScore: number | null;
  existingResultType: string | null;
  existingNotes: string | null;
};

const initialState: SubmitMatchResultState = { status: "idle" };

type ResultMode = "normal" | "forfeit_home" | "forfeit_away";

export function ResultsEntryForm({
  matchDays,
}: {
  matchDays: MatchDayOption[];
}) {
  const [state, formAction, pending] = useActionState(
    submitMatchResultAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [matchDayId, setMatchDayId] = useState<string>(
    matchDays[0]?.id ?? "",
  );
  const [matchId, setMatchId] = useState<string>(
    matchDays[0]?.matches[0]?.id ?? "",
  );

  const activeDay = useMemo(
    () => matchDays.find((d) => d.id === matchDayId) ?? matchDays[0],
    [matchDays, matchDayId],
  );
  const activeMatch = useMemo(
    () => activeDay?.matches.find((m) => m.id === matchId) ?? activeDay?.matches[0],
    [activeDay, matchId],
  );

  // Score + result-type state, prefilled from the selected fixture's
  // existing match_results row (if any). Updates whenever the fixture
  // selection changes — that's how reselecting a saved fixture shows the
  // previously inputted scores instead of resetting to 0-0.
  const [homeScore, setHomeScore] = useState<string>("0");
  const [awayScore, setAwayScore] = useState<string>("0");
  const [mode, setMode] = useState<ResultMode>("normal");
  const [notes, setNotes] = useState<string>("");

  // Reset matchId when the day changes.
  useEffect(() => {
    if (!activeDay) return;
    if (!activeDay.matches.some((m) => m.id === matchId)) {
      setMatchId(activeDay.matches[0]?.id ?? "");
    }
  }, [activeDay, matchId]);

  // Prefill scores + mode from the selected fixture's existing result.
  useEffect(() => {
    if (!activeMatch) {
      setHomeScore("0");
      setAwayScore("0");
      setMode("normal");
      setNotes("");
      return;
    }
    if (activeMatch.hasResult) {
      const h = activeMatch.existingHomeScore ?? 0;
      const a = activeMatch.existingAwayScore ?? 0;
      setHomeScore(String(h));
      setAwayScore(String(a));
      if (activeMatch.existingResultType === "forfeit") {
        // Reverse-engineer which side forfeited from the saved scores.
        setMode(a > h ? "forfeit_home" : "forfeit_away");
      } else {
        setMode("normal");
      }
      setNotes(activeMatch.existingNotes ?? "");
    } else {
      setHomeScore("0");
      setAwayScore("0");
      setMode("normal");
      setNotes("");
    }
    // We intentionally depend on the individual existing-result fields
    // rather than the activeMatch object reference — useMemo recreates
    // the object on every render, which would re-run this effect and
    // overwrite mid-edit input with the stored value. Track only the
    // primitive fields that should trigger a prefill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch?.id, activeMatch?.hasResult, activeMatch?.existingHomeScore, activeMatch?.existingAwayScore, activeMatch?.existingResultType, activeMatch?.existingNotes]);

  // When user picks a forfeit-home or forfeit-away mode, snap scores
  // accordingly so the visible score input matches what the server will
  // actually persist.
  useEffect(() => {
    if (mode === "forfeit_home") {
      setHomeScore("0");
      setAwayScore("3");
    } else if (mode === "forfeit_away") {
      setHomeScore("3");
      setAwayScore("0");
    }
  }, [mode]);

  // Clear the success banner on next selection change so the operator
  // sees fresh state. We do NOT clear the form here — the score state is
  // already bound to the active fixture's existing result.
  useEffect(() => {
    if (state.status === "ok") {
      // No-op: the page revalidates server-side, which refeeds matchDays
      // with the new hasResult/scores. The prefill effect above then
      // resets inputs to the just-saved values on the next render.
    }
  }, [state]);

  if (matchDays.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-8 text-center text-[12px] text-[var(--chalk-3)]">
        No fixtures scheduled — create match-days at /admin/match-days.
      </div>
    );
  }

  // Translate UI mode → server-side resultType. Both forfeit variants
  // map to resultType=forfeit; the home/away choice is encoded in the
  // home_score / away_score fields (3-0 vs 0-3) per spec §3.3.
  const resultTypeForServer = mode === "normal" ? "normal" : "forfeit";
  const isForfeit = mode !== "normal";

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-5"
      data-testid="results-entry-form"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Match-day
          </span>
          <select
            value={matchDayId}
            onChange={(e) => setMatchDayId(e.target.value)}
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
            data-testid="results-md-select"
          >
            {matchDays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Fixture
          </span>
          <select
            name="matchId"
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
            data-testid="results-match-select"
          >
            {(activeDay?.matches ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.hasResult ? " (has result — editing)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeMatch ? (
        <div className="grid grid-cols-1 items-end gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 md:grid-cols-[1fr_auto_1fr]">
          <ScoreInput
            name="homeScore"
            playerName={activeMatch.homeName}
            testId="home-score"
            value={homeScore}
            onChange={setHomeScore}
            disabled={isForfeit}
          />
          <div className="text-center text-[var(--chalk-3)]">
            <span className="font-display text-[20px]">vs</span>
          </div>
          <ScoreInput
            name="awayScore"
            playerName={activeMatch.awayName}
            testId="away-score"
            value={awayScore}
            onChange={setAwayScore}
            disabled={isForfeit}
          />
        </div>
      ) : null}

      {/* Hidden input so server action receives the canonical result-type
         enum value ("normal" or "forfeit") regardless of which forfeit
         flavour the operator picked. */}
      <input type="hidden" name="resultType" value={resultTypeForServer} />

      <details
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]/60 px-4 py-3"
        open={isForfeit || (activeMatch?.hasResult ?? false)}
      >
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] hover:text-[var(--chalk-0)]">
          Advanced (notes, result type)
        </summary>
        <div className="mt-3 space-y-3">
          <fieldset className="space-y-2">
            <legend className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Result type
            </legend>
            <div className="flex flex-col gap-1.5 text-[13px] text-[var(--chalk-0)] sm:flex-row sm:flex-wrap sm:gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="resultMode"
                  value="normal"
                  checked={mode === "normal"}
                  onChange={() => setMode("normal")}
                  data-testid="results-mode-normal"
                />
                <span>Normal</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="resultMode"
                  value="forfeit_home"
                  checked={mode === "forfeit_home"}
                  onChange={() => setMode("forfeit_home")}
                  data-testid="results-mode-forfeit-home"
                />
                <span>
                  Forfeit — <strong>{activeMatch?.homeName ?? "Home"}</strong> forfeits
                  <span className="ml-1 text-[var(--chalk-3)]">(0-3)</span>
                </span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="resultMode"
                  value="forfeit_away"
                  checked={mode === "forfeit_away"}
                  onChange={() => setMode("forfeit_away")}
                  data-testid="results-mode-forfeit-away"
                />
                <span>
                  Forfeit — <strong>{activeMatch?.awayName ?? "Away"}</strong> forfeits
                  <span className="ml-1 text-[var(--chalk-3)]">(3-0)</span>
                </span>
              </label>
            </div>
          </fieldset>
          <label className="block space-y-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Notes
            </span>
            <textarea
              name="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
              placeholder="Optional notes (e.g. controller swap mid-match)"
            />
          </label>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <PrimaryButton type="submit" disabled={pending} data-testid="results-submit">
          {pending ? "Submitting..." : activeMatch?.hasResult ? "Update result" : "Submit result"}
        </PrimaryButton>
        <SecondaryButton
          type="button"
          onClick={() => {
            // Reset just the inputs back to the active fixture's existing
            // values (or 0-0 if no result yet). This is more useful than
            // wiping everything to 0-0 when the operator is editing a
            // saved result.
            if (activeMatch?.hasResult) {
              setHomeScore(String(activeMatch.existingHomeScore ?? 0));
              setAwayScore(String(activeMatch.existingAwayScore ?? 0));
              if (activeMatch.existingResultType === "forfeit") {
                const a = activeMatch.existingAwayScore ?? 0;
                const h = activeMatch.existingHomeScore ?? 0;
                setMode(a > h ? "forfeit_home" : "forfeit_away");
              } else {
                setMode("normal");
              }
              setNotes(activeMatch.existingNotes ?? "");
            } else {
              setHomeScore("0");
              setAwayScore("0");
              setMode("normal");
              setNotes("");
            }
          }}
          disabled={pending}
        >
          Reset
        </SecondaryButton>
        {state.status === "error" ? (
          <span role="alert" className="text-[11px] text-[var(--flare)]" data-testid="results-error">
            {state.error}
          </span>
        ) : null}
        {state.status === "ok" ? (
          <span className="text-[11px] text-[var(--primary)]" data-testid="results-ok">
            Saved · standings recomputing
          </span>
        ) : null}
      </div>
    </form>
  );
}

function ScoreInput({
  name,
  playerName,
  testId,
  value,
  onChange,
  disabled,
}: {
  name: string;
  playerName: string;
  testId: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-center font-display text-[14px] font-semibold text-[var(--chalk-0)]">
        {playerName}
      </span>
      <input
        type="number"
        name={name}
        min={0}
        max={99}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        disabled={disabled}
        data-testid={testId}
        className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-3 text-center font-mono text-[28px] font-bold tabular text-[var(--chalk-0)] focus:border-[var(--primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}
