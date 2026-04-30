"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
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
};

export function ControlGrid({
  sessionId,
  viewToken,
  upcoming,
  canTrigger,
  active,
  lowerThirdSlots,
  playerOptions = [],
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
    </fieldset>
  );
}
