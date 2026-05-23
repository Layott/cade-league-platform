"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { CustomDesignsTab } from "@/components/admin/broadcast/v2/CustomDesignsTab";
import type { CustomDesignSummary } from "@/components/admin/broadcast/v2/CustomDesignCard";
import { BrbControl } from "@/components/broadcast/v2/controls/BrbControl";
import { TimerControl } from "@/components/broadcast/v2/controls/TimerControl";
import { H2H2Control } from "@/components/broadcast/v2/controls/H2H2Control";
import { H2H3Control } from "@/components/broadcast/v2/controls/H2H3Control";
import { H2H5Control } from "@/components/broadcast/v2/controls/H2H5Control";
import { LeaderboardControl } from "@/components/broadcast/v2/controls/LeaderboardControl";
import { LowerThirdControl } from "@/components/broadcast/v2/controls/LowerThirdControl";
import { SecondaryScoreBugControl } from "@/components/broadcast/v2/controls/SecondaryScoreBugControl";
import {
  UpNextBugControl,
  type UpcomingMatch,
} from "@/components/broadcast/v2/controls/UpNextBugControl";
import { MatchScoresDayControl } from "@/components/broadcast/v2/controls/MatchScoresDayControl";
import { StartingSoonControl } from "@/components/broadcast/v2/controls/StartingSoonControl";
import { StreamEndedControl } from "@/components/broadcast/v2/controls/StreamEndedControl";
import { TopScorersControl } from "@/components/broadcast/v2/controls/TopScorersControl";
import { OrgsControl } from "@/components/broadcast/v2/controls/OrgsControl";
import { CoachesControl } from "@/components/broadcast/v2/controls/CoachesControl";
import { PenaltiesControl } from "@/components/broadcast/v2/controls/PenaltiesControl";
import {
  PlayerSquadsControl,
  type PlayerOption,
} from "@/components/broadcast/v2/controls/PlayerSquadsControl";
import { HighlightControl } from "@/components/broadcast/v2/controls/HighlightControl";
import { SimpleOverlayControl } from "@/components/broadcast/v2/controls/SimpleOverlayControl";
import { DidYouKnowControl } from "@/components/broadcast/v2/controls/DidYouKnowControl";

/**
 * Plan 51 — control card grid layout.
 *
 * Renders 18 controls in a responsive grid (15 single-instance + 3
 * separate lower-third cards, one per slot). Each card receives an
 * `active` flag driven from the server-side probe of `overlay_events`
 * / `overlay_active_instances`. The toggle button on each card uses
 * the flag to flip its label / color. For the 3 lower-third cards we
 * destructure `lowerThirdSlots` per-index so each card only knows
 * about its own slot.
 *
 * A lightweight Realtime subscriber listens for overlay.* events on the
 * session channel and calls `router.refresh()` so the active flags
 * re-fetch + the toggle UI updates without a full page reload.
 */
export type ControlGridProps = {
  sessionId: string;
  viewToken: string | null;
  upcoming: UpcomingMatch[];
  canTrigger: boolean;
  /** Per-overlay-key active flag (single-instance). */
  active: Record<string, boolean>;
  /** Per-slot active flags for the multi-instance lower-third overlay. */
  lowerThirdSlots: [boolean, boolean, boolean];
  /** 13 Elite players for the player-squads dropdown picker. */
  playerOptions?: PlayerOption[];
  /**
   * Published user designs to surface in the Custom tab.
   * Populated server-side when overlayBuilder.enabled is true.
   */
  customDesigns?: CustomDesignSummary[];
  /**
   * When true, appends the Custom tab section below the built-in grid.
   * Maps directly to featureFlags.overlayBuilder.enabled.
   */
  overlayBuilderEnabled?: boolean;
};

export function ControlGrid({
  sessionId,
  viewToken,
  upcoming,
  canTrigger,
  active,
  lowerThirdSlots,
  playerOptions = [],
  customDesigns = [],
  overlayBuilderEnabled = false,
}: ControlGridProps) {
  const router = useRouter();

  // Subscribe to overlay realtime events on this session — every trigger
  // / clear refreshes the page so the active flags update + the toggle
  // button label flips. Cheap because the page is server-rendered with
  // dynamic = "force-dynamic".
  useEffect(() => {
    const sb = getBrowserSupabase();
    const channel = sb.channel(`overlay:${sessionId}`);

    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (scheduled) return;
      // small debounce — multiple events can arrive in <50ms when an
      // OFF triggers a rebound ENTER on a different key.
      scheduled = setTimeout(() => {
        scheduled = null;
        router.refresh();
      }, 200);
    };

    channel
      .on("broadcast", { event: "overlay.triggered" }, refreshSoon)
      .on("broadcast", { event: "overlay.cleared" }, refreshSoon)
      .on("broadcast", { event: "instance.triggered" }, refreshSoon)
      .on("broadcast", { event: "instance.cleared" }, refreshSoon)
      .subscribe();

    return () => {
      if (scheduled) clearTimeout(scheduled);
      void sb.removeChannel(channel);
    };
  }, [sessionId, router]);

  // canTrigger surfaced via fieldset disabling so readers see the form
  // shape but cannot submit.
  return (
    <>
    <fieldset
      disabled={!canTrigger}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      data-testid="v2-control-grid"
      aria-disabled={!canTrigger}
    >
      <BrbControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["01-brb"] ?? false}
      />
      <TimerControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["02-timer"] ?? false}
      />
      <H2H2Control
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["04-h2h-2"] ?? false}
      />
      <H2H3Control
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["05-h2h-3"] ?? false}
      />
      <H2H5Control
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["06-h2h-5"] ?? false}
      />
      <LeaderboardControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["07-leaderboard"] ?? false}
      />
      <LowerThirdControl
        sessionId={sessionId}
        viewToken={viewToken}
        slot={1}
        active={lowerThirdSlots[0]}
      />
      <LowerThirdControl
        sessionId={sessionId}
        viewToken={viewToken}
        slot={2}
        active={lowerThirdSlots[1]}
      />
      <LowerThirdControl
        sessionId={sessionId}
        viewToken={viewToken}
        slot={3}
        active={lowerThirdSlots[2]}
      />
      <SecondaryScoreBugControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["09-secondary-score-bug"] ?? false}
      />
      <UpNextBugControl
        sessionId={sessionId}
        viewToken={viewToken}
        upcoming={upcoming}
        active={active["10-up-next-bug"] ?? false}
      />
      <MatchScoresDayControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["11-match-scores-day"] ?? false}
      />
      <StartingSoonControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["12-starting-soon"] ?? false}
      />
      <StreamEndedControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["13-stream-ended"] ?? false}
      />
      <TopScorersControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["14-top-scorers"] ?? false}
      />
      <OrgsControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["15-orgs"] ?? false}
      />
      <CoachesControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["16-coaches"] ?? false}
      />
      <PenaltiesControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["17-penalties"] ?? false}
      />
      <PlayerSquadsControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["19-player-squads"] ?? false}
        players={playerOptions}
      />
      <HighlightControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["20-highlight"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="21-streaks"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["21-streaks"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="22-power-rankings"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["22-power-rankings"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="23-org-standings"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["23-org-standings"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="24-biggest-margins"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["24-biggest-margins"] ?? false}
      />
      <DidYouKnowControl
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["25-did-you-know"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="26-card-meta"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["26-card-meta"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="27-schedule"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["27-schedule"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="28-punditry"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["28-punditry"] ?? false}
      />
      <SimpleOverlayControl
        overlayKey="29-goalfests"
        sessionId={sessionId}
        viewToken={viewToken}
        active={active["29-goalfests"] ?? false}
      />
    </fieldset>

    {/* Wave 1A — Custom Designs tab: published user-authored overlays. */}
    {overlayBuilderEnabled ? (
      <div className="mt-6 space-y-3">
        <div className="flex items-center gap-3 border-b border-[var(--ink-4)]/50 pb-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-2)]">
            Custom Designs
          </h2>
          <span className="rounded-sm border border-[var(--signal)]/30 bg-[var(--signal)]/8 px-1.5 py-px font-mono text-[9px] text-[var(--signal)]">
            Beta
          </span>
        </div>
        <CustomDesignsTab
          designs={customDesigns}
          sessionId={sessionId}
          viewToken={viewToken}
          canTrigger={canTrigger}
          enabled={overlayBuilderEnabled}
          triggerAction={({ overlayKey, sessionId: sid }) => {
            // User design overlays are driven purely via postMessage from
            // CustomDesignCard's handleTrigger — this callback is a no-op
            // server-side (user slugs are not in V2_OVERLAY_KEYS so the
            // standard actions.ts gate would reject them). The card's
            // onTrigger handler posts {type:'show'} to the iframe directly.
            void overlayKey;
            void sid;
          }}
          clearAction={({ overlayKey, sessionId: sid }) => {
            void overlayKey;
            void sid;
          }}
        />
      </div>
    ) : null}
    </>
  );
}
