"use client";

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

/**
 * Plan 51 — control card grid layout.
 *
 * Renders the 16 controls in a responsive grid (3-up wide, 2-up medium,
 * 1-up narrow) per spec §8.2. Each card is independent — no shared
 * state between them. The `canTrigger` flag is consumed inside each
 * control via the perm-gated server actions, so we don't conditionally
 * render — we let the actions reject if perm flips. The page shows a
 * banner when `canTrigger` is false.
 */
export type ControlGridProps = {
  sessionId: string;
  viewToken: string | null;
  upcoming: UpcomingMatch[];
  canTrigger: boolean;
};

export function ControlGrid({
  sessionId,
  viewToken,
  upcoming,
  canTrigger,
}: ControlGridProps) {
  // canTrigger surfaced via fieldset disabling so readers see the form
  // shape but cannot submit. Per-card `disabled` props on individual
  // submit buttons would scatter the responsibility — fieldset wrap
  // keeps it one place.
  return (
    <fieldset
      disabled={!canTrigger}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      data-testid="v2-control-grid"
      aria-disabled={!canTrigger}
    >
      <BrbControl sessionId={sessionId} viewToken={viewToken} />
      <TimerControl sessionId={sessionId} viewToken={viewToken} />
      <H2H2Control sessionId={sessionId} viewToken={viewToken} />
      <H2H3Control sessionId={sessionId} viewToken={viewToken} />
      <H2H5Control sessionId={sessionId} viewToken={viewToken} />
      <LeaderboardControl sessionId={sessionId} viewToken={viewToken} />
      <LowerThirdControl sessionId={sessionId} viewToken={viewToken} />
      <SecondaryScoreBugControl
        sessionId={sessionId}
        viewToken={viewToken}
      />
      <UpNextBugControl
        sessionId={sessionId}
        viewToken={viewToken}
        upcoming={upcoming}
      />
      <MatchScoresDayControl sessionId={sessionId} viewToken={viewToken} />
      <StartingSoonControl sessionId={sessionId} viewToken={viewToken} />
      <StreamEndedControl sessionId={sessionId} viewToken={viewToken} />
      <TopScorersControl sessionId={sessionId} viewToken={viewToken} />
      <OrgsControl sessionId={sessionId} viewToken={viewToken} />
      <CoachesControl sessionId={sessionId} viewToken={viewToken} />
      <PenaltiesControl sessionId={sessionId} viewToken={viewToken} />
    </fieldset>
  );
}
