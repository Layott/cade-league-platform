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
};

const initialState: SubmitMatchResultState = { status: "idle" };

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

  // Reset matchId when the day changes.
  useEffect(() => {
    if (!activeDay) return;
    if (!activeDay.matches.some((m) => m.id === matchId)) {
      setMatchId(activeDay.matches[0]?.id ?? "");
    }
  }, [activeDay, matchId]);

  // Clear form after a successful submit.
  useEffect(() => {
    if (state.status === "ok") {
      formRef.current?.reset();
    }
  }, [state]);

  if (matchDays.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-8 text-center text-[12px] text-[var(--chalk-3)]">
        No fixtures scheduled — create match-days at /admin/match-days.
      </div>
    );
  }

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
          />
          <div className="text-center text-[var(--chalk-3)]">
            <span className="font-display text-[20px]">vs</span>
          </div>
          <ScoreInput
            name="awayScore"
            playerName={activeMatch.awayName}
            testId="away-score"
          />
        </div>
      ) : null}

      <details className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]/60 px-4 py-3">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] hover:text-[var(--chalk-0)]">
          Advanced (notes, result type)
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block space-y-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Result type
            </span>
            <select
              name="resultType"
              defaultValue="normal"
              className="w-full max-w-xs rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
              data-testid="results-type-select"
            >
              <option value="normal">Normal</option>
              <option value="forfeit">Forfeit (3-0 to leader)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Notes
            </span>
            <textarea
              name="notes"
              rows={2}
              className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
              placeholder="Optional notes (e.g. controller swap mid-match)"
            />
          </label>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <PrimaryButton type="submit" disabled={pending} data-testid="results-submit">
          {pending ? "Submitting..." : "Submit result"}
        </PrimaryButton>
        <SecondaryButton
          type="button"
          onClick={() => formRef.current?.reset()}
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
}: {
  name: string;
  playerName: string;
  testId: string;
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
        defaultValue={0}
        required
        data-testid={testId}
        className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-3 text-center font-mono text-[28px] font-bold tabular text-[var(--chalk-0)] focus:border-[var(--primary)] focus:outline-none"
      />
    </label>
  );
}
