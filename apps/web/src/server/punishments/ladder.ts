// Rule 5.4 / §6.3 sanction ladder for the auto-fill form.
//
// Source of truth: `KNOWLEDGE/extracted/PLAN11-LADDER-GAPS.md`.
//   - late_arrival: warning → gd -3 → gd -3 (stacking) → -1 pts → -3 pts → season ban
//   - forfeit:     warning → season ban (Rule 3.4.4.2)
//   - equipment:   warning → match forfeit → IDC review / possible ban
//   - social_media:warning → -1 pt → -3 pts
//   - dress_code:  warning → match forfeit → IDC review / possible points deduction
//   - unauthorized_access: fine + admin review (modelled as point_deduction magnitude 0 + note)
//   - betting / match_fixing: immediate ban
//   - absent / other: conservative warning ladder
//
// This is a *pragmatic* mapping — the admin always sees the filled values as
// defaults and can edit them before submit.

import type { IssueInput } from "./index";

export type IncidentType = IssueInput["incidentType"];
export type SanctionType = IssueInput["sanctionType"];

export type LadderRung = {
  sanctionType: SanctionType;
  magnitude: number;
  label: string;
  /** Short plain-English blurb for the inline hint card. */
  rationale: string;
  /** If true, the admin must pick a window before submit (bans / season ban). */
  requiresWindow: boolean;
};

type Ladder = {
  rungs: LadderRung[];
};

export const LADDERS: Record<IncidentType, Ladder> = {
  late_arrival: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "1st offense — written warning",
        rationale: "Rule §5.4: first late arrival is a formal written warning.",
        requiresWindow: false,
      },
      {
        sanctionType: "gd_deduction",
        magnitude: 3,
        label: "2nd offense — GD -3",
        rationale: "Rule §5.4: 2nd offense is a -3 GD on the next scheduled match.",
        requiresWindow: false,
      },
      {
        sanctionType: "gd_deduction",
        magnitude: 3,
        label: "3rd offense — GD -3 (accumulated -6)",
        rationale: "Rule §5.4: 3rd offense adds another -3 GD — accumulated -6.",
        requiresWindow: false,
      },
      {
        sanctionType: "point_deduction",
        magnitude: 1,
        label: "4th offense — -1 league point",
        rationale: "Rule §5.4: 4th offense is a -1 league-point deduction.",
        requiresWindow: false,
      },
      {
        sanctionType: "point_deduction",
        magnitude: 3,
        label: "5th offense — -3 league points",
        rationale: "Rule §5.4: 5th offense is a -3 league-point deduction.",
        requiresWindow: false,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "6th offense — season ban + IDC review",
        rationale:
          "Rule §5.4: 6th offense is a season ban. Void-match propagation will run against the ban window.",
        requiresWindow: true,
      },
    ],
  },
  forfeit: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "1st unexcused forfeit — written warning",
        rationale: "Rule §6.3 / §3.4.4.2: first unexcused forfeit is a formal written warning.",
        requiresWindow: false,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "2nd unexcused forfeit — season ban",
        rationale:
          "Rule §3.4.4.2: 2nd unexcused forfeit auto-suspends the player + void-propagates all remaining fixtures.",
        requiresWindow: true,
      },
    ],
  },
  equipment: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "1st equipment — written warning",
        rationale: "Rule §6.3: first equipment violation is a formal written warning.",
        requiresWindow: false,
      },
      {
        sanctionType: "forfeit",
        magnitude: 0,
        label: "2nd equipment — match forfeit",
        rationale: "Rule §6.3: 2nd equipment violation forfeits the affected match.",
        requiresWindow: false,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "3rd equipment — IDC review / possible ban",
        rationale: "Rule §6.3: 3rd equipment violation → IDC review, possible suspension.",
        requiresWindow: true,
      },
    ],
  },
  social_media: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "1st week non-compliance — written warning",
        rationale: "Rule §5.5: first week of non-compliance is a formal written warning.",
        requiresWindow: false,
      },
      {
        sanctionType: "point_deduction",
        magnitude: 1,
        label: "2nd week — -1 league point",
        rationale: "Rule §5.5: 2nd consecutive week is a -1 league-point deduction.",
        requiresWindow: false,
      },
      {
        sanctionType: "point_deduction",
        magnitude: 3,
        label: "3rd+ week — -3 league points",
        rationale: "Rule §5.5: 3rd+ consecutive week is -3 league points + IDC review.",
        requiresWindow: false,
      },
    ],
  },
  dress_code: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "1st offense — written warning",
        rationale: "Rule §5: first dress-code violation is a formal written warning.",
        requiresWindow: false,
      },
      {
        sanctionType: "forfeit",
        magnitude: 0,
        label: "2nd offense — match forfeit",
        rationale: "Rule §5: 2nd offense — refused entry, forfeit if unable to change.",
        requiresWindow: false,
      },
      {
        sanctionType: "point_deduction",
        magnitude: 1,
        label: "3rd offense — IDC review / points deduction",
        rationale: "Rule §5: 3rd offense — IDC review, possible points deduction.",
        requiresWindow: false,
      },
    ],
  },
  unauthorized_access: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "1st — written warning + ₦25,000 caution-fee debit",
        rationale:
          "Rule §6.3: unauthorized access — ₦25,000 fine from caution fee; log as warning + note.",
        requiresWindow: false,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "Repeat — IDC referral (possible ban)",
        rationale: "Rule §6.3: repeat unauthorized access → IDC referral + possible suspension.",
        requiresWindow: true,
      },
    ],
  },
  betting: {
    rungs: [
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "Season suspension pending investigation",
        rationale:
          "Rule §6.3: suspected betting triggers an immediate suspension pending investigation.",
        requiresWindow: true,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "Confirmed — permanent ban + law enforcement",
        rationale:
          "Rule §6.3: confirmed betting is a permanent ban + law-enforcement referral.",
        requiresWindow: true,
      },
    ],
  },
  match_fixing: {
    rungs: [
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "Permanent ban + prize forfeiture",
        rationale: "Rule §6.3: match fixing is a permanent ban and prize forfeiture.",
        requiresWindow: true,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "Permanent ban + law enforcement",
        rationale: "Rule §6.3: repeat match fixing → permanent ban + law-enforcement referral.",
        requiresWindow: true,
      },
    ],
  },
  absent: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "1st absence — written warning",
        rationale: "Conservative default for unexcused absences. Adjust if tied to a forfeit.",
        requiresWindow: false,
      },
      {
        sanctionType: "point_deduction",
        magnitude: 1,
        label: "2nd absence — -1 league point",
        rationale: "Repeat absences — -1 league point + IDC review.",
        requiresWindow: false,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "3rd+ absence — season ban / IDC review",
        rationale: "Persistent absences → season ban + IDC review.",
        requiresWindow: true,
      },
    ],
  },
  other: {
    rungs: [
      {
        sanctionType: "warning",
        magnitude: 0,
        label: "Written warning",
        rationale: "Default — admin should set sanction + magnitude manually if the ladder doesn't apply.",
        requiresWindow: false,
      },
      {
        sanctionType: "point_deduction",
        magnitude: 1,
        label: "Repeat — -1 league point",
        rationale: "Default repeat — -1 league point; adjust manually.",
        requiresWindow: false,
      },
      {
        sanctionType: "ban",
        magnitude: 0,
        label: "Severe repeat — IDC review / ban",
        rationale: "Default severe — IDC review, possibly ban; adjust manually.",
        requiresWindow: true,
      },
    ],
  },
};

/**
 * Pick the ladder rung for the given incident type and 1-indexed offense
 * count. If offenseNumber exceeds the number of rungs defined, returns the
 * last rung (the ladder's ceiling).
 */
export function pickLadderRung(
  incidentType: IncidentType,
  offenseNumber: number,
): LadderRung {
  const ladder = LADDERS[incidentType];
  const n = Math.max(1, Math.floor(offenseNumber));
  const idx = Math.min(ladder.rungs.length - 1, n - 1);
  return ladder.rungs[idx];
}
