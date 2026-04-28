"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LadderRung = {
  sanctionType: "warning" | "point_deduction" | "gd_deduction" | "forfeit" | "ban";
  magnitude: number;
  label: string;
  rationale: string;
  requiresWindow: boolean;
};

type OffenseLookup = {
  priorOffenseCount: number;
  offenseNumber: number;
  rung: LadderRung;
};

/**
 * LadderHelper — client island that watches the (player, incidentType) pair
 * in the surrounding <form> and, whenever both are filled, fetches the prior
 * offense count + auto-ladder rung from /api/admin/punishments/offense-count.
 *
 * On a successful lookup it:
 *   1. Pre-fills `sanctionType` + `magnitude` form inputs to the ladder rung.
 *   2. Surfaces an inline "Nth offense → escalated to X" notice.
 *
 * The admin can still edit sanctionType/magnitude afterwards — we only
 * *set* values on fetch, never lock them.
 *
 * Uses DOM queries (not lifting state up) to match the existing pattern
 * established by SuspensionFields.tsx.
 */
export function LadderHelper() {
  const [lookup, setLookup] = useState<OffenseLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastKeyRef = useRef<string>("");
  const debounceRef = useRef<number | null>(null);
  const userEditedRef = useRef(false);

  const run = useCallback(async () => {
    const form = document.querySelector("form") as HTMLFormElement | null;
    if (!form) return;
    const playerEl = form.elements.namedItem("playerId") as
      | HTMLSelectElement
      | null;
    const incidentEl = form.elements.namedItem("incidentType") as
      | HTMLSelectElement
      | null;
    if (!playerEl || !incidentEl) return;

    const playerId = playerEl.value;
    const incidentType = incidentEl.value;
    if (!playerId || !incidentType) return;

    const key = `${playerId}|${incidentType}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/punishments/offense-count", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, incidentType }),
      });
      if (!res.ok) {
        setError(`lookup failed: ${res.status}`);
        setLookup(null);
        return;
      }
      const json = (await res.json()) as OffenseLookup;
      setLookup(json);

      // Pre-fill only if the admin hasn't edited those fields manually yet.
      // Once they touch sanction/magnitude, we stop overwriting their value.
      if (!userEditedRef.current) {
        const sanctionEl = form.elements.namedItem(
          "sanctionType",
        ) as HTMLSelectElement | null;
        const magEl = form.elements.namedItem(
          "magnitude",
        ) as HTMLInputElement | null;
        if (sanctionEl) {
          sanctionEl.value = json.rung.sanctionType;
          sanctionEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (magEl) {
          magEl.value = String(json.rung.magnitude);
          magEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setLookup(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const form = document.querySelector("form") as HTMLFormElement | null;
    if (!form) return;

    // `form.elements.namedItem(...)` returns `Element | RadioNodeList | null`.
    // RadioNodeList doesn't expose addEventListener directly — cast to
    // HTMLElement so the event-listener API is available. Safe here:
    // every field binds to a single control (select/input), never a
    // radio group with duplicate names.
    const playerEl = form.elements.namedItem("playerId") as HTMLElement | null;
    const incidentEl = form.elements.namedItem("incidentType") as HTMLElement | null;
    const sanctionEl = form.elements.namedItem("sanctionType") as HTMLElement | null;
    const magEl = form.elements.namedItem("magnitude") as HTMLElement | null;

    const trigger = () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void run();
      }, 150);
    };
    const markEdited = () => {
      userEditedRef.current = true;
    };

    playerEl?.addEventListener("change", trigger);
    incidentEl?.addEventListener("change", trigger);
    sanctionEl?.addEventListener("change", markEdited);
    magEl?.addEventListener("input", markEdited);

    // Initial lookup on mount (the default option-0 incident + default player
    // are already selected) — but we reset userEditedRef so pre-fill is
    // allowed exactly once.
    userEditedRef.current = false;
    void run();

    return () => {
      playerEl?.removeEventListener("change", trigger);
      incidentEl?.removeEventListener("change", trigger);
      sanctionEl?.removeEventListener("change", markEdited);
      magEl?.removeEventListener("input", markEdited);
    };
  }, [run]);

  if (!lookup && !loading && !error) {
    return null;
  }

  return (
    <div
      data-testid="ladder-helper"
      className="rounded-sm border border-[var(--signal)]/40 bg-[var(--signal)]/5 p-4"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
        Auto-ladder (Rule §5.4 / §6.3)
      </div>
      {loading ? (
        <p className="mt-2 text-xs text-[var(--chalk-3)]">Checking prior offenses…</p>
      ) : error ? (
        <p className="mt-2 text-xs text-[var(--flare)]">{error}</p>
      ) : lookup ? (
        <div className="mt-2 space-y-1">
          <p className="text-sm text-[var(--chalk-1)]">
            <span className="font-mono tabular text-[var(--chalk-0)]">
              {ordinal(lookup.offenseNumber)}
            </span>{" "}
            offense
            {lookup.priorOffenseCount > 0
              ? ` — ${lookup.priorOffenseCount} prior on file`
              : " — no priors on file"}
            .{" "}
            {lookup.offenseNumber > 1 ? (
              <span className="text-[var(--flare)]">
                Escalated to: <span className="font-semibold">{lookup.rung.label}</span>
              </span>
            ) : (
              <span className="text-[var(--chalk-2)]">
                Ladder rung: <span className="font-semibold">{lookup.rung.label}</span>
              </span>
            )}
          </p>
          <p className="text-[11px] text-[var(--chalk-3)]">{lookup.rung.rationale}</p>
          {lookup.rung.requiresWindow ? (
            <p className="text-[11px] text-[var(--flare)]">
              This rung is a ban — pick Sanction = Suspension (ban) and fill in both dates.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
