"use client";

import { useMemo, useState } from "react";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { inputClass } from "@/components/admin/FormField";
import { AssetUploader } from "@/components/broadcast/AssetUploader";
import type { SelectableMatch } from "@/server/broadcast/match_flow";
import {
  triggerOverlayAction,
  scoreBugDeltaAction,
  resetScoreBugAction,
  clearScoreBugAction,
} from "../../actions";

/**
 * Plan 45 — Structured score_bug form.
 *
 * Replaces the JSON textarea. Admin can either:
 *   - Bind to a selectable match (auto-fills home/away display names +
 *     photos; scores editable via +/- buttons).
 *   - Type names manually ("Manual" option in the dropdown).
 *
 * +1 / -1 / Reset / OFF buttons call the existing scoreBug* server actions,
 * which require an ALREADY-TRIGGERED score_bug. This form's "Trigger"
 * button fires a fresh overlay event via triggerOverlayAction with the
 * slot-tagged payload.
 */

type PlayerLite = {
  displayName: string | null;
  gamerTag: string | null;
  photoUrl: string | null;
};

export function StructuredScoreBugForm({
  sessionId,
  isLive,
  selectable,
  activeSingle,
}: {
  sessionId: string;
  isLive: boolean;
  selectable: SelectableMatch[];
  activeSingle: {
    id: string;
    payload: Record<string, unknown>;
    triggered_at: string;
  } | null;
}) {
  const activePayload = activeSingle?.payload as
    | {
        players?: Array<{ displayName: string; score: number }>;
        slot?: "primary" | "secondary";
      }
    | null;
  const activeHome = activePayload?.players?.[0];
  const activeAway = activePayload?.players?.[1];
  const activeSlot = activePayload?.slot ?? "primary";

  const [slot, setSlot] = useState<"primary" | "secondary">(activeSlot);
  const [matchId, setMatchId] = useState<string>("");
  const [homeName, setHomeName] = useState<string>(
    activeHome?.displayName ?? "",
  );
  const [awayName, setAwayName] = useState<string>(
    activeAway?.displayName ?? "",
  );
  const [homeScore, setHomeScore] = useState<number>(activeHome?.score ?? 0);
  const [awayScore, setAwayScore] = useState<number>(activeAway?.score ?? 0);
  const [homePhotoUrl, setHomePhotoUrl] = useState<string>("");
  const [awayPhotoUrl, setAwayPhotoUrl] = useState<string>("");

  // When the admin picks a match, snap names from the row; locked until they
  // switch back to "manual".
  const bound = useMemo(() => {
    if (!matchId) return null;
    const m = selectable.find((s) => s.id === matchId);
    if (!m) return null;
    const home: PlayerLite = {
      displayName: m.home.displayName,
      gamerTag: m.home.gamerTag,
      photoUrl: null,
    };
    const away: PlayerLite = {
      displayName: m.away.displayName,
      gamerTag: m.away.gamerTag,
      photoUrl: null,
    };
    return { home, away };
  }, [matchId, selectable]);

  const effectiveHome = bound
    ? bound.home.displayName ?? bound.home.gamerTag ?? "Home"
    : homeName;
  const effectiveAway = bound
    ? bound.away.displayName ?? bound.away.gamerTag ?? "Away"
    : awayName;

  const payload = {
    players: [
      {
        displayName: effectiveHome,
        score: homeScore,
        ...(homePhotoUrl.trim() ? { photoUrl: homePhotoUrl.trim() } : {}),
      },
      {
        displayName: effectiveAway,
        score: awayScore,
        ...(awayPhotoUrl.trim() ? { photoUrl: awayPhotoUrl.trim() } : {}),
      },
    ],
    matchId: matchId || undefined,
    slot,
  };

  return (
    <div className="space-y-3" data-testid="structured-score-bug">
      {activeSingle ? (
        <div
          className="rounded-sm border border-[var(--signal)]/50 bg-[var(--signal)]/5 p-2 text-xs text-[var(--signal)]"
          data-testid="score-bug-live"
        >
          {activeHome?.score ?? 0} - {activeAway?.score ?? 0} LIVE ·{" "}
          <span className="uppercase tracking-[0.18em]">{activeSlot}</span>
        </div>
      ) : (
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Not live — trigger to push to stream
        </div>
      )}

      {/* Slot selector */}
      <fieldset
        className="flex items-center gap-3 rounded-sm border border-[var(--ink-4)]/50 bg-[var(--ink-3)]/30 px-2 py-1 text-[10px]"
        data-testid="score-bug-slot"
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

      {/* Bind to match */}
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Bind to match
        <select
          value={matchId}
          onChange={(e) => setMatchId(e.target.value)}
          className={inputClass}
          data-testid="score-bug-match-select"
        >
          <option value="">Manual (type names)</option>
          {selectable.map((m) => {
            const h = m.home.displayName ?? m.home.gamerTag ?? "?";
            const a = m.away.displayName ?? m.away.gamerTag ?? "?";
            return (
              <option key={m.id} value={m.id}>
                {h} vs {a}
                {m.scheduledTime ? ` · ${m.scheduledTime.slice(0, 5)}` : ""}
              </option>
            );
          })}
        </select>
      </label>

      {/* Name inputs — readonly when match is bound */}
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Home name
          <input
            type="text"
            value={effectiveHome}
            onChange={(e) => setHomeName(e.target.value)}
            readOnly={bound !== null}
            className={inputClass + (bound ? " opacity-70" : "")}
            data-testid="score-bug-home-name"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Away name
          <input
            type="text"
            value={effectiveAway}
            onChange={(e) => setAwayName(e.target.value)}
            readOnly={bound !== null}
            className={inputClass + (bound ? " opacity-70" : "")}
            data-testid="score-bug-away-name"
          />
        </label>
      </div>

      {/* Score number inputs + delta buttons */}
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1" data-testid="score-bug-home-score">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Home score
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={99}
              value={homeScore}
              onChange={(e) =>
                setHomeScore(
                  Math.max(0, Math.min(99, Number(e.target.value) || 0)),
                )
              }
              className={inputClass + " w-20"}
              data-testid="score-bug-home-input"
            />
            <DeltaForm
              sessionId={sessionId}
              slot={slot}
              side="home"
              delta={1}
              isLive={isLive}
            />
            <DeltaForm
              sessionId={sessionId}
              slot={slot}
              side="home"
              delta={-1}
              isLive={isLive}
            />
          </div>
        </div>
        <div className="space-y-1" data-testid="score-bug-away-score">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Away score
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={99}
              value={awayScore}
              onChange={(e) =>
                setAwayScore(
                  Math.max(0, Math.min(99, Number(e.target.value) || 0)),
                )
              }
              className={inputClass + " w-20"}
              data-testid="score-bug-away-input"
            />
            <DeltaForm
              sessionId={sessionId}
              slot={slot}
              side="away"
              delta={1}
              isLive={isLive}
            />
            <DeltaForm
              sessionId={sessionId}
              slot={slot}
              side="away"
              delta={-1}
              isLive={isLive}
            />
          </div>
        </div>
      </div>

      {/* Plan 48 — per-side photo uploaders. Optional; when present, the
          score-bug avatar slot uses the uploaded image. */}
      <div className="grid gap-2 md:grid-cols-2">
        <div
          className="space-y-1"
          data-testid="score-bug-home-photo-group"
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Home photo
          </span>
          <AssetUploader
            kind="image"
            label="home"
            onUploaded={(url) => setHomePhotoUrl(url)}
            data-testid="score-bug-home-photo-upload"
          />
          <input
            type="url"
            value={homePhotoUrl}
            onChange={(e) => setHomePhotoUrl(e.target.value)}
            placeholder="https://…/home.png"
            className={inputClass}
            data-testid="score-bug-home-photo"
          />
        </div>
        <div
          className="space-y-1"
          data-testid="score-bug-away-photo-group"
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Away photo
          </span>
          <AssetUploader
            kind="image"
            label="away"
            onUploaded={(url) => setAwayPhotoUrl(url)}
            data-testid="score-bug-away-photo-upload"
          />
          <input
            type="url"
            value={awayPhotoUrl}
            onChange={(e) => setAwayPhotoUrl(e.target.value)}
            placeholder="https://…/away.png"
            className={inputClass}
            data-testid="score-bug-away-photo"
          />
        </div>
      </div>

      {/* Trigger + Reset + OFF */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={resetScoreBugAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="slot" value={slot} />
          <SecondaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="score-bug-reset"
          >
            Reset 0-0
          </SecondaryButton>
        </form>
        <form action={clearScoreBugAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="slot" value={slot} />
          <DangerButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="score-bug-off"
          >
            Trigger OFF
          </DangerButton>
        </form>
        <form action={triggerOverlayAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="templateKey" value="score_bug" />
          <input type="hidden" name="slot" value={slot} />
          <input
            type="hidden"
            name="payload"
            value={JSON.stringify(payload)}
          />
          <PrimaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="score-bug-trigger"
          >
            Trigger
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}

function DeltaForm({
  sessionId,
  slot,
  side,
  delta,
  isLive,
}: {
  sessionId: string;
  slot: "primary" | "secondary";
  side: "home" | "away";
  delta: number;
  isLive: boolean;
}) {
  return (
    <form action={scoreBugDeltaAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="slot" value={slot} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="delta" value={delta} />
      {delta > 0 ? (
        <PrimaryButton
          type="submit"
          size="sm"
          disabled={!isLive}
          data-testid={`score-bug-${side}-plus`}
        >
          +1
        </PrimaryButton>
      ) : (
        <SecondaryButton
          type="submit"
          size="sm"
          disabled={!isLive}
          data-testid={`score-bug-${side}-minus`}
        >
          −1
        </SecondaryButton>
      )}
    </form>
  );
}
