# Plan 41 — Player Self-Service Panels (stats, sanctions, appeals, squad status)

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Approved, ready for implementation plan
**Origin HEAD:** `24bf61f`
**Depends on:** Plan 40 (profile shell + identity + announcement modal), Plan 10 (squad submissions), Plan 11 (sanctions), Plan 13A (appeals server modules), Plan 13B (appeals UI)

---

## 1. Goals

When a signed-in user has role `player` (exclusive or in combination with other roles), their `/profile` surface the following data sections that are gated to self-view + admin-view only:

1. **Season stats card** — Matches Played, W-D-L, GF/GA, GD, Points, punishment deductions, **current position in the standings table**.
2. **Form strip** — last 5 results as W/D/L pills with opponent tooltip.
3. **Current streaks** — longest active win streak, unbeaten streak, goalscoring streak (games).
4. **Per-match history** — paginated list of every match involving the player in the active season (opponent, score, date, link to match detail).
5. **Head-to-head grid** — card per other player showing aggregate W-D-L + GF-GA vs that opponent.
6. **Sanctions list** — every non-soft-deleted `disciplinary_actions` row for this player, with an **Appeal** button visible only when `businessDaysSince(issued_at) ∈ [1, 5]` AND `sanction_type` ≠ `auto_forfeit` AND no open/approved appeal already exists.
7. **Squad status widget** — current week's submission state + countdown to Thursday 10:00 WAT deadline. Links to `/player/squad` (Plan 10 page).

Three further surfaces outside `/profile`:

8. **Player dashboard card** — `/player` lands with a prominent "Squad due in X hrs" card (or "Window closed — Friday change window opens YYY" / "Submission approved").
9. **Persistent banner** — `<SquadDueBanner />` on every `/player/**` route until the player's squad is submitted OR the window closes.
10. **Admin reopen** — `/admin/squads/[id]` grows a "Reopen submission" button that flips `squad_submissions.status` back to `pending` and audits the action.

---

## 2. Success criteria

1. Player logs in → `/profile` shows sections 1–7 populated with their real data.
2. Other authenticated user (non-admin, non-self) cannot reach player's profile (`/profile/<otherUserId>` → 403).
3. Admin can view any player's profile + see the same sections; admin does NOT get an Appeal button on the player's rows (appeal is self-only).
4. On day 0 (same business day as sanction), Appeal button is hidden. On day 1 through day 5 (business days elapsed since `issued_at`), button is visible. On day 6+, hidden. On `sanction_type='auto_forfeit'`, hidden at all times.
5. Clicking Appeal opens a form → reuses Plan 13B appeal submission flow. Submission blocks a second Appeal on the same action.
6. `/player` dashboard card shows correct state: pre-deadline shows countdown; post-deadline + pre-Friday shows "Window closed, waiting for match day"; during Friday-change-window shows "One change allowed"; once approved shows "Squad approved — GL!".
7. Banner persistent on `/player/**` until submitted or window closed.
8. Admin reopen: press button → confirmation modal → on confirm, submission returns to `pending`, audit row inserted, player receives notification, banner + card update.

---

## 3. Architecture

### 3.1 Extending `/profile`

Plan 40 ships a `<ProfilePanel>` + `<RolesList>` + `<IdentityCard>`. Plan 41 mounts additional conditional panels when `profile.hasPlayerRole === true`:

- `<SeasonStatsCard />`
- `<FormStrip />`
- `<CurrentStreaks />`
- `<MatchHistory pageSize={10} />` with pagination
- `<H2HGrid />`
- `<SanctionsList selfView={boolean} />` — Appeal button only when `selfView === true`
- `<SquadStatusWidget />`

Panels are server components; pagination inside MatchHistory is a URL param (`?mh=2`).

### 3.2 Server modules

- `apps/web/src/server/profile/playerStats.ts`:
  - `getSeasonStats(sb, playerId, seasonId)` → `{ mp, w, d, l, gf, ga, gd, points, pointsDeducted, gdDeducted, tablePosition }`.
  - `getFormLastN(sb, playerId, seasonId, n)` → `Array<{ opponentDisplayName, result: 'W'|'D'|'L', matchId, matchDate }>`.
  - `getCurrentStreaks(sb, playerId, seasonId)` → `{ winStreak, unbeatenStreak, goalScoringStreak }`.
  - `getMatchHistory(sb, playerId, seasonId, { page, pageSize })` → `{ rows: Match[], pageCount: number }`.
- `apps/web/src/server/profile/h2h.ts`:
  - `getH2HGrid(sb, playerId, seasonId)` → array of `{ opponentId, opponentDisplayName, w, d, l, gf, ga }`.
- `apps/web/src/server/appeals/window.ts` (new helper):
  - `isAppealWindowOpen(issuedAt: Date, now: Date)` → boolean. Returns true iff business-days-between(issued, now) ∈ [1, 5]. Uses existing `lib/businessDays.ts`.

Reuses:
- `server/squads/week.ts` for deadline logic.
- `server/appeals/*` from Plan 13A for submit flow.
- `server/sanctions/read.ts` (if exists) — otherwise add `listPlayerSanctions(sb, playerId)`.

### 3.3 Components

New files under `apps/web/src/components/profile/`:

- `SeasonStatsCard.tsx`
- `FormStrip.tsx`
- `CurrentStreaks.tsx`
- `MatchHistory.tsx`
- `H2HGrid.tsx`
- `SanctionsList.tsx`
- `AppealButton.tsx` (client — opens Plan 13B appeal form in modal)
- `SquadStatusWidget.tsx`
- `SquadDueBanner.tsx`
- `SquadDueCard.tsx` (larger variant for dashboard)

All take server-fetched data as props. `AppealButton` is the only client island.

### 3.4 Squad due surfaces

- `apps/web/src/app/player/page.tsx` — add `<SquadDueCard />` above existing dashboard content.
- `apps/web/src/app/player/layout.tsx` — mount `<SquadDueBanner />` just under the chrome.
- Both share one server helper `getCurrentSquadStatus(sb, playerId, now)` that returns a discriminated union: `{ kind: 'pre_deadline', hoursUntil, deadline }`, `{ kind: 'submitted_pending' }`, `{ kind: 'submitted_approved' }`, `{ kind: 'submitted_rejected', reason }`, `{ kind: 'window_closed' }`, `{ kind: 'friday_change_window', changesRemaining }`, `{ kind: 'reopened_by_admin', reopenedAt, reopenedBy }`.

### 3.5 Admin reopen

- `apps/web/src/app/admin/squads/[id]/page.tsx` — add "Reopen submission" button, visible only when `status ∈ {'approved','rejected','auto_warned'}`.
- `apps/web/src/app/admin/squads/[id]/actions.ts` → `reopenSubmissionAction(submissionId)`:
  - Perm check: `squads.reopen` (new perm).
  - Flip `squad_submissions.status = 'pending'` + clear `approved_by_user_id`/`approved_at`/`rejection_reason`.
  - Write to `audit_events` (via trigger) with `metadata = { reopened: true, prior_status }`.
  - Send `notifications` row to the player — type `'squad_reopened'`.

### 3.6 Permission model additions

- New perm `squads.reopen` (admin-only by default) — seeded via migration.
- Appeal submission already gated by `appeals.create` (Plan 13A). Added: `AppealButton` checks window client-side + server rejects late submits.

---

## 4. Data model changes

- No schema change to `squad_submissions` — `status='pending'` is already reachable; just allow transition from approved/rejected back.
- New migration `20260509000001_plan41_squads_reopen_perm_seed.sql`:
  - Insert `('admin', 'squads.reopen')` into `role_permissions`.
- New migration `20260509000002_plan41_notifications_squad_reopened.sql`:
  - Extend `notifications.type` CHECK with `'squad_reopened'`.

Alternative considered: record reopens in a new `squad_reopen_events` table. Rejected — audit trigger + notifications cover it.

---

## 5. Appeal window logic

```ts
function isAppealWindowOpen(issuedAt: Date, now: Date, sanctionType: SanctionType): boolean {
  if (sanctionType === "auto_forfeit") return false;
  const businessDaysElapsed = businessDaysBetween(issuedAt, now);
  return businessDaysElapsed >= 1 && businessDaysElapsed <= 5;
}
```

- Day 0 (same business day) → window closed (cooling-off).
- Day 1..5 (business days elapsed since issue) → open.
- Day 6+ → closed.
- `businessDaysBetween` uses existing `lib/businessDays.ts`; holidays still deferred (Phase 1A scope decision).
- Appeal form itself enforces one-appeal-per-action constraint (DB unique on `appeals(disciplinary_action_id) where status != 'withdrawn'`).

---

## 6. UI details

- StatsCard: 2-column grid at >=lg, stacked on mobile. Numbers in `font-display`, labels `font-mono` tiny caps.
- FormStrip: 5 square pills, leftmost = oldest, rightmost = most recent. Tooltip on hover shows opponent + score.
- H2HGrid: 3-col at lg, 2-col md, 1-col sm.
- SanctionsList: table at lg, stacked cards mobile. Row status pill colours: warning=`amber`, formal_warning=`amber` stroked, suspension=`rose`, points_deduction=`rose`, gd_deduction=`rose`, forfeit=`rose-dark`, auto_forfeit=`rose-dark` with "No appeal" pill, fine=`neutral`.
- Banner: 40 px tall, full-width, green background pre-deadline → amber 6 hrs before → rose after deadline. Right-side "Submit now →" CTA.
- SquadDueCard: 200 px card with countdown + CTA button.

---

## 7. Testing

### Unit
- `playerStats.test.ts`: ≥ 6 cases — stats aggregation, form last-5 with <5 matches, streaks on no-matches vs partial vs full season.
- `h2h.test.ts`: ≥ 4 cases — self excluded, no games vs opponent returns zeros, bidirectional aggregation (home + away).
- `appeals/window.test.ts`: ≥ 7 boundary cases — day 0 / day 1 / day 5 / day 6 / weekend-skipped / auto_forfeit always false / issuedAt future.
- `profile/read.test.ts` (extended from Plan 40): admin cross-view loads player sections, non-admin stranger blocked.
- `squads/squadReopenAction.test.ts`: permission denial, successful transition, notification inserted.

### E2E
- `player-profile-sanctions-and-appeal.spec.ts`: login as player with seeded sanction issued yesterday → see Appeal button → click → submit → sanction row shows "Appeal pending"; try again → button hidden.
- `admin-reopens-squad.spec.ts`: admin opens a rejected submission → click Reopen → confirm → player sees "Reopened" card; player submits new squad.
- `player-dashboard-squad-due.spec.ts`: before Thursday 10am → card shows countdown; after deadline + before Friday → "Window closed".

---

## 8. Rollout + risks

- Streaks query must filter `result_type != 'void'` to align with Plan 11.
- H2H aggregation is O(N²) — at 13 players + 78 matches it's trivial; guard with a per-pair cache if we ever scale.
- Admin reopen is a destructive-reversible action; confirmation modal must show "prior status" + warning "the player will receive a notification and can resubmit".
- AppealButton business-day computation runs client-side for UX but server-re-validates in the action.

---

## 9. Acceptance gate

Plan 41 is done when:
- `npm run test` + `npm run lint` + `npm run build` clean.
- 3 new E2E specs pass.
- Manual smoke: player sees all 7 sections populated with real seed data.
- Admin reopen flow end-to-end with notification fired.
- Banner + dashboard card visible with correct state across `pre_deadline`, `window_closed`, `submitted_approved`, `reopened_by_admin`.
