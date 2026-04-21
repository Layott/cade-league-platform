# Plan 11 ladder intel — extracted from rulebook v1.7

Date: 2026-04-21
Source: `KNOWLEDGE/extracted/CADE_Elite_League_Rulebook_v1_7.md`

## What the rulebook explicitly states

### §5.4 Punctuality & Late Arrival
- Mandatory arrival time: Saturday 9:00 AM / Sunday 12:00 PM (Africa/Lagos).
- Being physically in the building but not checked in with LOC does not count as on-time.

### Late Arrival Offence table (rulebook lines 431-438)

| Offence | Sanction |
|---|---|
| 1st | Formal written warning |
| 2nd | **BLANK IN DOCX** |
| 3rd | **BLANK IN DOCX** |
| 4th | **BLANK IN DOCX** |
| 5th | **BLANK IN DOCX** |
| 6th | Season ban + IDC review |

### Sanctions overview table (rulebook lines 441-454)
- Late Arrival min sanction: "See Section 5.4 scale"
- Late Arrival max sanction: "Season ban (6th offence)"

## Rule 3.4.4 Forfeits
- **3.4.4.1** — Match declared 3-0 forfeit when: (a) fails to appear within 5-min grace after call, (b) deliberate disconnect without auth, (c) IDC disqualification, (d) voluntary forfeit.
- **3.4.4.2** (FULL TEXT, extracted cleanly): *"A player who records ONE (1) unexcused forfeit in a season will receive a formal written warning. A SECOND unexcused forfeit results in automatic suspension from all future matches in the season and an immediate IDC referral for review and potential season disqualification. When a player is suspended under this rule, their previously played match results stand unchanged in the league table, but all remaining scheduled matches involving the suspended player are voided and do not count toward any player's points, goal difference, or other standings metrics."*
  - Trigger: 2nd unexcused forfeit in a season.
  - Past results: stand unchanged.
  - Remaining scheduled matches: **voided**, excluded from GD/points for ALL players.
  - This matches Plan 11 §4 void-propagation design exactly — no changes needed.
- **3.4.4.3** — Forfeits preceding suspicious betting → auto IDC referral for integrity investigation.

## §4.1 Squad submissions (Plan 10 input)
- Deadline: 10:00 AM Thursday.
- 1st late submission: formal written warning.
- 2nd consecutive late: match forfeit for that weekend's 1st scheduled match.
- 3rd consecutive: IDC review + possible suspension.

## §4.3 Squad Restrictions (Plan 10 validation rule values)
- **Budget cap:** 10,000,000 FUT coins (goalkeeper EXCLUDED from calc).
- **Min Nigerian items:** 1 in starting XI, must play first 45 minutes minimum.
- **Banned item types:** Evolution Players (EVOs), Season Pass players, Objective players.
- **Allowed:** Icons, Heroes — no quantity limit within budget.

## §6.4 Appeals (Plan 13 appeal workflow)
- 5 business days to file.
- Written submission to CADE Esports Board.
- 3 independent panel members review.
- Panel decision final + binding.

## §5.6 Unauthorized Access (Plan 13 caution ledger)
- ₦25,000 fine deducted from organisation caution fee.
- Org must top back up to ₦50,000 within 7 days or player ineligible.

## §2 Caution fee
- Organisation caution fee: ₦50,000 (due 24 April).

## §5.5 Match-day content (Plan 13 content obligations)
- Content slot allocated per player per match day by production team.
- Makeup window: Tuesday–Thursday of following week.
- Missing both slot + makeup without documented reason: -1 league point that week.

## Prize distribution (reference — manual disbursement only)
- Division 1 total pool: ₦3,000,000 (16 positions).
- 60 working days post-season conclusion.
- Withholding tax applies.
- **NOTE:** Per CLAUDE.md + v0.3 PRODUCT_STRUCTURE, prize disbursement is MANUAL bank transfer + ledger only. No Paystack, no automation. The rulebook mentions prize numbers but the platform does not touch them.

---

## Gaps requiring user input before Plan 11 is safe to build

1. **Late arrival ladder rows 2-5.** Docx cells are blank. ONLY genuine gap — cannot derive from rulebook; LOC policy supplies these values.
   - Either: user transcribes the actual LOC-set values
   - OR: Plan 11 ships with placeholder ladder + explicit TODO comment on every ladder row, swap in when LOC confirms.
2. ~~Rule 3.4.4.2 body text~~ — RESOLVED, clean extraction above.

## Recommendation

Plan 11 is Phase 1B Part C — not blocking Plans 9, 10, 12, 13. Ship those first. Come back to Plan 11 once LOC confirms the ladder values + 3.4.4.2 wording.
