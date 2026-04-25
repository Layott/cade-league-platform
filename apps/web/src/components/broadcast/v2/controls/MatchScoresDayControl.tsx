"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import { triggerOverlayEnterAction } from "@/app/admin/broadcast/v2/[sessionId]/actions";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin/buttons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — Match Scores (today) control with 3-part split buttons.
 *
 * Three pre-defined ranges (1-4, 5-8, 9-12) + Show All. Each part button
 * fires its own ENTER form so the persistent payload carries the right
 * `partRange`. Live preview gets the same shape via postMessage so the
 * iframe scrolls to the relevant part instantly.
 *
 * The footer toggle only fires when the overlay is currently active —
 * one-button OFF for the operator regardless of which part is showing.
 * When inactive, the toggle is a "Trigger ON (Show all)" shortcut that
 * mirrors the Show All part button.
 *
 * Persistent payload mirrors the legacy `match_scores_day` schema —
 * `matchDayLabel`+`rows` are computed server-side by the overlay route
 * itself; the v2 control panel only carries the `partRange` selector.
 */

const PARTS: Array<{ id: 1 | 2 | 3 | "all"; label: string; hint: string }> =
  [
    { id: 1, label: "Part 1", hint: "matches 1-4" },
    { id: 2, label: "Part 2", hint: "matches 5-8" },
    { id: 3, label: "Part 3", hint: "matches 9-12" },
    { id: "all", label: "Show all", hint: "full grid" },
  ];

export function MatchScoresDayControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const previewPart = (id: 1 | 2 | 3 | "all") => {
    postToFrame(iframeRef.current, {
      type: "update",
      data: { partRange: id },
    });
  };

  return (
    <ControlCard
      overlayKey="11-match-scores-day"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      editPanel={
        <div className="grid grid-cols-2 gap-2">
          {PARTS.map((p) => (
            <form
              key={String(p.id)}
              action={triggerOverlayEnterAction}
              data-testid={`v2-msd-part-form-${p.id}`}
              onSubmit={() => previewPart(p.id)}
            >
              <input type="hidden" name="sessionId" value={sessionId} />
              <input
                type="hidden"
                name="overlayKey"
                value="11-match-scores-day"
              />
              <input
                type="hidden"
                name="payload"
                value={JSON.stringify({
                  partRange: p.id,
                  matchDayLabel: "MATCH DAY",
                  rows: [],
                })}
              />
              {p.id === "all" ? (
                <SecondaryButton
                  type="submit"
                  size="sm"
                  className="w-full"
                  data-testid={`v2-msd-part-${p.id}`}
                >
                  {p.label}
                  <span className="ml-1 text-[8px] text-[var(--chalk-3)]">
                    {p.hint}
                  </span>
                </SecondaryButton>
              ) : (
                <PrimaryButton
                  type="submit"
                  size="sm"
                  className="w-full"
                  data-testid={`v2-msd-part-${p.id}`}
                >
                  {p.label}
                  <span className="ml-1 text-[8px] text-[var(--primary-ink)]/70">
                    {p.hint}
                  </span>
                </PrimaryButton>
              )}
            </form>
          ))}
        </div>
      }
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="11-match-scores-day"
          sessionId={sessionId}
          active={active}
          onLabel="Trigger ON (Show all)"
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify({
                partRange: "all",
                matchDayLabel: "MATCH DAY",
                rows: [],
              })}
            />
          }
        />
      }
    />
  );
}
