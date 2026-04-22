# Plan 13 — Phase 2 Prep: Organizations + Contracts + Disputes + ~~Content Obligations~~ + ~~Pre-season Shoots~~

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Supersedes:** Phase 2 bullets in `ESOCCER LEAGUE/PRODUCT_STRUCTURE.md` §3 for org/content/disputes/shoots entities only
**Status:** Prep (entities + workflow scaffolding). No Paystack. No payment automation. Money flows = manual ledger only.

## Plan 33 dropped (2026-04-22): content obligations + preseason shoots

User direction: "We don't need to collect content links on the platform" + "We don't need the preseason shoot feature." Both subsystems were removed from the codebase in change-wave Plan 33 (2026-04-22):

- **Content obligations (subsystem C in this spec):** server module `apps/web/src/server/content/`, admin routes `app/admin/content/**`, player route `app/player/content/`, perms `content.submit | content.verify | content.read.own`, E2E `content-obligation-week.spec.ts`, subnav entries — all deleted. Tables `content_posts`, `content_sessions`, view `content_obligation_status` SOFT-archived (`deleted_at = now()`); rows preserved, schema kept. See migration `20260507000020_drop_content_preseason_features.sql` for the rollback / future-hard-drop template.
- **Pre-season shoots (subsystem D in this spec):** server module `apps/web/src/server/preseason/`, admin routes `app/admin/preseason/**`, perm `preseason.manage`, subnav entry — all deleted. Tables `preseason_shoots`, `preseason_shoot_attendance` SOFT-archived. The `incident_type='preseason_miss'` enum value on `disciplinary_cases` / `disciplinary_precedents` is INTENTIONALLY KEPT so historical warning rows stay valid; new code no longer issues this incident type.

Acceptance scenarios C and D in §1 below are **superseded — do NOT implement.** Sections describing content_posts / content_sessions / preseason_shoots / preseason_shoot_attendance schemas, server modules, and UI surfaces are retained for historical context only — they describe the soft-archived state of the cloud DB, not active feature surface.

Plans 31/32 and the orgs/disputes/appeals subsystems (A + B) are unaffected.

---

## 1. Goal + Success Criteria

Ship the **data layer + workflow scaffolding** for four Phase 2 domains so later plans (broadcast, manual-finance reporting, deeper discipline) can build on stable tables, RLS, permission grants, and minimum-viable UIs. No gateway integration, no automation — manual admin entry where money is involved.

**Four acceptance scenarios (one per subsystem):**

| # | Scenario |
|---|----------|
| A | Admin creates Organization `"Lagos Crown Esports"` with CAC number + uploaded cert, links 2 players, deposits 50,000-coin caution fee via manual ledger entry. Org detail page shows balance 50,000 and two ledger rows (deposit + initial seed). A subsequent `fine_deduction` of 5,000 leaves `balance_after_coins = 45,000`, append-only — no row editable/deletable via UI. |
| B | Player submits an appeal against a point-deduction issued 2026-05-01 (Friday). Server stores `deadline_at = 2026-05-08 23:59 Africa/Lagos` (5 business days, weekend excluded). IDC admin assigns a 3-member panel, enters ruling → case status moves to `appealed → resolved`, standings recompute idempotently if ruling revokes the action. |
| C | Player submits 2 Instagram posts + 1 Twitter post for week `2026-05-04`. `content_obligation_status` view for that player-week returns `met=true` (≥1 post × ≥2 platforms). Moderator rejects one IG post → view re-evaluates to `met=false`. |
| D | Admin schedules pre-season shoot on `2026-04-28`, marks 11 of 13 players attended. Server auto-creates `disciplinary_case` + `warning` action for each of 2 absent players per Rule 2.5, sets `warning_issued_bool = true` on their attendance row. |

All four scenarios audit-logged end-to-end via existing `audit_row_change()` trigger.

**Non-goals:** payment gateway integration (DROPPED), automatic IG/TikTok scraping (Phase 3), appeal ruling → discipline action auto-application beyond revocation, CAC doc OCR.

---

## 2. Architectural Constraints Recap

- **Monolith.** New modules at `apps/web/src/server/{orgs,disputes,appeals,content,preseason}/`.
- **Audit triggers** attached via `public.attach_audit('public.<table>')` on every new mutable table (including append-only ledger — inserts still audited; trigger blocks update/delete on `caution_ledger_entries` via dedicated policy).
- **Soft delete** (`deleted_at TIMESTAMPTZ`) on every table except `caution_ledger_entries` (append-only).
- **RLS** on: `organization_contracts`, `caution_ledger_entries`, `disputes`, `appeals`, `content_posts`. Business perms still enforced at API via `hasPerm()`.
- **Permissions** — new entries in `src/perms.ts`. See §7.
- **Timezone** — `Africa/Lagos` (WAT) hard-coded. Business-day math (§5) uses shared `addBusinessDays()` helper.
- **NO Paystack.** NO payment gateway. Balances are `integer` coin columns manually adjusted by admins. Ledger is single source of truth — balance stored denormalised for fast read but reconcilable by summing typed amounts.

---

## 3. Data Model — SQL

All timestamps `TIMESTAMPTZ`. All tables include `created_at`, `updated_at`, `deleted_at` unless stated. Suggested dates `20260428*` — `20260502*`.

### 3.1 Organizations (A)

```sql
-- 20260428000201_organizations.sql
create table public.organizations (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  cac_number                 text unique,
  cac_cert_url               text,
  contact_rep_user_id        uuid references public.users (id) on delete set null,
  status                     text not null default 'active'
                               check (status in ('active','suspended','dissolved')),
  caution_fee_balance_coins  bigint not null default 0
                               check (caution_fee_balance_coins >= 0),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz
);
create unique index organizations_cac_idx on public.organizations (cac_number)
  where deleted_at is null and cac_number is not null;
create index organizations_rep_idx on public.organizations (contact_rep_user_id)
  where deleted_at is null;
select public.attach_audit('public.organizations');
```

```sql
-- 20260428000202_organization_contracts.sql
create table public.organization_contracts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  player_id        uuid not null references public.players (id) on delete restrict,
  season_id        uuid not null references public.seasons (id) on delete restrict,
  contract_url     text not null,
  signed_at        timestamptz,
  valid_from       date not null,
  valid_until      date not null,
  status           text not null default 'draft'
                     check (status in ('draft','active','terminated','expired')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint org_contracts_valid_range_ck check (valid_until >= valid_from)
);
create index org_contracts_player_idx on public.organization_contracts (player_id, valid_from)
  where deleted_at is null;
create index org_contracts_org_idx on public.organization_contracts (organization_id)
  where deleted_at is null;
create unique index org_contracts_unique_active_per_season
  on public.organization_contracts (player_id, season_id)
  where deleted_at is null and status = 'active';
select public.attach_audit('public.organization_contracts');
alter table public.organization_contracts enable row level security;
create policy org_contracts_no_direct on public.organization_contracts for all
  using (false) with check (false);
```

```sql
-- 20260428000203_caution_ledger_entries.sql
create table public.caution_ledger_entries (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  entry_type             text not null check (entry_type in (
                           'deposit','fine_deduction','topup','adjustment')),
  amount_coins           bigint not null check (amount_coins > 0),
  direction              text not null check (direction in ('credit','debit')),
  balance_after_coins    bigint not null check (balance_after_coins >= 0),
  reference              text,
  entered_by_user_id     uuid not null references public.users (id) on delete restrict,
  entered_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
  -- No updated_at, no deleted_at: APPEND-ONLY.
);
create index caution_ledger_org_idx
  on public.caution_ledger_entries (organization_id, entered_at desc);
select public.attach_audit('public.caution_ledger_entries');
create or replace function public.block_mutation_caution_ledger()
returns trigger language plpgsql as $$
begin raise exception 'caution_ledger_entries is append-only'; end; $$;
create trigger caution_ledger_no_update before update on public.caution_ledger_entries
  for each row execute function public.block_mutation_caution_ledger();
create trigger caution_ledger_no_delete before delete on public.caution_ledger_entries
  for each row execute function public.block_mutation_caution_ledger();
alter table public.caution_ledger_entries enable row level security;
create policy caution_ledger_no_direct on public.caution_ledger_entries for all
  using (false) with check (false);
```

```sql
-- 20260428000204_players_org_columns.sql
alter table public.players
  add column organization_id uuid references public.organizations (id) on delete set null,
  add column team_manager_id uuid references public.users (id) on delete set null,
  add column coach_id        uuid references public.users (id) on delete set null;
create index players_org_idx on public.players (organization_id)
  where deleted_at is null and organization_id is not null;
```

Extension of `apps/web/src/server/players/types.ts` adds three optional UUID fields to `PlayerView`.

```sql
-- 20260428000205_organizations_rls.sql
alter table public.organizations enable row level security;
create policy organizations_public_read on public.organizations for select
  using (deleted_at is null);
create policy organizations_no_direct_write on public.organizations for all
  using (false) with check (false);
```

### 3.2 Disputes & Appeals (B)

```sql
-- 20260429000201_disputes.sql
create table public.disputes (
  id                  uuid primary key default gen_random_uuid(),
  raised_by_user_id   uuid not null references public.users (id) on delete restrict,
  subject_type        text not null check (subject_type in
                        ('match','sanction','registration','other')),
  subject_id          uuid,
  description         text not null,
  evidence_urls       text[] not null default '{}',
  status              text not null default 'submitted'
                        check (status in ('submitted','under_review','resolved','withdrawn')),
  assigned_to_user_id uuid references public.users (id) on delete set null,
  ruling              text,
  opened_at           timestamptz not null default now(),
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint disputes_ruling_ck
    check (status <> 'resolved' or (ruling is not null and resolved_at is not null))
);
create index disputes_raiser_idx on public.disputes (raised_by_user_id)
  where deleted_at is null;
create index disputes_status_idx on public.disputes (status) where deleted_at is null;
create index disputes_assigned_idx on public.disputes (assigned_to_user_id)
  where deleted_at is null and assigned_to_user_id is not null;
select public.attach_audit('public.disputes');
alter table public.disputes enable row level security;
create policy disputes_self_read on public.disputes for select
  using (
    deleted_at is null and exists (
      select 1 from public.users u
      where u.id = disputes.raised_by_user_id
        and u.supabase_auth_id = auth.uid()
    )
  );
create policy disputes_no_direct_write on public.disputes for all
  using (false) with check (false);
```

```sql
-- 20260429000202_appeals.sql
create table public.appeals (
  id                     uuid primary key default gen_random_uuid(),
  disciplinary_case_id   uuid not null references public.disciplinary_cases (id) on delete restrict,
  submitted_by_user_id   uuid not null references public.users (id) on delete restrict,
  submitted_at           timestamptz not null default now(),
  grounds                text not null,
  evidence_urls          text[] not null default '{}',
  panel_member_user_ids  uuid[] not null default '{}'
                           check (array_length(panel_member_user_ids, 1) is null
                                  or array_length(panel_member_user_ids, 1) <= 5),
  ruling                 text,
  ruled_at               timestamptz,
  deadline_at            timestamptz not null,
  status                 text not null default 'submitted'
                           check (status in ('submitted','under_review','ruled','withdrawn','expired')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  constraint appeals_ruling_ck
    check (status <> 'ruled' or (ruling is not null and ruled_at is not null))
);
create unique index appeals_one_open_per_case
  on public.appeals (disciplinary_case_id)
  where deleted_at is null and status in ('submitted','under_review');
create index appeals_deadline_idx on public.appeals (deadline_at)
  where deleted_at is null and status in ('submitted','under_review');
select public.attach_audit('public.appeals');
alter table public.appeals enable row level security;
create policy appeals_no_direct on public.appeals for all using (false) with check (false);
```

### 3.3 Content Obligations (C)

```sql
-- 20260430000201_content_posts.sql
create table public.content_posts (
  id                   uuid primary key default gen_random_uuid(),
  player_id            uuid not null references public.players (id) on delete restrict,
  week_start           date not null,
  platform             text not null check (platform in
                         ('twitter','instagram','tiktok','youtube')),
  post_url             text not null,
  submitted_at         timestamptz not null default now(),
  verified_by_user_id  uuid references public.users (id) on delete set null,
  verification_status  text not null default 'pending'
                         check (verification_status in ('pending','verified','rejected')),
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint content_posts_rejection_ck
    check (verification_status <> 'rejected' or rejection_reason is not null),
  constraint content_posts_week_start_monday_ck
    check (extract(isodow from week_start) = 1)
);
create index content_posts_player_week_idx
  on public.content_posts (player_id, week_start)
  where deleted_at is null;
create index content_posts_pending_idx
  on public.content_posts (submitted_at desc)
  where deleted_at is null and verification_status = 'pending';
select public.attach_audit('public.content_posts');
alter table public.content_posts enable row level security;
create policy content_posts_self_read on public.content_posts for select
  using (
    deleted_at is null and exists (
      select 1 from public.players p
      join public.users u on u.id = p.user_id
      where p.id = content_posts.player_id
        and u.supabase_auth_id = auth.uid()
    )
  );
create policy content_posts_no_direct_write on public.content_posts for all
  using (false) with check (false);
```

```sql
-- 20260430000202_content_obligation_status_view.sql
create or replace view public.content_obligation_status as
select
  player_id,
  week_start,
  count(*)                                           as post_count,
  count(distinct platform) filter (where verification_status = 'verified')
                                                     as verified_platforms,
  (count(distinct platform) filter (where verification_status = 'verified')) >= 2
                                                     as met
from public.content_posts
where deleted_at is null
group by player_id, week_start;
```

```sql
-- 20260430000203_content_sessions.sql
create table public.content_sessions (
  id                          uuid primary key default gen_random_uuid(),
  match_day_id                uuid not null references public.match_days (id) on delete restrict,
  player_id                   uuid not null references public.players (id) on delete restrict,
  scheduled_time              timestamptz not null,
  attended_bool               boolean not null default false,
  makeup_session_scheduled_at timestamptz,
  makeup_attended_bool        boolean not null default false,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);
create unique index content_sessions_match_player_unique
  on public.content_sessions (match_day_id, player_id)
  where deleted_at is null;
select public.attach_audit('public.content_sessions');
```

### 3.4 Pre-season shoots (D)

```sql
-- 20260502000201_preseason_shoots.sql
create table public.preseason_shoots (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.seasons (id) on delete restrict,
  shoot_date  date not null,
  type        text not null check (type in ('photo','video','interview')),
  location    text,
  status      text not null default 'scheduled'
                check (status in ('scheduled','completed','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index preseason_shoots_season_date_idx
  on public.preseason_shoots (season_id, shoot_date)
  where deleted_at is null;
select public.attach_audit('public.preseason_shoots');
```

```sql
-- 20260502000202_preseason_shoot_attendance.sql
create table public.preseason_shoot_attendance (
  id                    uuid primary key default gen_random_uuid(),
  shoot_id              uuid not null references public.preseason_shoots (id) on delete restrict,
  player_id             uuid not null references public.players (id) on delete restrict,
  attended_bool         boolean not null default false,
  warning_issued_bool   boolean not null default false,
  warning_action_id     uuid references public.disciplinary_actions (id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create unique index preseason_attendance_unique
  on public.preseason_shoot_attendance (shoot_id, player_id)
  where deleted_at is null;
select public.attach_audit('public.preseason_shoot_attendance');
```

---

## 4. Server Modules

Thin route handlers; all business logic in server/ modules.

```
apps/web/src/server/
├── orgs/
│   ├── index.ts          createOrg, updateOrg, softDelete, list, getById, linkPlayer, unlinkPlayer
│   ├── contracts.ts      createContract, activateContract, terminateContract, listForPlayer
│   ├── ledger.ts         recordEntry({orgId, entryType, amountCoins, reference, enteredBy})
│   │                     — computes new balance, inserts ledger row, updates balance in single tx
│   ├── ledger.test.ts    unit: deposit, fine_deduction, adjustment, overdraft rejected, concurrent safe
│   ├── index.test.ts, contracts.test.ts
│   └── schemas.ts        zod inputs
├── disputes/
│   ├── index.ts          submit, assign, updateStatus, rule, withdraw, list, getById
│   ├── index.test.ts
│   └── schemas.ts
├── appeals/
│   ├── index.ts          submit (computes deadline_at), assignPanel, rule, withdraw
│   ├── deadline.ts       addBusinessDays(baseUtc, n, tz='Africa/Lagos') — skips Sat/Sun
│   ├── deadline.test.ts  Friday+5 = next Friday; Wed+5 = next Wed
│   ├── expire.ts         cron-callable markExpired() for overdue appeals
│   ├── index.test.ts, expire.test.ts
│   └── schemas.ts
├── content/
│   ├── posts.ts          submit (player), verify, reject (moderator)
│   ├── status.ts         getStatusForPlayerWeek(playerId, weekStart) reads view
│   ├── sessions.ts       scheduleSession, markAttendance, scheduleMakeup, markMakeupAttendance
│   ├── week.ts           currentWeekStart(tz='Africa/Lagos') — Monday-anchored
│   ├── week.test.ts
│   ├── posts.test.ts, status.test.ts, sessions.test.ts
│   └── schemas.ts
└── preseason/
    ├── shoots.ts         create, update, cancel, complete, list
    ├── attendance.ts     markAttendance — if attended_bool=false, calls punishments.issue()
    │                     with sanction_type='warning', incident_type='preseason_miss'
    │                     Sets warning_issued_bool=true. Idempotent per row.
    ├── shoots.test.ts, attendance.test.ts
    └── schemas.ts
```

**Shared helpers** in `apps/web/src/lib/`:
- `businessDays.ts` — `addBusinessDays(dateUtc, count, tz)`, `isBusinessDay(date, tz)`.
- `time.ts` — already exports `APP_TIMEZONE`.

**Incident-type extension.** Add `'preseason_miss'` to `disciplinary_cases.incident_type` CHECK (migration `20260502000203_incident_type_preseason_miss.sql`).

---

## 5. Business-day math (appeals deadline)

`addBusinessDays(base: Date, count: 5, tz: 'Africa/Lagos') → Date`:

- Interpret `base` as instant; find local WAT date portion via `date-fns-tz`.
- Advance calendar day-by-day, skipping Saturday (ISO dow=6) and Sunday (ISO dow=7).
- Result is end-of-day (23:59:59 WAT) on target date, returned as UTC `Date`.
- Holidays intentionally not modelled in Plan 13 — add to future `league_holidays` table when IDC supplies list.

Unit tests:

| Base (WAT) | +5 biz days | Notes |
|---|---|---|
| Fri 2026-05-01 | Fri 2026-05-08 | weekend skip |
| Mon 2026-05-04 | Mon 2026-05-11 | weekend skip |
| Wed 2026-05-06 | Wed 2026-05-13 | weekend skip |
| Sat 2026-05-02 | Fri 2026-05-08 | start counts from next biz day |
| 23:50 Fri 2026-05-01 | 23:59 Fri 2026-05-08 | end-of-day anchor |

---

## 6. UI Routes

### 6.1 Admin route group `(admin)`

| Route | Purpose |
|---|---|
| `/admin/orgs` | list (name, CAC#, status, balance) |
| `/admin/orgs/new` | create form |
| `/admin/orgs/[id]` | detail: info, linked players, contracts tab, ledger tab |
| `/admin/orgs/[id]/ledger/new` | deposit/topup/fine_deduction/adjustment form |
| `/admin/orgs/[id]/contracts/new` | upload + link contract to player + season |
| `/admin/disputes` | list all (status filter) |
| `/admin/disputes/[id]` | detail + assign + rule |
| `/admin/appeals` | list (status, deadline) — red badge within 24h |
| `/admin/appeals/[id]` | detail, panel editor, rule form |
| `/admin/content` | queue of `pending` posts, verify/reject |
| `/admin/content/sessions/[matchDayId]` | match-day session attendance |
| `/admin/preseason` | shoot list, schedule form |
| `/admin/preseason/[id]` | attendance grid |

### 6.2 Player route group (new — `(player)`)

Phase 1A has no dedicated player group. Introduce `apps/web/src/app/(player)/` with middleware requiring authenticated `player` role.

| Route | Purpose |
|---|---|
| `/player/disputes/new` | submit dispute form |
| `/player/disputes` | list own disputes with status |
| `/player/appeals/new?caseId=...` | submit appeal against disciplinary_case |
| `/player/appeals` | list own appeals with deadline countdown |
| `/player/content` | submit post URL + week picker; see own obligation status |

### 6.3 Storage buckets

- `org-cac-certs/` — private; signed URLs only.
- `org-contracts/` — private; signed URLs only.
- `dispute-evidence/` and `appeal-evidence/` — private; signed URLs only. 50 MB limit per file.

RLS mirrors Phase 1A PII bucket conventions (service-role writes, signed-URL reads).

---

## 7. Permissions additions (`apps/web/src/perms.ts`)

```ts
admin: ["*"],
moderator: [
  ...existing,
  "orgs.read",
  "disputes.read",
  "disputes.rule",
  "appeals.read",
  "appeals.rule",
  "content.verify",
  "preseason.manage",
],
player: [
  ...existing,
  "disputes.submit",
  "disputes.read.own",
  "appeals.submit",
  "appeals.read.own",
  "content.submit",
  "content.read.own",
],
```

Exhaustive action list: `orgs.read`, `orgs.edit`, `orgs.ledger.read`, `orgs.ledger.write` (admin only), `disputes.*`, `appeals.*`, `content.submit`, `content.verify`, `content.read.own`, `preseason.manage`.

---

## 8. Tests

### 8.1 Unit (Vitest — ≥25 new)

| Module | Test |
|---|---|
| orgs/ledger | deposit increments balance |
| orgs/ledger | fine_deduction decrements balance |
| orgs/ledger | adjustment credit/debit both work |
| orgs/ledger | overdraft (balance < 0) rejected |
| orgs/ledger | concurrent writes serialise (`FOR UPDATE`) |
| orgs/ledger | append-only (no update/delete path) |
| orgs/index | createOrg happy path |
| orgs/index | linkPlayer sets players.organization_id |
| orgs/contracts | activateContract enforces uniqueness per (player, season) |
| disputes/index | submit records raised_by + opened_at |
| disputes/index | assign changes status to under_review |
| disputes/index | rule sets resolved_at + ruling + status |
| disputes/index | withdraw allowed only by raiser |
| appeals/deadline | 5 vectors in §5 |
| appeals/deadline | negative/non-integer count rejected |
| appeals/index | submit computes deadline_at |
| appeals/index | unique open appeal per case |
| appeals/index | rule blocks after deadline or flags as late |
| appeals/expire | markExpired flips overdue to `expired` |
| content/week | currentWeekStart Monday-anchored in WAT |
| content/posts | submit idempotent on same (player, week, platform, url) |
| content/status | view reports met when 2 platforms verified |
| content/status | view flips to unmet after rejection |
| content/sessions | makeup fields only valid when primary attendance=false |
| preseason/attendance | absent → auto-warning issued once (idempotent) |
| perms | player cannot call orgs.edit |
| perms | moderator cannot call orgs.ledger.write |

### 8.2 E2E (Playwright — 3 new)

1. `orgs-manual-ledger.spec.ts` — scenario A.
2. `appeal-submit-and-rule.spec.ts` — scenario B including deadline display.
3. `content-obligation-week.spec.ts` — scenario C submit + verify + reject.

Scenario D covered by unit + admin-UI integration test.

---

## 9. Numbered tasks (28 — split Plan 13A + 13B)

**Plan 13A — Data + modules (tasks 1-16)**
1. Migration `20260428000201_organizations.sql`.
2. Migration `20260428000202_organization_contracts.sql` (incl. RLS).
3. Migration `20260428000203_caution_ledger_entries.sql` (append-only triggers + RLS).
4. Migration `20260428000204_players_org_columns.sql` — extend `server/players/types.ts` in same PR.
5. Migration `20260428000205_organizations_rls.sql`.
6. Migrations `20260429000201_disputes.sql` + `20260429000202_appeals.sql`.
7. Migrations `20260430000201..203_content_*.sql`.
8. Migrations `20260502000201_preseason_shoots.sql`, `20260502000202_preseason_shoot_attendance.sql`, `20260502000203_incident_type_preseason_miss.sql`.
9. Implement `apps/web/src/lib/businessDays.ts` + unit tests.
10. Implement `server/orgs/index.ts`, `contracts.ts`, `ledger.ts`, `schemas.ts` + tests.
11. Implement `server/disputes/index.ts` + tests.
12. Implement `server/appeals/index.ts`, `deadline.ts`, `expire.ts` + tests.
13. Implement `server/content/posts.ts`, `status.ts`, `sessions.ts`, `week.ts` + tests.
14. Implement `server/preseason/shoots.ts`, `attendance.ts` + tests.
15. Extend `apps/web/src/perms.ts` with new actions + unit tests.
16. Seed dev: 2 organizations, 1 contract, 1 caution deposit, 1 preseason shoot with sample attendance.

**Plan 13B — UI + E2E (tasks 17-28)**
17. `(admin)/orgs` list, new, detail + server actions.
18. `(admin)/orgs/[id]/ledger/new` form + server action.
19. `(admin)/orgs/[id]/contracts/new` form + upload to `org-contracts`.
20. `(admin)/disputes` list + detail + rule action.
21. `(admin)/appeals` list (with deadline badge) + detail + rule action.
22. `(admin)/content` verification queue + verify/reject.
23. `(admin)/preseason` shoot list + attendance grid.
24. Scaffold `(player)` route group + middleware gate.
25. `(player)/disputes/new` + list.
26. `(player)/appeals/new` + list with deadline countdown.
27. `(player)/content` submission + own-status view.
28. Write 3 E2E specs + wire into `npm --workspace apps/web run e2e`.

---

## 10. Acceptance Criteria

1. `npm run test` — ≥25 new unit tests pass.
2. `npm run lint` — clean.
3. `npm run build` — clean.
4. `npm --workspace apps/web run e2e` — all incl. 3 new pass.
5. `npm run audit:smoke` — `audit_events` captures writes on every new table.
6. Schema query confirms RLS enabled on `organization_contracts`, `caution_ledger_entries`, `disputes`, `appeals`, `content_posts`; append-only triggers on `caution_ledger_entries`; Monday CHECK on `content_posts.week_start`.
7. Four acceptance scenarios (A–D) demonstrated via E2E or scripted manual steps in PR description.
8. Seed DB re-scaffolds from clean state in < 15s.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CAC cert PDF contains bank account numbers (PII leak via unsigned URL) | High | High | Private bucket + signed URLs only; admin UI never renders public `<img src>` of cert — always proxies via server action. RLS on `organization_contracts` denies direct reads. |
| Evidence uploads in disputes/appeals expose PII | High | High | Private buckets, signed URLs. 50 MB cap. EXIF strip deferred to Plan 14. |
| Business-day math wrong near Nigerian public holidays | Medium | High | Accept in v1; document that Nigerian holidays not yet encoded. Admin can manually extend deadline. |
| Caution-fee balance drift between `organizations.caution_fee_balance_coins` and `sum(caution_ledger_entries)` | Medium | High | `recordEntry` runs update + insert in same transaction with `SELECT … FOR UPDATE`. Unit test asserts balance == sum. |
| Admin enters wrong direction, corrupts balance, append-only locks prevent correction | Medium | Medium | `entry_type='adjustment'` with explicit direction books corrections. UI shows previous entries adjacent. |
| Appeal panel members soft-deleted; appeals still reference them | Low | Low | Server-side read joins `users` and tolerates missing. UI renders "[unknown user]". |
| Rule 2.5 warning auto-issued twice on re-save | Medium | Medium | `attendance.markAttendance` checks `warning_issued_bool`; no-op if true. |
| Players circumventing content rule by editing URLs after verification | Medium | Low | `content_posts` update by player blocked (RLS + no endpoint). Moderator-only edit. |

---

## 12. Out of Scope (explicit)

- **Payment gateway / Paystack** — DROPPED ENTIRELY. No stubs, no interfaces, no placeholder env vars.
- **Prize disbursement automation** — DROPPED.
- **IG/TikTok API auto-verification** — Phase 3.
- **vMix / overlay integration** — Plan 12.
- **Squad submission + Friday change window** — Plan 10.
- **Appeal ruling auto-revoking discipline actions beyond simple `revoked_at` path** — keep manual.
- **Holidays calendar for business-day math** — Plan 14.
- **Multi-season contract rollover UI** — deferred.
- **MFA for IDC / admin actions touching money** — Phase 3.
- **OCR of CAC certificates** — never planned.

---

## 13. Critical Files for Implementation

- `apps/web/src/server/players/types.ts`
- `apps/web/src/perms.ts`
- `apps/web/src/server/punishments/index.ts`
- `apps/web/src/lib/time.ts`
- `apps/web/src/lib/businessDays.ts` (new)
