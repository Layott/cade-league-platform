/**
 * Rule 5.4 disciplinary ladder — AUTHORITATIVE.
 *
 * All magnitudes come from `CADE_Elite_League_Rulebook_v1_7.docx` §5.4 table
 * (late arrival), §3.4.4.1/2 (absence), §5.5 (social media), and §5 (dress
 * code). Screenshot provenance and the docx-page-break extraction caveat are
 * recorded in `KNOWLEDGE/extracted/PLAN11-LADDER-GAPS.md`.
 *
 * Every ladder row carries an inline comment quoting the rulebook clause
 * verbatim. Reviewers reject any new ladder entry lacking a quote.
 *
 * Called by `server/attendance/penalty.ts openAutoCase` with the PRIOR
 * offense count (`disciplinary_precedents.offense_count`) — the returned
 * `LadderOutcome` describes what this (N+1)th offense should trigger.
 */

export const SEASON_REMAINING = Number.MAX_SAFE_INTEGER;

export type LadderOutcome = {
  /** Goal-difference deduction applied via sanction_type='gd_deduction'. */
  gdDeduction: number;
  /** League-points deduction applied via sanction_type='point_deduction'. */
  pointDeduction: number;
  /** 'none' = log only; 'warning' + 'disciplinary' open a case row. */
  createCase: "none" | "warning" | "disciplinary";
  /** Number of match days the player is suspended; `SEASON_REMAINING` = full ban. */
  suspensionMatchDays: number;
  /** If true, auto-apply a 3-0 forfeit for the player's scheduled match today. */
  autoForfeit: boolean;
  /** Verbatim rulebook quote — required for audit trail + reviewer confidence. */
  rulebookClause: string;
};

// --- Late arrival ladder -------------------------------------------------
// Source: Rulebook §5.4, table "Late Arrival ladder (AUTHORITATIVE)".
// Offenses 2-3 deduct Goal Difference (applied to next scheduled match);
// 4-5 deduct league points; 6 is season ban + IDC → void propagation.

const LATE_LADDER: readonly LadderOutcome[] = [
  // Offence 1 (priorCount = 0):
  // Rule §5.4 Late Arrival 1st offence: "Formal written warning"
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "none",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause: 'Rule §5.4 Late Arrival 1st offence: "Formal written warning"',
  },
  // Offence 2 (priorCount = 1):
  // Rule §5.4 Late Arrival 2nd offence: "−3 Goal Difference applied to next scheduled match"
  {
    gdDeduction: 3,
    pointDeduction: 0,
    createCase: "warning",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause:
      'Rule §5.4 Late Arrival 2nd offence: "-3 Goal Difference applied to next scheduled match"',
  },
  // Offence 3 (priorCount = 2):
  // Rule §5.4 Late Arrival 3rd offence: "−3 Goal Difference (accumulated GD now −6)"
  {
    gdDeduction: 3,
    pointDeduction: 0,
    createCase: "warning",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause:
      'Rule §5.4 Late Arrival 3rd offence: "-3 Goal Difference (accumulated GD now -6)"',
  },
  // Offence 4 (priorCount = 3):
  // Rule §5.4 Late Arrival 4th offence: "−1 League Point deducted"
  {
    gdDeduction: 0,
    pointDeduction: 1,
    createCase: "disciplinary",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause: 'Rule §5.4 Late Arrival 4th offence: "-1 League Point deducted"',
  },
  // Offence 5 (priorCount = 4):
  // Rule §5.4 Late Arrival 5th offence: "−3 League Points deducted"
  {
    gdDeduction: 0,
    pointDeduction: 3,
    createCase: "disciplinary",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause: 'Rule §5.4 Late Arrival 5th offence: "-3 League Points deducted"',
  },
  // Offence 6 (priorCount = 5):
  // Rule §5.4 Late Arrival 6th offence: "Season ban + IDC review" (triggers Rule 3.4.4.2 void propagation)
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "disciplinary",
    suspensionMatchDays: SEASON_REMAINING,
    autoForfeit: false,
    rulebookClause:
      'Rule §5.4 Late Arrival 6th offence: "Season ban + IDC review" (triggers Rule 3.4.4.2 void propagation)',
  },
] as const;

export function computeLateSanction(priorCount: number): LadderOutcome {
  const idx = Math.max(0, Math.min(priorCount, LATE_LADDER.length - 1));
  return LATE_LADDER[idx];
}

// --- Absence ladder ------------------------------------------------------
// Rule 3.4.4.1: one unexcused forfeit → formal written warning.
// Rule 3.4.4.2: second unexcused forfeit → season suspension + IDC → void propagation.
// No intermediate tiers — absence goes straight to forfeit + escalation.

const ABSENT_LADDER: readonly LadderOutcome[] = [
  // Offence 1 (priorCount = 0):
  // Rule §3.4.4.1: "A player who records ONE (1) unexcused forfeit in a season will receive a formal written warning."
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "warning",
    suspensionMatchDays: 0,
    autoForfeit: true,
    rulebookClause:
      'Rule §3.4.4.1: "A player who records ONE (1) unexcused forfeit in a season will receive a formal written warning."',
  },
  // Offence 2 (priorCount = 1):
  // Rule §3.4.4.2: "A SECOND unexcused forfeit results in automatic suspension from all future matches in the season and an immediate IDC referral…"
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "disciplinary",
    suspensionMatchDays: SEASON_REMAINING,
    autoForfeit: true,
    rulebookClause:
      'Rule §3.4.4.2: "A SECOND unexcused forfeit results in automatic suspension from all future matches in the season and an immediate IDC referral for review and potential season disqualification."',
  },
] as const;

export function computeAbsentSanction(priorCount: number): LadderOutcome {
  const idx = Math.max(0, Math.min(priorCount, ABSENT_LADDER.length - 1));
  return ABSENT_LADDER[idx];
}

// --- Social media ladder --------------------------------------------------
// Rule §5.5 Social Media Obligation. Separate from attendance but must coexist.

const SOCIAL_MEDIA_LADDER: readonly LadderOutcome[] = [
  // 1st week:
  // Rule §5.5 Social Media 1st week of non-compliance: "Formal written warning"
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "warning",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause:
      'Rule §5.5 Social Media 1st week of non-compliance: "Formal written warning"',
  },
  // 2nd consecutive week:
  // Rule §5.5 Social Media 2nd consecutive week: "−1 league point deduction"
  {
    gdDeduction: 0,
    pointDeduction: 1,
    createCase: "disciplinary",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause:
      'Rule §5.5 Social Media 2nd consecutive week: "-1 league point deduction"',
  },
  // 3rd consecutive week or ongoing:
  // Rule §5.5 Social Media 3rd consecutive/ongoing: "−3 league points + IDC review"
  {
    gdDeduction: 0,
    pointDeduction: 3,
    createCase: "disciplinary",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause:
      'Rule §5.5 Social Media 3rd consecutive/ongoing: "-3 league points + IDC review"',
  },
] as const;

export function computeSocialMediaSanction(priorCount: number): LadderOutcome {
  const idx = Math.max(0, Math.min(priorCount, SOCIAL_MEDIA_LADDER.length - 1));
  return SOCIAL_MEDIA_LADDER[idx];
}

// --- Dress code ladder ----------------------------------------------------
// Rulebook §5 (Dress Code table).

const DRESS_CODE_LADDER: readonly LadderOutcome[] = [
  // 1st:
  // Rule §5 Dress Code 1st offence: "Formal written warning"
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "warning",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause: 'Rule §5 Dress Code 1st offence: "Formal written warning"',
  },
  // 2nd:
  // Rule §5 Dress Code 2nd offence: "Refused entry; match forfeit if unable to change in time"
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "disciplinary",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause:
      'Rule §5 Dress Code 2nd offence: "Refused entry; match forfeit if unable to change in time"',
  },
  // 3rd:
  // Rule §5 Dress Code 3rd offence: "IDC review and possible points deduction"
  {
    gdDeduction: 0,
    pointDeduction: 0,
    createCase: "disciplinary",
    suspensionMatchDays: 0,
    autoForfeit: false,
    rulebookClause:
      'Rule §5 Dress Code 3rd offence: "IDC review and possible points deduction"',
  },
] as const;

export function computeDressCodeSanction(priorCount: number): LadderOutcome {
  const idx = Math.max(0, Math.min(priorCount, DRESS_CODE_LADDER.length - 1));
  return DRESS_CODE_LADDER[idx];
}
