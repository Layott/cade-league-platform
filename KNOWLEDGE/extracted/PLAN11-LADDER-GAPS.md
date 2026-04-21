# Plan 11 ladder intel — RESOLVED 2026-04-21

Source: rulebook `CADE_Elite_League_Rulebook_v1_7.docx` §5.4, §5.5. Rows 2-5 of the Late Arrival table were dropped by python-docx during extraction (table split across page break → rows blanked). User supplied actual values via rendered screenshots at `C:\Users\Sweez\Pictures\Screenshots\Screenshot 2026-04-21 {125559,125625,125635,125642,125649}.png`.

---

## §5.4 Punctuality & Late Arrival

Mandatory check-in times: Saturday 9:00 AM / Sunday 12:00 PM (Africa/Lagos). Physical presence without LOC check-in does not count.

### Late Arrival ladder (AUTHORITATIVE)

| Offence | Sanction |
|---|---|
| 1st | Formal written warning |
| 2nd | **−3 Goal Difference** applied to next scheduled match |
| 3rd | **−3 Goal Difference** (accumulated GD now −6) |
| 4th | **−1 League Point** deducted |
| 5th | **−3 League Points** deducted |
| 6th | **Season ban** + IDC review |

**Key semantics:**
- Offenses 2-3 are **GD deductions**, not point deductions — applied to next scheduled match's recorded GD.
- Offenses 4-5 are **point deductions**.
- Offense 6 is **season-long suspension** → triggers void-match propagation per Rule 3.4.4.2.
- Rulebook phrases "accumulated GD now −6" on 3rd offense explicitly — meaning GD deductions stack across offenses, not reset per match.

---

## §5.5 Social Media Obligation ladder

| Offence | Sanction |
|---|---|
| 1st week of non-compliance | Formal written warning |
| 2nd consecutive week | −1 league point deduction |
| 3rd consecutive week or ongoing | −3 league points + IDC review |

Relevant for Plan 13 content obligations module.

---

## §5 Dress Code ladder (no gap — already extracted correctly)

| Offence | Sanction |
|---|---|
| 1st | Formal written warning |
| 2nd | Refused entry; match forfeit if unable to change in time |
| 3rd | IDC review and possible points deduction |

---

## §6.3 Sanctions Overview (for reference)

| Category | Min | Max |
|---|---|---|
| 1st Unexcused Forfeit | Formal written warning | Formal written warning |
| 2nd Unexcused Forfeit | Season suspension + IDC review | Season disqualification |
| 1st Equipment | Formal written warning | Formal written warning |
| 2nd Equipment | Match forfeit | Match forfeit |
| 3rd Equipment | IDC review | Possible suspension/ban |
| Social Media (1st week) | Formal warning | Formal warning |
| Social Media (repeat) | −1 league point | −3 points + IDC review |
| Late Arrival | See §5.4 scale | Season ban (6th offence) |
| Dress Code | Formal warning | IDC review + deduction |
| Betting | Suspension pending investigation | Permanent ban + law enforcement |
| Match Fixing | Permanent ban + prize forfeiture | Permanent ban + law enforcement |
| Unauthorized Access | ₦25,000 fine from caution fee | ₦25,000 + IDC referral for repeat |

---

## Rule 3.4.4.2 Void-match propagation (verbatim)

> "A player who records ONE (1) unexcused forfeit in a season will receive a formal written warning. A SECOND unexcused forfeit results in automatic suspension from all future matches in the season and an immediate IDC referral for review and potential season disqualification. When a player is suspended under this rule, their previously played match results stand unchanged in the league table, but all remaining scheduled matches involving the suspended player are voided and do not count toward any player's points, goal difference, or other standings metrics."

Triggers: 2nd unexcused forfeit **OR** late-arrival 6th-offence season ban.

---

## Plan 11 spec corrections needed

The original Plan 11 spec at `docs/superpowers/specs/2026-04-21-plan-11-void-propagation-and-warnings.md` §2.1 used a placeholder ladder (all point deductions). Actual ladder mixes GD + points. Required changes:

1. **§2.1 ladder table** — replace point-only values with real GD+points mix above.
2. **`LadderOutcome` type** — add `gdDeduction: number` field alongside `pointDeduction`.
3. **Disciplinary action types** — confirm existing `sanction_type` enum supports `'goal_difference_penalty'` (it does per Plan 4 migration).
4. **`computeLateSanction`** — offenses 2-3 return `{ gdDeduction: 3, pointDeduction: 0, ... }`; offenses 4-5 return `{ gdDeduction: 0, pointDeduction: [1,3][offense-4], ... }`; offense 6 returns `{ pointDeduction: 0, gdDeduction: 0, suspensionMatchDays: SEASON_REMAINING, ... }`.
5. **Rulebook clause comments** on each ladder row — now trivially copyable from this file.

Ladder is **unblocked**. Plan 11 ready for execution.
