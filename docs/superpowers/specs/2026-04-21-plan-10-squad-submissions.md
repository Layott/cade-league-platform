# Plan 10 — Phase 1B Part B: Squad submissions + Friday change window + squad validation

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Supersedes:** Phase 1B bullets 1, 2, 3 in `ESOCCER LEAGUE/PRODUCT_STRUCTURE.md` §8
**Depends on:** Plan 0 (foundations + audit), Plan 1 (auth/roles), Plan 2 (seasons/players), Plan 5 (attendance patterns), Plan 6 (cron + notifications), Plan 9 (Phase 1B Part A — role matrix expansion; this plan assumes `referee` and `loc` roles are live)

---

## 1. Goal + Success Criteria

### 1.1 Goal
Ship Phase 1B's squad pipeline: weekly squad submission with Thursday 10:00 WAT deadline, referee validation against per-season rules, and the Friday 21:00–22:00 WAT change window (one swap per player per week, referee-authorized on-page).

### 1.2 Success criteria (must all demo end-to-end locally)
1. A player authenticates, uploads a Futbin screenshot, hand-transcribes squad items, submits; server locks the submission.
2. After the Thursday 10:00 WAT cron tick, a player who did not submit receives an auto-warning on the offense ladder (1st / 2nd / 3rd) that shows in their disciplinary feed.
3. A referee opens `/admin/squads`, sees a pending submission, clicks it, views rule-violation flags (over-budget, missing Nigerian items, banned item), and approves or rejects with reason. Status flips; audit row fires.
4. On Friday at 21:05 WAT, the player opens `/player/squad/change`, picks a referee from the dropdown, swaps one player-out for one player-in; the swap logs in `squad_change_requests` with `authorized_by_ref_user_id` populated. A second attempt in the same week is rejected server-side.
5. At 20:59 WAT an attempt to POST the swap returns 409 "window closed". At 22:00:01 same thing.
6. `/players/[id]` shows the approved current-week squad (read-only) to the public.
7. Every mutable squad table has the generic audit trigger attached; a DELETE + UPDATE on any of them produces `audit_events` rows.
8. All soft-delete filters return expected results; `deleted_at IS NULL` enforced on every public read.

---

## 2. Architecture Overview

### 2.1 Module layout
All new server code lives in `apps/web/src/server/squads/`, mirroring `apps/web/src/server/attendance/`:

```
apps/web/src/server/squads/
  index.ts                     # public re-exports
  schemas.ts                   # Zod input schemas
  submit.ts                    # createSubmission, lockSubmission
  submit.test.ts
  validate.ts                  # evaluateRules(items, rule) → violations[]
  validate.test.ts
  review.ts                    # approveSubmission, rejectSubmission
  review.test.ts
  change.ts                    # requestChange with window enforcement
  change.test.ts
  rules.ts                     # CRUD on squad_validation_rules
  rules.test.ts
  deadline.ts                  # cron helpers: whoMissedDeadline, issueAutoWarning
  deadline.test.ts
  week.ts                      # weekStartForDate, thursdayAnchor, fridayWindowFor(weekStart)
  week.test.ts
  storage.ts                   # uploadScreenshot (signed URL helpers)
  storage.test.ts
  items.ts                     # replaceItemsForSubmission
  items.test.ts
  list.ts                      # listSubmissionsForWeek, getSubmissionForPlayer
  list.test.ts
```

Rule: route handlers + server actions stay thin; all Supabase access + branching lives under `src/server/squads/`.

### 2.2 Route layout (new)
Admin routes (already have the `/admin/...` group):
- `/admin/squads/page.tsx` — current-week list, status filter, link to detail
- `/admin/squads/[id]/page.tsx` — detail + approve/reject form (+ inline violation flags)
- `/admin/squads/rules/page.tsx` — season rule editor (admin only)
- `/admin/squads/rules/actions.ts`

Player routes (new group; `/player/*` does not exist yet — create the base):
- `/player/layout.tsx` — requires `player` role; wraps `SiteChrome`
- `/player/squad/page.tsx` — current-week submission screen (upload + transcribe)
- `/player/squad/actions.ts`
- `/player/squad/change/page.tsx` — Friday 21:00–22:00 WAT swap screen + countdown
- `/player/squad/change/actions.ts`

Public:
- Existing `/players/[id]/page.tsx` gains a "This week's squad" card when an approved submission exists for the current week.

Cron:
- `/api/cron/squad-deadline-check/route.ts` — hourly poll, auto-warnings.

### 2.3 Storage bucket
- Supabase Storage bucket `squad-screenshots`, private.
- Read access: short-lived signed URL (5 min) generated server-side for the submission owner + any user with `squads.validate`.
- Write access: server-issued signed upload URL. Path layout: `seasons/{season_id}/players/{player_id}/weeks/{week_start_date}/{uuid}.png` (also accepts jpg/webp up to 6 MB).

### 2.4 Reused primitives
- `apps/web/src/lib/time.ts` — add `APP_TIMEZONE` helpers `weekStartThursday(dateInWat)` and `fridayWindowBounds(weekStart)`.
- `apps/web/src/components/admin/*` — reuse `SectionHeader`, `DataTable`, `StatusPill`, `FormField`, `PrimaryButton`, `SecondaryButton`.
- `apps/web/src/lib/supabase/{server,service,browser}.ts` — reuse existing clients.
- Audit trigger `public.attach_audit('public.<table>')` is already defined (Plan 0). Every new mutable table calls it.

---

## 3. Data Model + SQL

All tables carry `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `deleted_at TIMESTAMPTZ NULL`. Every one ends with `select public.attach_audit('public.<table>');`.

### 3.1 `squad_validation_rules`
Migration `20260428000101_squad_validation_rules.sql`:
```sql
create table public.squad_validation_rules (
  id                   uuid primary key default gen_random_uuid(),
  season_id            uuid not null references public.seasons (id) on delete cascade,
  max_budget_coins     bigint not null check (max_budget_coins >= 0),
  min_nigerian_items   int not null check (min_nigerian_items >= 0),
  banned_item_types    text[] not null default '{}',
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (season_id)                 -- one live rule row per season (Phase 1B)
);
create index squad_validation_rules_season_idx
  on public.squad_validation_rules (season_id)
  where deleted_at is null;
select public.attach_audit('public.squad_validation_rules');
```
Seed row (Elite 2025-2026): values sourced from rulebook (budget cap, min 1 Nigerian item, banned type list). Seed inserted conditionally in `supabase/seed.sql` — never in prod.

### 3.2 `squad_submissions`
Migration `20260428000102_squad_submissions.sql`:
```sql
create table public.squad_submissions (
  id                     uuid primary key default gen_random_uuid(),
  season_id              uuid not null references public.seasons (id) on delete cascade,
  player_id              uuid not null references public.players (id) on delete cascade,
  week_start_date        date not null,                -- Thursday anchor in WAT
  futbin_screenshot_path text not null,                -- storage object key (not URL)
  submitted_at           timestamptz not null default now(),
  validation_status      text not null default 'pending'
                         check (validation_status in ('pending','approved','rejected')),
  validated_by           uuid references public.users (id),
  validated_at           timestamptz,
  rejection_reason       text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (player_id, week_start_date) -- one live submission per player per week
);
create index squad_submissions_season_week_idx
  on public.squad_submissions (season_id, week_start_date)
  where deleted_at is null;
create index squad_submissions_status_idx
  on public.squad_submissions (validation_status, week_start_date)
  where deleted_at is null;
select public.attach_audit('public.squad_submissions');
```

### 3.3 `squad_player_items`
Migration `20260428000103_squad_player_items.sql`:
```sql
create table public.squad_player_items (
  id                 uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references public.squad_submissions (id) on delete cascade,
  name               text not null,
  rating             int  not null check (rating between 1 and 99),
  position           text not null,
  value              bigint not null check (value >= 0),
  item_type          text not null check (item_type in
                       ('gold','silver','bronze','hero','icon','legend','special','other')),
  nationality_flag   text,
  slot_index         int  not null check (slot_index between 0 and 22),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (submission_id, slot_index)
);
create index squad_player_items_submission_idx
  on public.squad_player_items (submission_id)
  where deleted_at is null;
select public.attach_audit('public.squad_player_items');
```
`slot_index` = 0..10 starting XI, 11..22 bench/reserves.

### 3.4 `squad_change_requests`
Migration `20260428000104_squad_change_requests.sql`:
```sql
create table public.squad_change_requests (
  id                         uuid primary key default gen_random_uuid(),
  submission_id              uuid not null references public.squad_submissions (id) on delete cascade,
  player_out_name            text not null,
  player_out_item_id         uuid references public.squad_player_items (id),
  player_in_name             text not null,
  player_in_item_type        text not null check (player_in_item_type in
                               ('gold','silver','bronze','hero','icon','legend','special','other')),
  player_in_rating           int  not null check (player_in_rating between 1 and 99),
  player_in_value            bigint not null check (player_in_value >= 0),
  player_in_nationality_flag text,
  authorized_by_ref_user_id  uuid not null references public.users (id),
  authorized_at              timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  unique (submission_id)                    -- one swap per player per week
);
create index squad_change_requests_submission_idx
  on public.squad_change_requests (submission_id)
  where deleted_at is null;
select public.attach_audit('public.squad_change_requests');
```

### 3.5 Missed-deadline offense counter
No new table. Reuse `disciplinary_cases` + `disciplinary_actions` with `incident_type='squad_late_submission'`. Offense count = number of `incident_type='squad_late_submission'` cases open or resolved for that player in the current season, where `revoked_at IS NULL`. Placeholder ladder (1st warning, 2nd warning, 3rd -3 pts) — confirm against rulebook in Plan 11 coordination.

### 3.6 Storage bucket migration
Migration `20260428000105_storage_squad_bucket.sql`:
```sql
insert into storage.buckets (id, name, public)
values ('squad-screenshots', 'squad-screenshots', false)
on conflict (id) do nothing;
-- policies are server-side via service role; no RLS policies on the bucket in Phase 1B.
```

---

## 4. Server Modules

### 4.1 `schemas.ts` (Zod)
```
uploadScreenshotSchema { seasonId, playerId, weekStartDate (YYYY-MM-DD) }
createSubmissionSchema { seasonId, playerId, weekStartDate, futbinScreenshotPath, items[]≥1 ≤23 }
itemSchema            { name, rating, position, value, itemType, nationalityFlag?, slotIndex }
reviewSchema          { submissionId, action: 'approve'|'reject', rejectionReason? }
changeSchema          { submissionId, playerOutItemId, playerIn(name,itemType,rating,value,flag), authorizedByRefUserId }
ruleUpsertSchema      { seasonId, maxBudgetCoins, minNigerianItems, bannedItemTypes[] }
```
Cross-field rule: `rejectionReason` required when `action==='reject'`.

### 4.2 `week.ts`
- `weekStartThursday(dateInWat: Date): string` — returns `YYYY-MM-DD` of the Thursday on/before the date, computed in `Africa/Lagos`.
- `thursdayDeadline(weekStart: string): Date` — returns a Date representing `weekStart` 10:00 WAT as ISO UTC timestamp.
- `fridayWindowBounds(weekStart: string): { openAt: Date; closeAt: Date }` — Friday 21:00–22:00 WAT of that match week.
- `isWithinFridayWindow(now: Date, weekStart: string): boolean`.
- All helpers exclusively use `formatInTimeZone` from `date-fns-tz` (Africa/Lagos, UTC+1 no DST — mirror pattern in `attendance/mark.ts`).

### 4.3 `storage.ts`
- `createSignedUpload(sb, path)` — returns `{ url, token }` for browser POST.
- `createSignedRead(sb, path, ttlSeconds=300)` — used in ref + owner UI.
- Never returns the bucket directly to the client.

### 4.4 `submit.ts`
- `createSubmission(sb, actorUserId, input)`:
  1. Guard: `actorUserId` must own `players.user_id == input.playerId` OR caller has `squads.validate`.
  2. Compute `week_start_date` = `weekStartThursday(now)`; reject if `input.weekStartDate !== week_start_date`.
  3. Refuse if a non-deleted submission already exists for `(player_id, week_start_date)`. Throws `ConflictError`.
  4. Insert `squad_submissions` row; insert `squad_player_items` rows in a single RPC.
  5. Return `{ id }`.

### 4.5 `items.ts`
- `replaceItemsForSubmission(sb, submissionId, items[])` — only callable while `validation_status='pending'`. Soft-deletes old rows, inserts new.

### 4.6 `validate.ts`
Pure function `evaluateRules(items, rule) → { ok: boolean, violations: Violation[] }`:
- `BudgetExceededViolation` — `sum(items.value) > rule.max_budget_coins`
- `MissingNigerianItemsViolation` — `items.filter(i => i.nationality_flag==='NG').length < rule.min_nigerian_items`
- `BannedItemTypeViolation[]` — any item whose `item_type ∈ rule.banned_item_types`
- `ItemCountViolation` — < 11 starting-XI items (slot_index 0..10 filled)

Zero DB access; covered by unit tests only.

### 4.7 `review.ts`
- `approveSubmission(sb, actorUserId, submissionId)`:
  - Require `squads.validate`. Set `validation_status='approved'`, `validated_by=actorUserId`, `validated_at=now()`.
- `rejectSubmission(sb, actorUserId, submissionId, reason)`:
  - Require `squads.validate` + non-empty reason.

### 4.8 `change.ts`
- `requestChange(sb, actorUserId, input)`:
  1. Load submission + current week + rule; confirm `validation_status='approved'`.
  2. Confirm `now` ∈ `fridayWindowBounds(weekStart)` — else `ConflictError('window_closed')`.
  3. Confirm no existing live `squad_change_requests` row for that submission.
  4. Require `input.authorizedByRefUserId` resolves to a user with `squads.change_authorize` perm.
  5. Insert row; if `playerOutItemId` given, soft-update the corresponding `squad_player_items` row.

### 4.9 `rules.ts`
- `getRuleForSeason(sb, seasonId)`, `upsertRule(sb, actorUserId, input)` — admin-only.

### 4.10 `deadline.ts`
- `whoMissedDeadline(sb, seasonId, weekStart): PlayerId[]` — joins `season_participants` left against `squad_submissions`.
- `issueAutoWarningForMissed(sb, playerId, seasonId, weekStart)`:
  - Counts existing `disciplinary_cases` with `incident_type='squad_late_submission'` to decide 1st/2nd/3rd-offense sanction.
  - Opens a `disciplinary_case` + `disciplinary_action`; stores `notes` marker `squad_late:{weekStart}` to guarantee idempotency.

### 4.11 `list.ts`
- `listSubmissionsForWeek(sb, seasonId, weekStart, { status? })`.
- `getSubmissionWithItems(sb, submissionId)`.
- `getApprovedSubmissionForPlayer(sb, playerId, weekStart)` — used by public player page.

### 4.12 `index.ts`
Re-exports everything public; error classes (`ConflictError`, `ValidationError`, `PermissionError`) follow `server/attendance/index.ts` pattern.

---

## 5. UI

### 5.1 Admin subnav entry
Edit `apps/web/src/components/admin/AdminSubnav.tsx` — add a "Squads" tab between "Punishments" and "Announcements", href `/admin/squads`.

### 5.2 `/admin/squads` (list)
- Mirror `/admin/match-days/page.tsx`: `SectionHeader` ("Squads", eyebrow "This week"), filter dropdown (`all | pending | approved | rejected`), `DataTable` with columns: Player, Submitted at (WAT, `formatWat`), Violations (icon with count), Status (`StatusPill`), Actions.
- `data-testid`: `squads-list`, `squad-row-{id}`, `squad-filter`.
- Server component; calls `listSubmissionsForWeek`.

### 5.3 `/admin/squads/[id]` (detail)
- Left column: signed-read screenshot URL (`<img>` with 5-min expiring src).
- Right column: item grid (readonly) + `evaluateRules` result. Violations render as red chip with explanatory text.
- Two server actions: `approveAction(submissionId)` + `rejectAction(submissionId, reason)`; reason input required.
- Audit log sidebar: recent `audit_events` rows for this submission.

### 5.4 `/admin/squads/rules`
- Admin-only. Displays current rule row for Elite 2025-2026 in a form. Fields: `maxBudgetCoins`, `minNigerianItems`, `bannedItemTypes`.
- Server action calls `upsertRule`.

### 5.5 `/player/squad` (submit)
- Header: "Week of {weekStart}. Deadline: Thursday 10:00 WAT (in X hours)".
- If already submitted → read-only summary + status pill. Otherwise render form:
  1. File input → hits `submitScreenshotAction` which calls `createSignedUpload`, browser POSTs, server records path.
  2. Grid of 11 (+ up to 12) item rows with client-side Zod mirror validation for UX; server re-validates.
  3. Live "Validation preview" panel runs `evaluateRules` client-side (non-binding — server is source of truth).
  4. "Submit" action posts to `createSubmissionAction`. Success redirects to read-only view.
- `/player/layout.tsx` requires role `player`; unauthenticated → redirect to `/login`.

### 5.6 `/player/squad/change`
- Server-rendered countdown to Friday 21:00 WAT; JS clock updates every second for display only. All gating happens server-side.
- Before 21:00 WAT: display "Opens in HH:MM:SS"; form disabled.
- During 21:00–22:00 WAT: form enabled with:
  - Dropdown "Out" (populated from player's approved current-week items).
  - Fields for "In" (name, rating, value, item_type, nationality_flag).
  - Required dropdown "Authorizing referee" (populated server-side from users with `squads.change_authorize` perm).
  - Submit → `requestChangeAction`.
- After 22:00 WAT or first swap used: banner "Change window closed" or "You've used your swap this week".
- `data-testid`: `change-countdown`, `change-out-select`, `change-ref-select`, `change-submit`.

### 5.7 Public display on `/players/[id]`
- Fetch `getApprovedSubmissionForPlayer(sb, playerId, currentWeekStart)`. If present, render "This week's squad" card listing items (name, rating, position). No screenshot exposed publicly (private bucket). No value totals exposed publicly.
- If NULL → omit the card entirely. Do NOT leak pending/rejected statuses publicly.

### 5.8 Shared components (new, under `apps/web/src/components/squads/`)
- `ItemRow.tsx` — form row for one item.
- `ViolationChip.tsx` — compact red chip with violation code + label.
- `CountdownBadge.tsx` — client component for the Friday window.

---

## 6. Cron

### 6.1 `/api/cron/squad-deadline-check/route.ts`
Mirror `publish-announcements/route.ts`:
- Guard `X-Cron-Secret` header against `process.env.CRON_SECRET`; 403 otherwise.
- `getServiceRoleSupabase()`.
- Resolve active season.
- `weekStart = weekStartThursday(now)`; `deadline = thursdayDeadline(weekStart)`.
- If `now < deadline` → return `{ skipped: "deadline not passed" }`.
- Else for each missed player, `issueAutoWarningForMissed(...)` inside try/catch.
- Idempotency: `issueAutoWarningForMissed` looks up `notes LIKE 'squad_late:{weekStart}%'` and returns early if case exists.

Scheduling: Vercel Cron / GitHub Actions hourly.

---

## 7. Permissions Wiring

Edit `apps/web/src/perms.ts`:
- `admin` already covers via wildcard.
- Add to `referee`/`loc` (Plan 9 naming): `'squads.validate'`, `'squads.change_authorize'`.
- Add to `player`: `'squads.submit.own'` (server enforces target `players.user_id === actor.userId`).
- New strings: `squads.submit`, `squads.validate`, `squads.change_authorize`, `squads.rules_edit`.

Middleware (`apps/web/src/middleware.ts`): add entry to protect `/player/**` — require authenticated user with `player` role.

---

## 8. Tests

Aim ≥ 20 new unit tests, 3 new E2E specs.

### 8.1 Unit (Vitest, next to source)
- `week.test.ts` (≥4): Thursday anchor, DST-irrelevance, window bounds at 20:59/21:00/21:59/22:00, cross-midnight.
- `validate.test.ts` (≥5): budget ok/exceeded, zero Nigerian when 1 required, banned-type match, empty items, multi-violation.
- `submit.test.ts` (≥3): happy path, duplicate rejects, wrong week rejects.
- `review.test.ts` (≥3): approve flips status, reject requires reason, no-perm caller rejected.
- `change.test.ts` (≥4): within window ok, before blocked, after blocked, second swap blocked, non-ref authorizer rejected.
- `deadline.test.ts` (≥3): whoMissed correct set, issueAutoWarning idempotent, ladder progression 1st→3rd.
- `rules.test.ts` (≥2): upsert creates then updates, reject non-admin caller.
- `items.test.ts` (≥1): replace soft-deletes prior items.
- `storage.test.ts` (≥1): signed URL path format.

All use Supabase mock (mirror `server/attendance/mark.test.ts`).

### 8.2 E2E (Playwright, `apps/web/tests/e2e/`)
- `squad-submission-flow.spec.ts` — player uploads + submits; ref approves; public page shows squad; audit row present.
- `squad-change-window.spec.ts` — attempt swap 20:59 (rejected), 21:10 (accepted), 21:11 (second swap rejected).
- `squad-deadline-cron.spec.ts` — seeds missed submission, POSTs to `/api/cron/squad-deadline-check` with secret, asserts `disciplinary_case` exists; second POST does not duplicate.

Each E2E self-cleaning.

### 8.3 Audit smoke
Append queries to `supabase/tests/audit_smoke.sql` that insert+update+soft-delete one row per new table.

---

## 9. Numbered Tasks

1. Create SQL migrations `20260428000101..000105` per §3.1-3.6; verify via `npx supabase db push` + `db query`.
2. Seed Elite 2025-2026 `squad_validation_rules` row in `supabase/seed.sql` (dev guard by `NODE_ENV`).
3. Extend `apps/web/src/lib/time.ts` with `weekStartThursday`, `thursdayDeadline`, `fridayWindowBounds`, `isWithinFridayWindow`; add unit tests.
4. Create `apps/web/src/server/squads/schemas.ts`.
5. Create `apps/web/src/server/squads/storage.ts` + test.
6. Create `apps/web/src/server/squads/validate.ts` + test (pure function, no DB).
7. Create `apps/web/src/server/squads/submit.ts` + test.
8. Create `apps/web/src/server/squads/items.ts` + test.
9. Create `apps/web/src/server/squads/review.ts` + test.
10. Create `apps/web/src/server/squads/change.ts` + test including window math boundaries.
11. Create `apps/web/src/server/squads/rules.ts` + test.
12. Create `apps/web/src/server/squads/deadline.ts` + test (idempotency).
13. Create `apps/web/src/server/squads/list.ts` + test.
14. Create `apps/web/src/server/squads/index.ts` re-exports.
15. Update `apps/web/src/perms.ts` with new `squads.*` permissions; update `apps/web/src/middleware.ts` to gate `/player/**`.
16. Update `apps/web/src/components/admin/AdminSubnav.tsx` to add "Squads" tab.
17. Build `/admin/squads/page.tsx` + `[id]/page.tsx` + server actions.
18. Build `/admin/squads/rules/page.tsx` + `actions.ts`.
19. Build `/player/layout.tsx` + `/player/squad/page.tsx` + `actions.ts`.
20. Build `/player/squad/change/page.tsx` + `actions.ts`.
21. Extend `/players/[id]/page.tsx` to render current-week approved squad card.
22. Build `/api/cron/squad-deadline-check/route.ts`; wire to Vercel Cron / GitHub Actions.
23. Write 3 Playwright specs per §8.2 + append audit smoke queries per §8.3.
24. Verify: `npm run test`, `npm run lint`, `npm run build`, `npm --workspace apps/web run e2e`, `npm run audit:smoke`. Demonstrate all §1.2 success criteria.

---

## 10. Acceptance Criteria

- [ ] All migrations apply cleanly against fresh DB; audit trigger attached to all four new tables.
- [ ] Unit tests ≥ 20 new; all pass.
- [ ] E2E ≥ 3 new specs; all pass against a live Supabase stack.
- [ ] `/player/squad` upload → submit → screenshot stored in `squad-screenshots` (private).
- [ ] `/admin/squads` list + detail + approve/reject works; audit log shows `insert` on submission + `update` on approve.
- [ ] `/api/cron/squad-deadline-check` protected by `X-Cron-Secret`; missed-submission auto-warning idempotent across hourly calls.
- [ ] `/player/squad/change` enforces Friday 21:00–22:00 Africa/Lagos strictly server-side.
- [ ] Second change attempt in same week rejected by unique index + server check.
- [ ] Referee dropdown sources from users with `squads.change_authorize` perm.
- [ ] `/players/[id]` renders approved current-week squad; no screenshot leak; hidden when absent.
- [ ] `npm run lint`, `npm run build` clean.

---

## 11. Risks

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Hand-transcription of items error-prone | High | High | Ref reviews against screenshot; validation flags violations before approval; Futbin scraper replaces this in Phase 3. |
| Signed-URL expiry clashes with ref review flow | Med | Med | TTL 5 min, auto-refresh button in detail page that re-signs on demand. |
| Friday window clock drift between Vercel edge and WAT | High | Low | All gating uses `formatInTimeZone(new Date(), 'Africa/Lagos', ...)` server-side; do not trust client time; unit test boundaries. |
| Cron misses deadline | Med | Low | Hourly poll with idempotency means late run still catches up; manual `curl` fallback. |
| Referee dropdown spoofed | High | Med | Server re-verifies `authorizedByRefUserId` has `squads.change_authorize` at write time. |
| Banned-type schema too rigid | Med | Med | `item_type` check uses enum-strings; migration to add new value trivial. |
| Storage bucket made public accidentally | High | Low | Migration explicitly sets `public=false`; code review checklist item. |
| Missed-submission ladder wrong vs rulebook | Med | Med | Placeholder flat ladder; tracked as open item until rulebook parse confirms. |

---

## 12. Out of Scope

- Automated Futbin scraping (Phase 3).
- Screenshot OCR / auto-item extraction.
- Squad versioning beyond the single swap.
- Coach-submits-on-behalf-of-player flow.
- Multi-season rule inheritance (Phase 2 — multi-season abstraction).
- Push/email notifications on validation flip.

---

## 13. Open Items Before Coding

1. **Rulebook parse.** Confirm exact `max_budget_coins`, `min_nigerian_items`, `banned_item_types` from `KNOWLEDGE/CADE_Elite_League_Rulebook_v1_7.docx`.
2. **Referee role naming.** Plan 9 decides whether moderator or new `referee` role holds `squads.validate` / `squads.change_authorize`.
3. **Storage URL signing path.** Confirm Supabase Storage helper name against installed client version.
4. **Item slot model.** 11 + 12 = 23 slots; confirm format expects bench.
5. **Screenshot size limit.** Placeholder 6 MB; confirm typical Futbin export size.

---

## 14. Sequencing Notes

Plan 10 depends on Plan 9 (role expansion) for referee/loc role semantics. If Plan 9 lands first, wire `squads.validate` + `squads.change_authorize` to new roles directly. If Plan 10 lands first, keep on `moderator` and rename in follow-up migration.

---

## 15. Critical Files for Implementation

- `apps/web/src/server/squads/submit.ts`
- `apps/web/src/server/squads/change.ts`
- `apps/web/src/server/squads/validate.ts`
- `apps/web/src/app/api/cron/squad-deadline-check/route.ts`
- `supabase/migrations/20260428000102_squad_submissions.sql`
