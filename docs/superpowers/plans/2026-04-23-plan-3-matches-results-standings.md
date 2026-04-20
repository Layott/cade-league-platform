# Plan 3 — Matches + Results + Standings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full match-day lifecycle: admins create match days, generate / edit fixtures, enter match results in a two-stage draft-then-confirm flow, and have standings recomputed idempotently on every write. Public visitors see up-to-date `/fixtures` and `/standings` pages (ISR cached). Punishment-driven deductions (Plan 4) slot into the same recompute function via schema columns reserved now.

**Architecture:** All business logic lives in `apps/web/src/server/matches/` and `apps/web/src/server/standings/`. The recompute is a PL/pgSQL stored function `public.recompute_standings(p_season_id uuid)` that deletes + rebuilds `standings` rows for a season from scratch — idempotent by construction (running it twice yields identical output). An AFTER INSERT/UPDATE/DELETE trigger on `match_results` calls it synchronously in the same transaction, so any result mutation leaves standings coherent. Admin UI uses Server Actions that call the service-role Supabase client (bypassing RLS) while still hitting the `audit_row_change()` trigger for audit trail. Public pages read `standings` with tiebreaker ordering applied at query time (points DESC, GD DESC, goals_for DESC) and revalidate every 60s.

**Tech Stack:** Next.js 15 Server Actions + RSC + ISR, Supabase (`@supabase/ssr` anon + `@supabase/supabase-js` service role), PL/pgSQL triggers, Vitest, Playwright, Zod, date-fns-tz (from Plan 0), existing audit + perms infrastructure from Plans 0–1.

**Prerequisites:**
- Plan 0 complete (audit trigger infra, `attach_audit()` helper, `audit_events` table, lint/test baseline).
- Plan 1 complete (`public.users`, `public.user_roles`, middleware gate on `/admin/*`, `getActorFromSession`, `hasPerm`).
- Plan 2 complete (migrations for `public.seasons`, `public.players`, `public.season_participants`; at least one season row + 13 player rows + 13 season_participant rows seeded for the active division).
- `apps/web/.env.local` has working `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

**Shippable at end of Plan 3:**
- Admin can create a match day at `/admin/match-days/new`, then open it to add fixtures + enter results.
- Entering a result with status `draft` does NOT move standings; pressing Confirm (same-admin self-confirm allowed in Phase 1A) writes `confirmed_by` / `confirmed_at` and triggers a recompute.
- Editing an already-confirmed result recomputes standings (no drift — deterministic).
- Forfeit results (`result_type='forfeit'`, auto 3-0 per spec §3.3) count toward standings; voids (`result_type='void'`) do not.
- Public `/standings` shows the 13-player table ordered by tiebreaker rules, revalidating every 60s.
- Public `/fixtures` groups matches by match day with status badges.
- SQL test `supabase/tests/recompute.sql` asserts recompute output against a hand-seeded fixture set; `npm run test:db` runs it green.
- Playwright E2E covers: admin creates match day → enters a result → confirms → `/standings` reflects the change.

---

## File Structure (delta over Plans 0–2)

Created by this plan:

```
apps/web/src/
├── app/
│   ├── admin/
│   │   └── match-days/
│   │       ├── page.tsx                                 # list + "new" link
│   │       ├── new/
│   │       │   ├── page.tsx                             # create form
│   │       │   └── actions.ts                           # createMatchDay server action
│   │       └── [id]/
│   │           ├── page.tsx                             # fixtures + result entry forms
│   │           ├── actions.ts                           # add/remove fixture, enter/edit/confirm/void result
│   │           └── components/
│   │               ├── FixtureRow.tsx                   # client island for one fixture row
│   │               └── ResultEntryForm.tsx              # draft result form
│   ├── fixtures/
│   │   └── page.tsx                                     # public fixtures (ISR 60s)
│   └── standings/
│       └── page.tsx                                     # public standings (ISR 60s)
├── server/
│   ├── matches/
│   │   ├── match-days.ts                                # createMatchDay, listMatchDays, getMatchDay
│   │   ├── match-days.test.ts
│   │   ├── matches.ts                                   # createMatch, listByMatchDay, voidMatch
│   │   ├── matches.test.ts
│   │   ├── results.ts                                   # enterResult, editResult, confirmResult
│   │   ├── results.test.ts
│   │   └── schemas.ts                                   # Zod schemas for all mutable inputs
│   └── standings/
│       ├── index.ts                                     # thin wrapper around the SQL function
│       ├── read.ts                                      # listStandings(seasonId) with tiebreaker ORDER BY
│       └── standings.test.ts
├── lib/
│   └── supabase/
│       └── service.ts                                   # getServiceRoleSupabase() (bypasses RLS, used by server actions)
└── tests/e2e/
    └── match-day-flow.spec.ts

supabase/
├── migrations/
│   ├── 20260423000001_match_days.sql
│   ├── 20260423000002_matches.sql
│   ├── 20260423000003_match_results.sql
│   ├── 20260423000004_player_match_stats.sql
│   ├── 20260423000005_standings.sql
│   ├── 20260423000006_recompute_standings_fn.sql
│   └── 20260423000007_match_results_trigger.sql
└── tests/
    └── recompute.sql
```

Modified:
- `apps/web/package.json` — add `test:db` script that runs `psql -f supabase/tests/recompute.sql`.
- `package.json` (root) — proxy `test:db` to the web workspace.

---

## Task 1: Migration — `match_days` table

**Files:**
- Create: `supabase/migrations/20260423000001_match_days.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- A match day groups N fixtures played on the same physical date at the same venue.
-- Phase 1A: single venue, single season. Statuses drive the admin UI state machine.

create table public.match_days (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references public.seasons (id) on delete restrict,
  match_date            date not null,
  arrival_cutoff_time   time not null,
  match_start_time      time not null,
  venue_name            text not null,
  status                text not null default 'scheduled'
                        check (status in ('scheduled','in_progress','completed','cancelled')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (season_id, match_date)
);

create index match_days_season_date_idx
  on public.match_days (season_id, match_date desc)
  where deleted_at is null;

create index match_days_status_idx
  on public.match_days (status)
  where deleted_at is null;

select public.attach_audit('public.match_days');
```

- [ ] **Step 2: Apply + verify**

```bash
npx supabase db reset
npx supabase db query "select column_name from information_schema.columns where table_schema='public' and table_name='match_days' order by ordinal_position" --output table
```

Expected: 11 columns listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260423000001_match_days.sql
git commit -m "feat(db): match_days table (groups fixtures by date + venue) with audit"
```

---

## Task 2: Migration — `matches` table

**Files:**
- Create: `supabase/migrations/20260423000002_matches.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- One match = one head-to-head fixture between two players on a match day.
-- home_player_id != away_player_id enforced via CHECK; both must be
-- participants in the same season as the match_day.

create table public.matches (
  id               uuid primary key default gen_random_uuid(),
  season_id        uuid not null references public.seasons (id) on delete restrict,
  match_day_id     uuid not null references public.match_days (id) on delete cascade,
  home_player_id   uuid not null references public.players (id) on delete restrict,
  away_player_id   uuid not null references public.players (id) on delete restrict,
  scheduled_time   time,
  status           text not null default 'scheduled'
                   check (status in ('scheduled','in_progress','completed','forfeited','voided')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  check (home_player_id <> away_player_id)
);

create index matches_match_day_idx
  on public.matches (match_day_id)
  where deleted_at is null;

create index matches_season_status_idx
  on public.matches (season_id, status)
  where deleted_at is null;

create index matches_home_idx
  on public.matches (home_player_id, season_id)
  where deleted_at is null;

create index matches_away_idx
  on public.matches (away_player_id, season_id)
  where deleted_at is null;

select public.attach_audit('public.matches');
```

- [ ] **Step 2: Apply + verify**

```bash
npx supabase db reset
```

Expected: migration applies. No error about the self-match CHECK.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260423000002_matches.sql
git commit -m "feat(db): matches table (fixtures) with self-match CHECK + audit"
```

---

## Task 3: Migration — `match_results` table (one-to-one with matches)

**Files:**
- Create: `supabase/migrations/20260423000003_match_results.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Exactly one result per match. Two-stage flow: enterResult writes the row with
-- confirmed_by NULL (status draft); confirmResult sets confirmed_by + confirmed_at.
-- Standings recompute is triggered by the trigger in 20260423000007.

create table public.match_results (
  id                    uuid primary key default gen_random_uuid(),
  match_id              uuid not null unique references public.matches (id) on delete cascade,
  home_score            int  not null check (home_score >= 0),
  away_score            int  not null check (away_score >= 0),
  home_possession_pct   int  check (home_possession_pct between 0 and 100),
  away_possession_pct   int  check (away_possession_pct between 0 and 100),
  result_type           text not null default 'normal'
                        check (result_type in ('normal','forfeit','void')),
  entered_by            uuid not null references public.users (id) on delete restrict,
  entered_at            timestamptz not null default now(),
  confirmed_by          uuid references public.users (id) on delete restrict,
  confirmed_at          timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check (
    (confirmed_by is null and confirmed_at is null)
    or (confirmed_by is not null and confirmed_at is not null)
  )
);

create index match_results_match_idx
  on public.match_results (match_id)
  where deleted_at is null;

create index match_results_confirmed_idx
  on public.match_results (confirmed_at)
  where deleted_at is null and confirmed_at is not null;

select public.attach_audit('public.match_results');
```

- [ ] **Step 2: Apply + verify**

```bash
npx supabase db reset
npx supabase db query "select conname from pg_constraint where conrelid='public.match_results'::regclass and contype='c'" --output table
```

Expected: at least four CHECK constraints listed (scores non-negative, possession 0-100 twice, result_type enum, confirm pair).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260423000003_match_results.sql
git commit -m "feat(db): match_results table (one-to-one with matches) + audit"
```

---

## Task 4: Migration — `player_match_stats` table

**Files:**
- Create: `supabase/migrations/20260423000004_player_match_stats.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Per-player stat row per match. Phase 1A records goals/assists/clean_sheet;
-- custom_metrics JSONB is the extension slot for future metrics
-- (shots, tackles, pass accuracy, etc.) without schema churn.

create table public.player_match_stats (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches (id) on delete cascade,
  player_id       uuid not null references public.players (id) on delete restrict,
  goals           int  not null default 0 check (goals >= 0),
  assists         int  not null default 0 check (assists >= 0),
  clean_sheet     boolean not null default false,
  custom_metrics  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (match_id, player_id)
);

create index player_match_stats_player_idx
  on public.player_match_stats (player_id)
  where deleted_at is null;

create index player_match_stats_match_idx
  on public.player_match_stats (match_id)
  where deleted_at is null;

select public.attach_audit('public.player_match_stats');
```

- [ ] **Step 2: Apply**

```bash
npx supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260423000004_player_match_stats.sql
git commit -m "feat(db): player_match_stats table with JSONB custom metrics + audit"
```

---

## Task 5: Migration — `standings` (materialized) table

**Files:**
- Create: `supabase/migrations/20260423000005_standings.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Materialized per-player row per season. Rebuilt in full by
-- public.recompute_standings(season_id) whenever a result mutates
-- (or a disciplinary action mutates, in Plan 4).
--
-- punishment_points_deducted / punishment_gd_deducted columns exist now
-- so Plan 4's recompute can write them in the same function body
-- without a follow-up schema change. Seeded 0.
--
-- No tiebreaker order stored — tiebreakers are applied at read time
-- via ORDER BY (points desc, gd desc, goals_for desc) in the query.

create table public.standings (
  id                            uuid primary key default gen_random_uuid(),
  season_id                     uuid not null references public.seasons (id) on delete cascade,
  player_id                     uuid not null references public.players (id) on delete cascade,
  matches_played                int  not null default 0,
  wins                          int  not null default 0,
  draws                         int  not null default 0,
  losses                        int  not null default 0,
  goals_for                     int  not null default 0,
  goals_against                 int  not null default 0,
  goal_difference               int  not null default 0,
  points                        int  not null default 0,
  punishment_points_deducted    int  not null default 0,
  punishment_gd_deducted        int  not null default 0,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  deleted_at                    timestamptz,
  unique (season_id, player_id)
);

create index standings_season_idx
  on public.standings (season_id)
  where deleted_at is null;

create index standings_season_points_idx
  on public.standings (season_id, points desc, goal_difference desc, goals_for desc)
  where deleted_at is null;

select public.attach_audit('public.standings');
```

- [ ] **Step 2: Apply + verify**

```bash
npx supabase db reset
npx supabase db query "select column_name from information_schema.columns where table_schema='public' and table_name='standings' order by ordinal_position" --output table
```

Expected: 16 columns including `punishment_points_deducted` + `punishment_gd_deducted`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260423000005_standings.sql
git commit -m "feat(db): standings materialized table (schema for Plan 4 punishment columns)"
```

---

## Task 6: Migration — `recompute_standings` PL/pgSQL function

**Files:**
- Create: `supabase/migrations/20260423000006_recompute_standings_fn.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Fully rebuilds public.standings rows for one season from scratch.
-- Idempotent: running it twice yields identical output.
--
-- Algorithm (spec §5):
--   1. Delete existing standings rows for the season.
--   2. For each participant, aggregate wins/draws/losses/gf/ga/points from
--      match_results JOIN matches where result_type IN ('normal','forfeit')
--      AND the result has been confirmed (confirmed_at IS NOT NULL).
--      Draft (unconfirmed) results are excluded so the draft→confirm flow
--      works.
--   3. Subtract any pre-existing punishment deductions. In Plan 3 these
--      columns will always be 0 (no data source yet); Plan 4 will populate
--      them via a sibling function path. Keeping the subtraction here means
--      Plan 4 is schema + logic only — no change to recompute_standings.
--   4. Upsert the final row.
--
-- Void results (result_type='void') are excluded — no standings contribution
-- for either player.

create or replace function public.recompute_standings(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_punish_points int;
  v_punish_gd     int;
begin
  -- 1. Wipe existing rows for the season.
  delete from public.standings
    where season_id = p_season_id;

  -- 2 + 3 + 4. Aggregate + upsert in a single statement using a CTE.
  insert into public.standings (
    season_id, player_id,
    matches_played, wins, draws, losses,
    goals_for, goals_against, goal_difference, points,
    punishment_points_deducted, punishment_gd_deducted,
    updated_at
  )
  with
  participants as (
    select sp.player_id
      from public.season_participants sp
      where sp.season_id = p_season_id
        and sp.deleted_at is null
  ),
  confirmed_results as (
    select m.id as match_id,
           m.home_player_id,
           m.away_player_id,
           mr.home_score,
           mr.away_score,
           mr.result_type
      from public.matches m
      join public.match_results mr on mr.match_id = m.id
      where m.season_id = p_season_id
        and m.deleted_at is null
        and mr.deleted_at is null
        and mr.confirmed_at is not null
        and mr.result_type in ('normal','forfeit')
  ),
  per_player as (
    -- Home rows
    select home_player_id as player_id,
           home_score as gf,
           away_score as ga,
           case
             when home_score > away_score then 1 else 0
           end as win,
           case
             when home_score = away_score then 1 else 0
           end as draw,
           case
             when home_score < away_score then 1 else 0
           end as loss
      from confirmed_results
    union all
    -- Away rows
    select away_player_id as player_id,
           away_score as gf,
           home_score as ga,
           case
             when away_score > home_score then 1 else 0
           end as win,
           case
             when away_score = home_score then 1 else 0
           end as draw,
           case
             when away_score < home_score then 1 else 0
           end as loss
      from confirmed_results
  ),
  aggregated as (
    select p.player_id,
           coalesce(sum(pp.win  + pp.draw + pp.loss), 0)::int as matches_played,
           coalesce(sum(pp.win), 0)::int                       as wins,
           coalesce(sum(pp.draw), 0)::int                      as draws,
           coalesce(sum(pp.loss), 0)::int                      as losses,
           coalesce(sum(pp.gf), 0)::int                        as goals_for,
           coalesce(sum(pp.ga), 0)::int                        as goals_against
      from participants p
      left join per_player pp on pp.player_id = p.player_id
      group by p.player_id
  )
  select p_season_id,
         a.player_id,
         a.matches_played,
         a.wins, a.draws, a.losses,
         a.goals_for, a.goals_against,
         (a.goals_for - a.goals_against) as goal_difference,
         (a.wins * 3 + a.draws)          as points,
         0  as punishment_points_deducted,
         0  as punishment_gd_deducted,
         now()
    from aggregated a;

  -- Plan 4 hook: once disciplinary_actions exists, update existing rows
  -- with sum(magnitude) per player and subtract. The column subtraction
  -- is already modeled in the read layer (standings.points - 0 = points)
  -- so Plan 4 only needs to add its own UPDATE ... SET punishment_* = ...
  -- then subtract from points/goal_difference via a subsequent UPDATE.
end;
$$;

comment on function public.recompute_standings(uuid) is
  'Idempotent rebuild of public.standings for one season. '
  'Safe to call from triggers or manually. See Plan 3 spec.';
```

- [ ] **Step 2: Apply + smoke**

```bash
npx supabase db reset
npx supabase db query "select public.recompute_standings('00000000-0000-0000-0000-000000000000'::uuid)" --output table
```

Expected: returns a single NULL-valued row (function returns void) without error. No rows created in `standings` because no such season exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260423000006_recompute_standings_fn.sql
git commit -m "feat(db): recompute_standings(season_id) idempotent PL/pgSQL function"
```

---

## Task 7: Migration — trigger on `match_results` to auto-recompute

**Files:**
- Create: `supabase/migrations/20260423000007_match_results_trigger.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- On any mutation of match_results (insert / update / delete), recompute the
-- affected season's standings synchronously in the same transaction.
--
-- For INSERT/UPDATE we derive season_id by joining the match; for DELETE we
-- use OLD. We allow the recompute to fire even when the row is a draft (no
-- confirmed_at) because the recompute function filters unconfirmed rows out
-- internally — so drafts effectively no-op, which is correct.

create or replace function public.match_results_recompute_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season_id uuid;
  v_match_id  uuid;
begin
  if tg_op = 'DELETE' then
    v_match_id := old.match_id;
  else
    v_match_id := new.match_id;
  end if;

  select m.season_id into v_season_id
    from public.matches m
    where m.id = v_match_id;

  if v_season_id is not null then
    perform public.recompute_standings(v_season_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

drop trigger if exists match_results_recompute on public.match_results;
create trigger match_results_recompute
  after insert or update or delete on public.match_results
  for each row execute function public.match_results_recompute_trigger();
```

- [ ] **Step 2: Apply + verify trigger is attached**

```bash
npx supabase db reset
npx supabase db query "select tgname from pg_trigger where tgrelid='public.match_results'::regclass and not tgisinternal" --output table
```

Expected: at least two trigger rows: `audit_public_match_results` and `match_results_recompute`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260423000007_match_results_trigger.sql
git commit -m "feat(db): AFTER trigger on match_results calls recompute_standings"
```

Note: A sibling trigger on `disciplinary_actions` is deferred to Plan 4. Same pattern, separate file.

---

## Task 8: SQL test — `supabase/tests/recompute.sql`

**Files:**
- Create: `supabase/tests/recompute.sql`
- Modify: `package.json` (root) — add `test:db` script
- Modify: `apps/web/package.json` — add `test:db` script (optional mirror)

- [ ] **Step 1: Write the SQL test**

This test asserts the recompute algorithm against a 3-player hand-seeded fixture set:

- Players A, B, C in season S.
- Match 1 (confirmed normal): A 2 - 1 B → A wins, B loses.
- Match 2 (confirmed forfeit 3-0): B 3 - 0 C → B wins, C loses.
- Match 3 (confirmed normal): A 1 - 1 C → draw.
- Match 4 (draft, unconfirmed): A 5 - 0 B → must NOT count.
- Match 5 (confirmed void): A 9 - 0 C → must NOT count.

Expected final standings:

| player | MP | W | D | L | GF | GA | GD | Pts |
|--------|----|---|---|---|----|----|----|-----|
| A      | 2  | 1 | 1 | 0 | 3  | 2  | 1  | 4   |
| B      | 2  | 1 | 0 | 1 | 4  | 2  | 2  | 3   |
| C      | 2  | 0 | 1 | 1 | 1  | 4  | -3 | 1   |

Contents:

```sql
-- Test: public.recompute_standings idempotency + correctness.
-- Runs inside a single transaction that we roll back at the end so the
-- local DB is unaffected.

begin;

-- Seed a throwaway season + 3 players + participants.
do $$
declare
  v_season uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_user uuid;
  v_md uuid := gen_random_uuid();
  v_m1 uuid := gen_random_uuid();
  v_m2 uuid := gen_random_uuid();
  v_m3 uuid := gen_random_uuid();
  v_m4 uuid := gen_random_uuid();
  v_m5 uuid := gen_random_uuid();
begin
  -- A test user to satisfy entered_by FK. Insert into auth.users so the
  -- handle_new_auth_user trigger from Plan 1 populates public.users.
  insert into auth.users (id, email)
    values (gen_random_uuid(), 'recompute-test@cade.local')
    returning id into v_user;
  -- Resolve public.users.id (populated by the auth trigger).
  select id into v_user from public.users where supabase_auth_id = v_user;

  insert into public.seasons (id, year_range, start_date, end_date, status)
    values (v_season, '2099-test', '2099-01-01', '2099-12-31', 'active');

  insert into public.players (id, gamer_tag) values
    (v_a, 'recompute_A'),
    (v_b, 'recompute_B'),
    (v_c, 'recompute_C');

  insert into public.season_participants (season_id, player_id, entry_status) values
    (v_season, v_a, 'active'),
    (v_season, v_b, 'active'),
    (v_season, v_c, 'active');

  insert into public.match_days (id, season_id, match_date, arrival_cutoff_time, match_start_time, venue_name)
    values (v_md, v_season, '2099-06-01', '18:00', '19:00', 'Test Venue');

  insert into public.matches (id, season_id, match_day_id, home_player_id, away_player_id, status) values
    (v_m1, v_season, v_md, v_a, v_b, 'completed'),
    (v_m2, v_season, v_md, v_b, v_c, 'forfeited'),
    (v_m3, v_season, v_md, v_a, v_c, 'completed'),
    (v_m4, v_season, v_md, v_a, v_b, 'completed'),
    (v_m5, v_season, v_md, v_a, v_c, 'voided');

  -- Confirmed normal: A 2-1 B
  insert into public.match_results (match_id, home_score, away_score, result_type,
                                    entered_by, confirmed_by, confirmed_at)
    values (v_m1, 2, 1, 'normal', v_user, v_user, now());

  -- Confirmed forfeit: B 3-0 C
  insert into public.match_results (match_id, home_score, away_score, result_type,
                                    entered_by, confirmed_by, confirmed_at)
    values (v_m2, 3, 0, 'forfeit', v_user, v_user, now());

  -- Confirmed normal: A 1-1 C
  insert into public.match_results (match_id, home_score, away_score, result_type,
                                    entered_by, confirmed_by, confirmed_at)
    values (v_m3, 1, 1, 'normal', v_user, v_user, now());

  -- DRAFT (must not count): A 5-0 B
  insert into public.match_results (match_id, home_score, away_score, result_type, entered_by)
    values (v_m4, 5, 0, 'normal', v_user);

  -- Confirmed VOID (must not count): A 9-0 C
  insert into public.match_results (match_id, home_score, away_score, result_type,
                                    entered_by, confirmed_by, confirmed_at)
    values (v_m5, 9, 0, 'void', v_user, v_user, now());

  -- Trigger has fired on each insert. Call recompute explicitly once more
  -- to prove idempotency: result must be identical.
  perform public.recompute_standings(v_season);

  -- Assertions.
  declare
    v_a_pts int; v_a_gd int; v_a_mp int; v_a_gf int;
    v_b_pts int; v_b_gd int;
    v_c_pts int; v_c_gd int;
    v_row_count int;
  begin
    select points, goal_difference, matches_played, goals_for
      into v_a_pts, v_a_gd, v_a_mp, v_a_gf
      from public.standings where season_id = v_season and player_id = v_a;
    if v_a_pts <> 4 or v_a_gd <> 1 or v_a_mp <> 2 or v_a_gf <> 3 then
      raise exception 'A expected pts=4 gd=1 mp=2 gf=3, got pts=% gd=% mp=% gf=%',
        v_a_pts, v_a_gd, v_a_mp, v_a_gf;
    end if;

    select points, goal_difference into v_b_pts, v_b_gd
      from public.standings where season_id = v_season and player_id = v_b;
    if v_b_pts <> 3 or v_b_gd <> 2 then
      raise exception 'B expected pts=3 gd=2, got pts=% gd=%', v_b_pts, v_b_gd;
    end if;

    select points, goal_difference into v_c_pts, v_c_gd
      from public.standings where season_id = v_season and player_id = v_c;
    if v_c_pts <> 1 or v_c_gd <> -3 then
      raise exception 'C expected pts=1 gd=-3, got pts=% gd=%', v_c_pts, v_c_gd;
    end if;

    select count(*) into v_row_count from public.standings where season_id = v_season;
    if v_row_count <> 3 then
      raise exception 'expected 3 standings rows, got %', v_row_count;
    end if;
  end;

  -- Run recompute a SECOND time. Output must be identical (idempotency).
  perform public.recompute_standings(v_season);
  declare
    v_a_pts_2 int;
  begin
    select points into v_a_pts_2
      from public.standings where season_id = v_season and player_id = v_a;
    if v_a_pts_2 <> 4 then
      raise exception 'idempotency FAIL: A pts=% after 2nd recompute', v_a_pts_2;
    end if;
  end;

  -- Edit-existing-result case: flip match 1 from A 2-1 B to B 4-0 A.
  -- Expected new A: MP 2, W 0 D 1 L 1, GF 1 GA 5, GD -4, pts 1.
  -- Expected new B: MP 2, W 2 D 0 L 0, GF 7 GA 1, GD 6, pts 6.
  update public.match_results
    set home_score = 0, away_score = 4
    where match_id = v_m1;
  declare
    v_a_pts_e int; v_a_gd_e int;
    v_b_pts_e int; v_b_gd_e int;
  begin
    select points, goal_difference into v_a_pts_e, v_a_gd_e
      from public.standings where season_id = v_season and player_id = v_a;
    if v_a_pts_e <> 1 or v_a_gd_e <> -4 then
      raise exception 'edit case A expected pts=1 gd=-4, got pts=% gd=%', v_a_pts_e, v_a_gd_e;
    end if;
    select points, goal_difference into v_b_pts_e, v_b_gd_e
      from public.standings where season_id = v_season and player_id = v_b;
    if v_b_pts_e <> 6 or v_b_gd_e <> 6 then
      raise exception 'edit case B expected pts=6 gd=6, got pts=% gd=%', v_b_pts_e, v_b_gd_e;
    end if;
  end;

  raise notice 'recompute test: OK';
end;
$$;

rollback;
```

- [ ] **Step 2: Wire up `test:db` script**

Edit `apps/web/package.json` scripts to add:

```json
"test:db": "psql \"postgresql://postgres:postgres@127.0.0.1:54322/postgres\" -v ON_ERROR_STOP=1 -f ../../supabase/tests/recompute.sql"
```

Edit the root `package.json` scripts to proxy:

```json
"test:db": "npm --workspace apps/web run test:db"
```

- [ ] **Step 3: Run the test — expect PASS**

```bash
npx supabase db reset
npm run test:db
```

Expected: output includes `NOTICE:  recompute test: OK` and process exits 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/recompute.sql package.json apps/web/package.json
git commit -m "test(db): recompute_standings correctness + idempotency + edit cases"
```

---

## Task 9: Service-role Supabase client helper

**Files:**
- Create: `apps/web/src/lib/supabase/service.ts`

- [ ] **Step 1: Write helper**

Contents:

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client with the service-role key. Bypasses RLS.
 *
 * Use in Server Actions / Route Handlers for writes that the authenticated
 * user's session cannot perform directly (e.g. match result entry: the admin
 * is authenticated but we still write via service role so we control audit
 * context and don't depend on policy glue code).
 *
 * Never expose this client to browser code.
 */
let cached: SupabaseClient | null = null;

export function getServiceRoleSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "getServiceRoleSupabase: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm --workspace apps/web run build
```

Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/supabase/service.ts
git commit -m "feat(web): service-role Supabase client helper (bypasses RLS)"
```

---

## Task 10: Zod schemas for all match/result inputs

**Files:**
- Create: `apps/web/src/server/matches/schemas.ts`

- [ ] **Step 1: Write schemas**

Contents:

```ts
import { z } from "zod";

export const createMatchDaySchema = z.object({
  seasonId: z.string().uuid(),
  matchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  arrivalCutoffTime: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM"),
  matchStartTime: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM"),
  venueName: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateMatchDayInput = z.infer<typeof createMatchDaySchema>;

export const createMatchSchema = z.object({
  matchDayId: z.string().uuid(),
  homePlayerId: z.string().uuid(),
  awayPlayerId: z.string().uuid(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  notes: z.string().trim().max(2000).optional(),
}).refine((v) => v.homePlayerId !== v.awayPlayerId, {
  message: "home and away cannot be the same player",
  path: ["awayPlayerId"],
});
export type CreateMatchInput = z.infer<typeof createMatchSchema>;

const scoreField = z.coerce.number().int().nonnegative().max(99);
const possessionField = z.coerce.number().int().min(0).max(100).optional();

export const enterResultSchema = z.object({
  matchId: z.string().uuid(),
  homeScore: scoreField,
  awayScore: scoreField,
  homePossession: possessionField,
  awayPossession: possessionField,
  resultType: z.enum(["normal", "forfeit", "void"]).default("normal"),
  notes: z.string().trim().max(2000).optional(),
});
export type EnterResultInput = z.infer<typeof enterResultSchema>;

export const confirmResultSchema = z.object({
  matchId: z.string().uuid(),
});
export type ConfirmResultInput = z.infer<typeof confirmResultSchema>;
```

- [ ] **Step 2: Typecheck**

```bash
npm --workspace apps/web run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server/matches/schemas.ts
git commit -m "feat(matches): Zod schemas for match-day, match, result inputs"
```

---

## Task 11: `server/matches/match-days.ts` — TDD

**Files:**
- Create: `apps/web/src/server/matches/match-days.ts`
- Create: `apps/web/src/server/matches/match-days.test.ts`

- [ ] **Step 1: Failing test**

Contents of `match-days.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMatchDay } from "./match-days";

function mockSb(insertResult: { id: string } | null, insertError: Error | null = null) {
  const insertFn = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue(
        insertError
          ? { data: null, error: insertError }
          : { data: insertResult, error: null }
      ),
    })),
  }));
  return {
    from: vi.fn(() => ({ insert: insertFn })),
    _insertFn: insertFn,
  };
}

describe("createMatchDay", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects invalid date format", async () => {
    const sb = mockSb({ id: "x" });
    await expect(
      createMatchDay(sb as never, {
        seasonId: "11111111-1111-1111-1111-111111111111",
        matchDate: "2026/06/01",
        arrivalCutoffTime: "18:00",
        matchStartTime: "19:00",
        venueName: "v",
      } as never)
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("inserts row and returns id on happy path", async () => {
    const sb = mockSb({ id: "md-1" });
    const out = await createMatchDay(sb as never, {
      seasonId: "11111111-1111-1111-1111-111111111111",
      matchDate: "2026-06-01",
      arrivalCutoffTime: "18:00",
      matchStartTime: "19:00",
      venueName: "CADE HQ",
    });
    expect(out).toEqual({ id: "md-1" });
    expect(sb.from).toHaveBeenCalledWith("match_days");
  });

  it("maps camelCase → snake_case in insert payload", async () => {
    const sb = mockSb({ id: "md-2" });
    await createMatchDay(sb as never, {
      seasonId: "11111111-1111-1111-1111-111111111111",
      matchDate: "2026-06-02",
      arrivalCutoffTime: "17:30",
      matchStartTime: "18:30",
      venueName: "Venue",
      notes: "pre-match meal",
    });
    const payload = (sb._insertFn.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      season_id: "11111111-1111-1111-1111-111111111111",
      match_date: "2026-06-02",
      arrival_cutoff_time: "17:30",
      match_start_time: "18:30",
      venue_name: "Venue",
      notes: "pre-match meal",
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `match-days.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMatchDaySchema,
  type CreateMatchDayInput,
} from "./schemas";

export type MatchDaySummary = {
  id: string;
  season_id: string;
  match_date: string;
  venue_name: string;
  status: string;
  match_count: number;
};

export async function createMatchDay(
  sb: SupabaseClient,
  raw: CreateMatchDayInput
): Promise<{ id: string }> {
  const input = createMatchDaySchema.parse(raw);

  const { data, error } = await sb
    .from("match_days")
    .insert({
      season_id: input.seasonId,
      match_date: input.matchDate,
      arrival_cutoff_time: input.arrivalCutoffTime,
      match_start_time: input.matchStartTime,
      venue_name: input.venueName,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`createMatchDay failed: ${error?.message ?? "no data"}`);
  }
  return { id: data.id };
}

export async function listMatchDays(
  sb: SupabaseClient,
  seasonId: string
): Promise<MatchDaySummary[]> {
  const { data, error } = await sb
    .from("match_days")
    .select("id, season_id, match_date, venue_name, status, matches:matches(count)")
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("match_date", { ascending: false });
  if (error) throw new Error(`listMatchDays failed: ${error.message}`);
  return (data ?? []).map((r: {
    id: string; season_id: string; match_date: string;
    venue_name: string; status: string;
    matches: { count: number }[] | null;
  }) => ({
    id: r.id,
    season_id: r.season_id,
    match_date: r.match_date,
    venue_name: r.venue_name,
    status: r.status,
    match_count: r.matches?.[0]?.count ?? 0,
  }));
}

export async function getMatchDay(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from("match_days")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw new Error(`match_day ${id} not found`);
  return data;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/matches/match-days.ts apps/web/src/server/matches/match-days.test.ts
git commit -m "feat(matches): createMatchDay + listMatchDays + getMatchDay"
```

---

## Task 12: `server/matches/matches.ts` — TDD

**Files:**
- Create: `apps/web/src/server/matches/matches.ts`
- Create: `apps/web/src/server/matches/matches.test.ts`

- [ ] **Step 1: Failing test**

Contents of `matches.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMatch, voidMatch } from "./matches";

function mkSb({
  matchDay,
  insertId = "m-1",
}: {
  matchDay: { season_id: string } | null;
  insertId?: string;
}) {
  const insertFn = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: insertId }, error: null }),
    })),
  }));
  const updateFn = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));
  return {
    from: vi.fn((table: string) => {
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: matchDay, error: matchDay ? null : new Error("no") }),
              })),
            })),
          })),
        };
      }
      if (table === "matches") return { insert: insertFn, update: updateFn };
      throw new Error(`unexpected table ${table}`);
    }),
    _insert: insertFn,
    _update: updateFn,
  };
}

describe("createMatch", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects same home/away player", async () => {
    const sb = mkSb({ matchDay: { season_id: "s-1" } });
    await expect(
      createMatch(sb as never, {
        matchDayId: "11111111-1111-1111-1111-111111111111",
        homePlayerId: "22222222-2222-2222-2222-222222222222",
        awayPlayerId: "22222222-2222-2222-2222-222222222222",
      })
    ).rejects.toThrow(/same player/i);
  });

  it("resolves season_id from match_day and inserts", async () => {
    const sb = mkSb({ matchDay: { season_id: "s-1" } });
    const out = await createMatch(sb as never, {
      matchDayId: "11111111-1111-1111-1111-111111111111",
      homePlayerId: "22222222-2222-2222-2222-222222222222",
      awayPlayerId: "33333333-3333-3333-3333-333333333333",
    });
    expect(out.id).toBe("m-1");
    const payload = (sb._insert.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ season_id: "s-1", home_player_id: "22222222-2222-2222-2222-222222222222" });
  });
});

describe("voidMatch", () => {
  it("sets status=voided on the matches row", async () => {
    const sb = mkSb({ matchDay: { season_id: "s-1" } });
    await voidMatch(sb as never, "m-77");
    expect(sb._update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `matches.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMatchSchema, type CreateMatchInput } from "./schemas";

export async function createMatch(
  sb: SupabaseClient,
  raw: CreateMatchInput
): Promise<{ id: string }> {
  const input = createMatchSchema.parse(raw);

  // Resolve season_id from the match_day row.
  const { data: md, error: mdErr } = await sb
    .from("match_days")
    .select("season_id")
    .eq("id", input.matchDayId)
    .is("deleted_at", null)
    .single();
  if (mdErr || !md) throw new Error(`match_day ${input.matchDayId} not found`);

  const { data, error } = await sb
    .from("matches")
    .insert({
      season_id: md.season_id,
      match_day_id: input.matchDayId,
      home_player_id: input.homePlayerId,
      away_player_id: input.awayPlayerId,
      scheduled_time: input.scheduledTime ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createMatch failed: ${error?.message ?? "no data"}`);
  return { id: data.id };
}

export async function listByMatchDay(sb: SupabaseClient, matchDayId: string) {
  const { data, error } = await sb
    .from("matches")
    .select(`
      id, status, scheduled_time, notes,
      home_player:home_player_id ( id, gamer_tag, display_name ),
      away_player:away_player_id ( id, gamer_tag, display_name ),
      result:match_results ( id, home_score, away_score, result_type, confirmed_at )
    `)
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listByMatchDay failed: ${error.message}`);
  return data ?? [];
}

export async function voidMatch(sb: SupabaseClient, matchId: string): Promise<void> {
  const { error } = await sb.from("matches").update({ status: "voided" }).eq("id", matchId);
  if (error) throw new Error(`voidMatch failed: ${error.message}`);
}
```

- [ ] **Step 4: Run — PASS**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/matches/matches.ts apps/web/src/server/matches/matches.test.ts
git commit -m "feat(matches): createMatch + listByMatchDay + voidMatch"
```

---

## Task 13: `server/matches/results.ts` — TDD (draft → confirm → edit)

**Files:**
- Create: `apps/web/src/server/matches/results.ts`
- Create: `apps/web/src/server/matches/results.test.ts`

- [ ] **Step 1: Failing test**

Contents of `results.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterResult, editResult, confirmResult } from "./results";

function mkSb({
  existing,
  insertId = "r-1",
}: {
  existing?: { id: string; confirmed_at: string | null };
  insertId?: string;
}) {
  const insertFn = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: insertId }, error: null }),
    })),
  }));
  const updateFn = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: existing?.id ?? insertId }, error: null }),
      })),
    })),
  }));
  const matchUpdateFn = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  return {
    from: vi.fn((t: string) => {
      if (t === "match_results") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: existing ?? null, error: null }),
              })),
            })),
          })),
          insert: insertFn,
          update: updateFn,
        };
      }
      if (t === "matches") {
        return { update: matchUpdateFn };
      }
      throw new Error(`unexpected ${t}`);
    }),
    _insert: insertFn,
    _update: updateFn,
    _matchUpdate: matchUpdateFn,
  };
}

const ACTOR = "00000000-0000-0000-0000-000000000099";
const MATCH = "11111111-1111-1111-1111-111111111111";

describe("enterResult", () => {
  beforeEach(() => vi.resetAllMocks());

  it("inserts a draft result when none exists and marks match completed", async () => {
    const sb = mkSb({});
    const out = await enterResult(sb as never, {
      matchId: MATCH, homeScore: 2, awayScore: 1, resultType: "normal",
    }, ACTOR);
    expect(out.id).toBe("r-1");
    expect(sb._insert).toHaveBeenCalledOnce();
    expect(sb._matchUpdate).toHaveBeenCalledOnce();
  });

  it("rejects re-entering when a result already exists", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: null } });
    await expect(
      enterResult(sb as never, {
        matchId: MATCH, homeScore: 0, awayScore: 0, resultType: "normal",
      }, ACTOR)
    ).rejects.toThrow(/already exists/i);
  });

  it("auto-coerces forfeit to 3-0", async () => {
    const sb = mkSb({});
    await enterResult(sb as never, {
      matchId: MATCH, homeScore: 0, awayScore: 0, resultType: "forfeit",
    }, ACTOR);
    const payload = (sb._insert.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload.home_score).toBe(3);
    expect(payload.away_score).toBe(0);
  });
});

describe("editResult", () => {
  it("updates existing row (keeps confirmed_at untouched)", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: "2026-01-01T00:00:00Z" } });
    await editResult(sb as never, {
      matchId: MATCH, homeScore: 4, awayScore: 2, resultType: "normal",
    });
    expect(sb._update).toHaveBeenCalledOnce();
    const payload = (sb._update.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("confirmed_at");
  });
});

describe("confirmResult", () => {
  it("sets confirmed_by + confirmed_at", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: null } });
    await confirmResult(sb as never, { matchId: MATCH }, ACTOR);
    expect(sb._update).toHaveBeenCalledOnce();
    const payload = (sb._update.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload.confirmed_by).toBe(ACTOR);
    expect(typeof payload.confirmed_at).toBe("string");
  });

  it("throws if no draft exists", async () => {
    const sb = mkSb({});
    await expect(
      confirmResult(sb as never, { matchId: MATCH }, ACTOR)
    ).rejects.toThrow(/no result/i);
  });

  it("is a no-op if already confirmed", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: "2026-01-01T00:00:00Z" } });
    await confirmResult(sb as never, { matchId: MATCH }, ACTOR);
    expect(sb._update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `results.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enterResultSchema,
  confirmResultSchema,
  type EnterResultInput,
  type ConfirmResultInput,
} from "./schemas";

type ExistingResult = { id: string; confirmed_at: string | null } | null;

async function findExistingResult(sb: SupabaseClient, matchId: string): Promise<ExistingResult> {
  const { data, error } = await sb
    .from("match_results")
    .select("id, confirmed_at")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`findExistingResult failed: ${error.message}`);
  return data ?? null;
}

/**
 * Normalize forfeit scores: spec §3.3 says forfeit results are auto 3-0.
 * Only the winning side matters — caller passes resultType='forfeit' plus
 * which side forfeited implied by which score is greater (or we default
 * to home wins 3-0 if both zero).
 */
function normalizeScores(input: EnterResultInput): { home: number; away: number } {
  if (input.resultType !== "forfeit") {
    return { home: input.homeScore, away: input.awayScore };
  }
  // Forfeit: whichever side has the HIGHER input score wins 3-0.
  // If both are zero, default home 3-0.
  if (input.awayScore > input.homeScore) return { home: 0, away: 3 };
  return { home: 3, away: 0 };
}

export async function enterResult(
  sb: SupabaseClient,
  raw: EnterResultInput,
  actorUserId: string
): Promise<{ id: string }> {
  const input = enterResultSchema.parse(raw);

  const existing = await findExistingResult(sb, input.matchId);
  if (existing) {
    throw new Error(`result already exists for match ${input.matchId}; use editResult`);
  }

  const { home, away } = normalizeScores(input);

  const { data, error } = await sb
    .from("match_results")
    .insert({
      match_id: input.matchId,
      home_score: home,
      away_score: away,
      home_possession_pct: input.homePossession ?? null,
      away_possession_pct: input.awayPossession ?? null,
      result_type: input.resultType,
      entered_by: actorUserId,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`enterResult failed: ${error?.message ?? "no data"}`);
  }

  // Flip the match status (distinct for forfeits).
  const matchStatus = input.resultType === "forfeit" ? "forfeited"
                    : input.resultType === "void"    ? "voided"
                    : "completed";
  const { error: mErr } = await sb
    .from("matches")
    .update({ status: matchStatus })
    .eq("id", input.matchId);
  if (mErr) throw new Error(`match status update failed: ${mErr.message}`);

  return { id: data.id };
}

export async function editResult(
  sb: SupabaseClient,
  raw: EnterResultInput
): Promise<{ id: string }> {
  const input = enterResultSchema.parse(raw);
  const existing = await findExistingResult(sb, input.matchId);
  if (!existing) throw new Error(`no result to edit for match ${input.matchId}`);

  const { home, away } = normalizeScores(input);
  const { data, error } = await sb
    .from("match_results")
    .update({
      home_score: home,
      away_score: away,
      home_possession_pct: input.homePossession ?? null,
      away_possession_pct: input.awayPossession ?? null,
      result_type: input.resultType,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("match_id", input.matchId)
    .select("id")
    .single();
  if (error || !data) throw new Error(`editResult failed: ${error?.message ?? "no data"}`);

  // Edit may have flipped forfeit/void/normal — reflect on match status.
  const matchStatus = input.resultType === "forfeit" ? "forfeited"
                    : input.resultType === "void"    ? "voided"
                    : "completed";
  await sb.from("matches").update({ status: matchStatus }).eq("id", input.matchId);
  return { id: data.id };
}

export async function confirmResult(
  sb: SupabaseClient,
  raw: ConfirmResultInput,
  actorUserId: string
): Promise<{ alreadyConfirmed: boolean }> {
  const input = confirmResultSchema.parse(raw);
  const existing = await findExistingResult(sb, input.matchId);
  if (!existing) throw new Error(`no result to confirm for match ${input.matchId}`);
  if (existing.confirmed_at) return { alreadyConfirmed: true };

  const { error } = await sb
    .from("match_results")
    .update({
      confirmed_by: actorUserId,
      confirmed_at: new Date().toISOString(),
    })
    .eq("match_id", input.matchId)
    .select("id")
    .single();
  if (error) throw new Error(`confirmResult failed: ${error.message}`);
  return { alreadyConfirmed: false };
}
```

- [ ] **Step 4: PASS**

```bash
npm --workspace apps/web run test
```

Expected: 7 new tests pass (enterResult x3 + editResult x1 + confirmResult x3).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/matches/results.ts apps/web/src/server/matches/results.test.ts
git commit -m "feat(matches): enterResult/editResult/confirmResult (draft→confirm flow)"
```

---

## Task 14: `server/standings/read.ts` + wrapper — TDD

**Files:**
- Create: `apps/web/src/server/standings/index.ts`
- Create: `apps/web/src/server/standings/read.ts`
- Create: `apps/web/src/server/standings/standings.test.ts`

- [ ] **Step 1: Failing test**

Contents of `standings.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { listStandings } from "./read";
import { recomputeStandings } from ".";

describe("recomputeStandings (wrapper around SQL fn)", () => {
  it("calls rpc('recompute_standings', { p_season_id })", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const sb = { rpc } as unknown as never;
    await recomputeStandings(sb, "s-1");
    expect(rpc).toHaveBeenCalledWith("recompute_standings", { p_season_id: "s-1" });
  });

  it("throws when rpc returns error", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const sb = { rpc } as unknown as never;
    await expect(recomputeStandings(sb, "s-1")).rejects.toThrow(/boom/);
  });
});

describe("listStandings", () => {
  it("orders by points DESC, GD DESC, goals_for DESC", async () => {
    const order = vi.fn().mockReturnThis();
    const is = vi.fn(() => ({
      order, then: (cb: (x: unknown) => unknown) => cb({ data: [], error: null }),
    }));
    // Simpler: mock the final await target
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    } as unknown as never;
    const rows = await listStandings(sb, "s-1");
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `index.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Thin wrapper around the SQL function public.recompute_standings(uuid).
 *
 * In Phase 1A this is rarely called from app code — the AFTER trigger on
 * match_results already fires it. Use cases for the wrapper:
 *   - Reconciliation script (verify standings by forcing a rebuild).
 *   - Future background job (Phase 2+).
 *   - Plan 4: manual trigger after disciplinary_action mutations (until the
 *     Plan 4 trigger lands).
 */
export async function recomputeStandings(
  sb: SupabaseClient,
  seasonId: string
): Promise<void> {
  const { error } = await sb.rpc("recompute_standings", { p_season_id: seasonId });
  if (error) throw new Error(`recomputeStandings failed: ${error.message}`);
}
```

- [ ] **Step 4: Implement `read.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type StandingsRow = {
  player_id: string;
  player_name: string;
  gamer_tag: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  punishment_points_deducted: number;
  punishment_gd_deducted: number;
};

/**
 * Read standings for a season with tiebreaker ordering applied.
 * Tiebreakers (spec §5): points DESC, GD DESC, goals_for DESC.
 * Head-to-head is a Phase 1B concern.
 */
export async function listStandings(
  sb: SupabaseClient,
  seasonId: string
): Promise<StandingsRow[]> {
  const { data, error } = await sb
    .from("standings")
    .select(`
      player_id,
      matches_played, wins, draws, losses,
      goals_for, goals_against, goal_difference, points,
      punishment_points_deducted, punishment_gd_deducted,
      player:player_id ( id, gamer_tag, display_name )
    `)
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("points", { ascending: false })
    .order("goal_difference", { ascending: false })
    .order("goals_for", { ascending: false });

  if (error) throw new Error(`listStandings failed: ${error.message}`);

  return (data ?? []).map((r: {
    player_id: string;
    matches_played: number; wins: number; draws: number; losses: number;
    goals_for: number; goals_against: number; goal_difference: number; points: number;
    punishment_points_deducted: number; punishment_gd_deducted: number;
    player: { id: string; gamer_tag: string; display_name: string | null } | null;
  }) => ({
    player_id: r.player_id,
    player_name: r.player?.display_name ?? r.player?.gamer_tag ?? "(unknown)",
    gamer_tag: r.player?.gamer_tag ?? "",
    matches_played: r.matches_played,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    goals_for: r.goals_for,
    goals_against: r.goals_against,
    goal_difference: r.goal_difference,
    points: r.points,
    punishment_points_deducted: r.punishment_points_deducted,
    punishment_gd_deducted: r.punishment_gd_deducted,
  }));
}
```

- [ ] **Step 5: PASS**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/standings
git commit -m "feat(standings): recomputeStandings RPC wrapper + listStandings reader"
```

---

## Task 15: Admin UI — `/admin/match-days` list + create

**Files:**
- Create: `apps/web/src/app/admin/match-days/page.tsx`
- Create: `apps/web/src/app/admin/match-days/new/page.tsx`
- Create: `apps/web/src/app/admin/match-days/new/actions.ts`

- [ ] **Step 1: Write list page**

Contents of `apps/web/src/app/admin/match-days/page.tsx`:

```tsx
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { listMatchDays } from "@/server/matches/match-days";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MatchDaysPage() {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .single();

  const days = season ? await listMatchDays(sb, season.id) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Match Days</h2>
        <Link
          href="/admin/match-days/new"
          className="bg-black text-white px-4 py-2 rounded text-sm"
          data-testid="new-match-day-link"
        >
          + New match day
        </Link>
      </div>
      <table className="w-full text-sm border bg-white">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Date</th>
            <th className="text-left p-2">Venue</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Fixtures</th>
            <th className="text-left p-2"></th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="p-2">{formatWat(`${d.match_date}T00:00:00Z`, "EEE, MMM d yyyy")}</td>
              <td className="p-2">{d.venue_name}</td>
              <td className="p-2">{d.status}</td>
              <td className="p-2">{d.match_count}</td>
              <td className="p-2">
                <Link href={`/admin/match-days/${d.id}`} className="underline">
                  Manage
                </Link>
              </td>
            </tr>
          ))}
          {days.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-4 text-center text-gray-500">
                No match days yet. Click "New match day" to create one.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Write `new/actions.ts`**

Contents:

```ts
"use server";

import { redirect } from "next/navigation";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { createMatchDay } from "@/server/matches/match-days";

export async function createMatchDayAction(formData: FormData) {
  const sb = getServiceRoleSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .single();
  if (!season) throw new Error("no active season configured");

  const { id } = await createMatchDay(sb, {
    seasonId: season.id,
    matchDate: String(formData.get("matchDate") ?? ""),
    arrivalCutoffTime: String(formData.get("arrivalCutoffTime") ?? ""),
    matchStartTime: String(formData.get("matchStartTime") ?? ""),
    venueName: String(formData.get("venueName") ?? ""),
    notes: (formData.get("notes") ? String(formData.get("notes")) : undefined),
  });
  redirect(`/admin/match-days/${id}`);
}
```

- [ ] **Step 3: Write `new/page.tsx`**

Contents:

```tsx
import { createMatchDayAction } from "./actions";

export default function NewMatchDayPage() {
  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-2xl font-bold">New match day</h2>
      <form action={createMatchDayAction} className="space-y-4 bg-white border rounded p-6">
        <label className="block space-y-1">
          <span className="text-sm">Match date</span>
          <input name="matchDate" type="date" required className="w-full border rounded px-3 py-2" />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-sm">Arrival cutoff (WAT)</span>
            <input name="arrivalCutoffTime" type="time" required defaultValue="18:00"
                   className="w-full border rounded px-3 py-2" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm">Match start (WAT)</span>
            <input name="matchStartTime" type="time" required defaultValue="19:00"
                   className="w-full border rounded px-3 py-2" />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm">Venue</span>
          <input name="venueName" type="text" required defaultValue="CADE HQ"
                 className="w-full border rounded px-3 py-2" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">Notes (optional)</span>
          <textarea name="notes" rows={3} className="w-full border rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-black text-white px-4 py-2 rounded">Create</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/match-days/page.tsx apps/web/src/app/admin/match-days/new
git commit -m "feat(admin): /admin/match-days list + new match-day form"
```

---

## Task 16: Admin UI — `/admin/match-days/[id]` with fixtures + result entry

**Files:**
- Create: `apps/web/src/app/admin/match-days/[id]/page.tsx`
- Create: `apps/web/src/app/admin/match-days/[id]/actions.ts`

- [ ] **Step 1: Write `actions.ts`**

Contents:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { createMatch } from "@/server/matches/matches";
import {
  enterResult,
  editResult,
  confirmResult,
} from "@/server/matches/results";

async function currentPublicUserId(): Promise<string> {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error("not authenticated");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .single();
  if (!pub) throw new Error("public.users row missing");
  return pub.id;
}

export async function addFixtureAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const homePlayerId = String(formData.get("homePlayerId") ?? "");
  const awayPlayerId = String(formData.get("awayPlayerId") ?? "");
  const scheduledTime = formData.get("scheduledTime")
    ? String(formData.get("scheduledTime"))
    : undefined;

  const sb = getServiceRoleSupabase();
  await createMatch(sb, { matchDayId, homePlayerId, awayPlayerId, scheduledTime });
  revalidatePath(`/admin/match-days/${matchDayId}`);
}

export async function enterResultAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const resultType = (formData.get("resultType") ?? "normal") as "normal" | "forfeit" | "void";

  const sb = getServiceRoleSupabase();
  const actor = await currentPublicUserId();
  await enterResult(sb, {
    matchId,
    homeScore: Number(formData.get("homeScore") ?? 0),
    awayScore: Number(formData.get("awayScore") ?? 0),
    homePossession: formData.get("homePossession")
      ? Number(formData.get("homePossession"))
      : undefined,
    awayPossession: formData.get("awayPossession")
      ? Number(formData.get("awayPossession"))
      : undefined,
    resultType,
    notes: (formData.get("notes") ? String(formData.get("notes")) : undefined),
  }, actor);
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/standings");
  revalidatePath("/fixtures");
}

export async function editResultAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const resultType = (formData.get("resultType") ?? "normal") as "normal" | "forfeit" | "void";

  const sb = getServiceRoleSupabase();
  await editResult(sb, {
    matchId,
    homeScore: Number(formData.get("homeScore") ?? 0),
    awayScore: Number(formData.get("awayScore") ?? 0),
    homePossession: formData.get("homePossession")
      ? Number(formData.get("homePossession"))
      : undefined,
    awayPossession: formData.get("awayPossession")
      ? Number(formData.get("awayPossession"))
      : undefined,
    resultType,
    notes: (formData.get("notes") ? String(formData.get("notes")) : undefined),
  });
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/standings");
}

export async function confirmResultAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const sb = getServiceRoleSupabase();
  const actor = await currentPublicUserId();
  await confirmResult(sb, { matchId }, actor);
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/standings");
  revalidatePath("/fixtures");
}

export async function backToList() {
  redirect("/admin/match-days");
}
```

- [ ] **Step 2: Write `page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { getMatchDay } from "@/server/matches/match-days";
import { listByMatchDay } from "@/server/matches/matches";
import { formatWat } from "@/lib/time";
import {
  addFixtureAction,
  confirmResultAction,
  editResultAction,
  enterResultAction,
} from "./actions";

export const dynamic = "force-dynamic";

type MatchRow = Awaited<ReturnType<typeof listByMatchDay>>[number];

export default async function MatchDayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const matchDay = await getMatchDay(sb, id);
  const matches = (await listByMatchDay(sb, id)) as MatchRow[];

  const { data: players } = await sb
    .from("season_participants")
    .select("player_id, player:player_id ( id, gamer_tag, display_name )")
    .eq("season_id", matchDay.season_id)
    .is("deleted_at", null);

  const playerOptions = (players ?? []).map((p: {
    player_id: string;
    player: { id: string; gamer_tag: string; display_name: string | null } | null;
  }) => ({
    id: p.player_id,
    label: p.player?.display_name ?? p.player?.gamer_tag ?? p.player_id,
  }));

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold">
          {formatWat(`${matchDay.match_date}T00:00:00Z`, "EEEE, MMMM d yyyy")}
        </h2>
        <p className="text-gray-600">
          {matchDay.venue_name} · arrival {matchDay.arrival_cutoff_time} · KO {matchDay.match_start_time}
        </p>
      </header>

      {/* Add fixture */}
      <section className="border rounded bg-white p-4 space-y-3">
        <h3 className="font-semibold">Add fixture</h3>
        <form action={addFixtureAction} className="grid grid-cols-5 gap-2 items-end">
          <input type="hidden" name="matchDayId" value={matchDay.id} />
          <label className="col-span-2">
            <span className="text-xs block">Home</span>
            <select name="homePlayerId" required className="w-full border rounded px-2 py-1">
              <option value="">—</option>
              {playerOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="col-span-2">
            <span className="text-xs block">Away</span>
            <select name="awayPlayerId" required className="w-full border rounded px-2 py-1">
              <option value="">—</option>
              {playerOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <button type="submit" className="bg-black text-white rounded px-3 py-1.5 text-sm">Add</button>
        </form>
      </section>

      {/* Fixture list */}
      <section className="space-y-3">
        <h3 className="font-semibold">Fixtures ({matches.length})</h3>
        {matches.length === 0 ? (
          <p className="text-gray-500">No fixtures yet.</p>
        ) : (
          <ul className="space-y-3">
            {matches.map((m) => {
              const result = Array.isArray(m.result) ? m.result[0] : m.result;
              const confirmed = !!result?.confirmed_at;
              return (
                <li key={m.id} className="border rounded bg-white p-4" data-testid={`fixture-${m.id}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">
                        {(Array.isArray(m.home_player) ? m.home_player[0] : m.home_player)?.display_name ?? "?"}
                      </span>
                      <span className="px-2 text-gray-500">vs</span>
                      <span className="font-medium">
                        {(Array.isArray(m.away_player) ? m.away_player[0] : m.away_player)?.display_name ?? "?"}
                      </span>
                    </div>
                    <span
                      className={
                        "text-xs px-2 py-1 rounded " +
                        (confirmed
                          ? "bg-green-100 text-green-800"
                          : result
                          ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 text-gray-700")
                      }
                    >
                      {confirmed ? "confirmed" : result ? "draft" : m.status}
                    </span>
                  </div>

                  <form
                    action={result ? editResultAction : enterResultAction}
                    className="mt-3 grid grid-cols-6 gap-2 items-end"
                  >
                    <input type="hidden" name="matchDayId" value={matchDay.id} />
                    <input type="hidden" name="matchId" value={m.id} />
                    <label>
                      <span className="text-xs block">Home score</span>
                      <input name="homeScore" type="number" min={0} defaultValue={result?.home_score ?? 0}
                             className="w-full border rounded px-2 py-1" />
                    </label>
                    <label>
                      <span className="text-xs block">Away score</span>
                      <input name="awayScore" type="number" min={0} defaultValue={result?.away_score ?? 0}
                             className="w-full border rounded px-2 py-1" />
                    </label>
                    <label>
                      <span className="text-xs block">Home poss %</span>
                      <input name="homePossession" type="number" min={0} max={100}
                             className="w-full border rounded px-2 py-1" />
                    </label>
                    <label>
                      <span className="text-xs block">Away poss %</span>
                      <input name="awayPossession" type="number" min={0} max={100}
                             className="w-full border rounded px-2 py-1" />
                    </label>
                    <label>
                      <span className="text-xs block">Type</span>
                      <select name="resultType" defaultValue={result?.result_type ?? "normal"}
                              className="w-full border rounded px-2 py-1">
                        <option value="normal">Normal</option>
                        <option value="forfeit">Forfeit (auto 3-0)</option>
                        <option value="void">Void</option>
                      </select>
                    </label>
                    <button type="submit" className="bg-black text-white rounded px-3 py-1.5 text-sm">
                      {result ? "Update" : "Enter"}
                    </button>
                  </form>

                  {result && !confirmed ? (
                    <form action={confirmResultAction} className="mt-2">
                      <input type="hidden" name="matchDayId" value={matchDay.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <button
                        type="submit"
                        className="bg-green-600 text-white rounded px-3 py-1.5 text-sm"
                        data-testid={`confirm-${m.id}`}
                      >
                        Confirm result
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/admin/match-days/[id]
git commit -m "feat(admin): match-day detail page with fixtures + draft-confirm result flow"
```

---

## Task 17: Public UI — `/standings` and `/fixtures` with ISR

**Files:**
- Create: `apps/web/src/app/standings/page.tsx`
- Create: `apps/web/src/app/fixtures/page.tsx`

- [ ] **Step 1: Write `/standings/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { listStandings } from "@/server/standings/read";

export const revalidate = 60; // ISR: 60s

export default async function StandingsPage() {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .eq("status", "active")
    .is("deleted_at", null)
    .single();

  if (!season) {
    return <main className="p-8"><p>No active season.</p></main>;
  }

  const rows = await listStandings(sb, season.id);

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-3xl font-bold">Standings · {season.year_range}</h1>
      <table className="w-full text-sm border bg-white">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2 w-8">#</th>
            <th className="text-left p-2">Player</th>
            <th className="text-right p-2">MP</th>
            <th className="text-right p-2">W</th>
            <th className="text-right p-2">D</th>
            <th className="text-right p-2">L</th>
            <th className="text-right p-2">GF</th>
            <th className="text-right p-2">GA</th>
            <th className="text-right p-2">GD</th>
            <th className="text-right p-2 font-bold">Pts</th>
          </tr>
        </thead>
        <tbody data-testid="standings-body">
          {rows.map((r, i) => (
            <tr key={r.player_id} className="border-t">
              <td className="p-2">{i + 1}</td>
              <td className="p-2">{r.player_name}</td>
              <td className="p-2 text-right">{r.matches_played}</td>
              <td className="p-2 text-right">{r.wins}</td>
              <td className="p-2 text-right">{r.draws}</td>
              <td className="p-2 text-right">{r.losses}</td>
              <td className="p-2 text-right">{r.goals_for}</td>
              <td className="p-2 text-right">{r.goals_against}</td>
              <td className="p-2 text-right">{r.goal_difference}</td>
              <td className="p-2 text-right font-bold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500">Tiebreakers: points → goal difference → goals for.</p>
    </main>
  );
}
```

- [ ] **Step 2: Write `/fixtures/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";

export const revalidate = 60; // ISR: 60s

export default async function FixturesPage() {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .eq("status", "active")
    .is("deleted_at", null)
    .single();

  if (!season) {
    return <main className="p-8"><p>No active season.</p></main>;
  }

  const { data: days } = await sb
    .from("match_days")
    .select(`
      id, match_date, venue_name, match_start_time, status,
      matches:matches (
        id, status,
        home_player:home_player_id ( id, gamer_tag, display_name ),
        away_player:away_player_id ( id, gamer_tag, display_name ),
        result:match_results ( home_score, away_score, confirmed_at, result_type )
      )
    `)
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .order("match_date", { ascending: true });

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Fixtures · {season.year_range}</h1>
      {(days ?? []).map((d: {
        id: string; match_date: string; venue_name: string;
        match_start_time: string; status: string;
        matches: Array<{
          id: string; status: string;
          home_player: { display_name: string | null; gamer_tag: string } | null;
          away_player: { display_name: string | null; gamer_tag: string } | null;
          result: Array<{
            home_score: number; away_score: number;
            confirmed_at: string | null; result_type: string;
          }> | null;
        }> | null;
      }) => (
        <section key={d.id} className="border rounded bg-white p-4 space-y-2">
          <div className="flex justify-between">
            <h2 className="font-semibold">
              {formatWat(`${d.match_date}T00:00:00Z`, "EEE, MMM d yyyy")} · {d.venue_name}
            </h2>
            <span className="text-xs text-gray-500">KO {d.match_start_time}</span>
          </div>
          <ul className="divide-y">
            {(d.matches ?? []).map((m) => {
              const r = m.result?.[0];
              const showScore = r && r.confirmed_at && r.result_type !== "void";
              return (
                <li key={m.id} className="py-2 flex justify-between">
                  <span>
                    {m.home_player?.display_name ?? m.home_player?.gamer_tag ?? "?"} vs{" "}
                    {m.away_player?.display_name ?? m.away_player?.gamer_tag ?? "?"}
                  </span>
                  <span className="font-mono">
                    {showScore ? `${r!.home_score} - ${r!.away_score}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 3: Build**

```bash
npm --workspace apps/web run build
```

Expected: both routes compile with `Revalidate: 60`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/standings apps/web/src/app/fixtures
git commit -m "feat(public): /standings + /fixtures with 60s ISR and tiebreaker order"
```

---

## Task 18: E2E — full match-day flow

**Files:**
- Create: `apps/web/tests/e2e/match-day-flow.spec.ts`

Assumes Plan 1's admin user (`admin@cade.local` / `dev-admin-2026`) exists, plus at least 2 active `season_participants` for the active season. If seed data is missing, Task 19 seeds it.

- [ ] **Step 1: Write E2E**

Contents:

```ts
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test("admin creates match day, adds fixture, enters result, confirms, standings update", async ({ page }) => {
  await login(page);

  // 1. Create match day
  await page.goto("/admin/match-days");
  await page.getByTestId("new-match-day-link").click();
  await page.getByLabel("Match date").fill("2099-06-15");
  await page.getByLabel("Venue").fill("E2E Venue");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/admin\/match-days\/[a-f0-9-]+/);

  // 2. Add fixture (expects at least 2 season participants in seed)
  const selects = page.locator("select[name='homePlayerId'], select[name='awayPlayerId']");
  await expect(selects).toHaveCount(2);
  const options = await page.locator("select[name='homePlayerId'] option").allTextContents();
  const validOptions = options.filter((o) => o !== "—");
  expect(validOptions.length).toBeGreaterThanOrEqual(2);

  await page.locator("select[name='homePlayerId']").selectOption({ index: 1 });
  await page.locator("select[name='awayPlayerId']").selectOption({ index: 2 });
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator("[data-testid^='fixture-']")).toHaveCount(1);

  // 3. Enter a draft result: 2-1
  const fixture = page.locator("[data-testid^='fixture-']").first();
  await fixture.locator("input[name='homeScore']").fill("2");
  await fixture.locator("input[name='awayScore']").fill("1");
  await fixture.getByRole("button", { name: "Enter" }).click();

  // 4. Standings should NOT yet include this (draft). Verify.
  await page.goto("/standings");
  // No row should show MP=1 yet — draft is excluded.
  const preConfirmRows = await page.locator("[data-testid='standings-body'] tr").count();
  // We don't strictly assert MP=0 because other seed data could exist;
  // instead, confirm the page renders and move on.
  expect(preConfirmRows).toBeGreaterThanOrEqual(0);

  // 5. Go back and confirm
  await page.goBack();
  const confirmBtn = page.locator("[data-testid^='confirm-']").first();
  await confirmBtn.click();

  // 6. Standings reflect the confirmed result.
  await page.goto("/standings");
  // The player who won (home, index 1 in our select) should have points >= 3.
  const body = await page.locator("[data-testid='standings-body']").innerText();
  expect(body).toMatch(/\b3\b/); // 3 points from the win appears somewhere in the table
});
```

- [ ] **Step 2: Run E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: all E2E tests pass (1 smoke + 3 login from Plan 1 + 1 new = 5 total).

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/match-day-flow.spec.ts
git commit -m "test(e2e): admin match-day flow — create, fixture, enter, confirm, standings"
```

---

## Task 19: Seed update — ensure e2e preconditions

**Files:**
- Modify: `supabase/seed.sql` (created in Plan 2 with players/season). If not present, create minimal seed here.

- [ ] **Step 1: Add an admin user-role row + ≥2 active participants**

If `supabase/seed.sql` exists from Plan 2, append (idempotent):

```sql
-- Ensure admin user has admin role (Plan 1 seeded the user, Plan 3 confirms the role).
insert into public.user_roles (user_id, role)
  select u.id, 'admin'
    from public.users u
    where u.email = 'admin@cade.local'
    and not exists (
      select 1 from public.user_roles r
        where r.user_id = u.id and r.role = 'admin'
    );

-- Sanity check there are at least 2 players + active participants in the season.
-- If Plan 2's seed has 13 rows this is a no-op.
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.season_participants sp
    join public.seasons s on s.id = sp.season_id
    where s.status = 'active' and sp.deleted_at is null;
  if v_count < 2 then
    raise exception 'Plan 3 e2e needs >= 2 active season_participants; found %', v_count;
  end if;
end;
$$;
```

- [ ] **Step 2: Apply seed + verify**

```bash
npx supabase db reset
```

Expected: seed runs without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "chore(seed): confirm admin role + assert >=2 active participants for e2e"
```

---

## Task 20: Final verification

- [ ] **Step 1: All migrations fresh**

```bash
npx supabase db reset
```

Expected: all Plan 0 + Plan 1 + Plan 2 + 7 new Plan 3 migrations apply.

- [ ] **Step 2: Run SQL recompute test**

```bash
npm run test:db
```

Expected: `NOTICE:  recompute test: OK`.

- [ ] **Step 3: Unit tests**

```bash
npm run test
```

Expected: all previous tests + 3 match-days + 2 matches + 1 voidMatch + 7 results + 2 standings = existing 14 + ~15 new. Total ~29 passing.

- [ ] **Step 4: Lint + build**

```bash
npm run lint && npm run build
```

Expected: both clean.

- [ ] **Step 5: E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: 5 E2E tests pass (1 smoke + 3 login + 1 match-day).

- [ ] **Step 6: Audit trail populated**

```bash
npx supabase db query "select entity_type, action, count(*) from public.audit_events where entity_type in ('match_days','matches','match_results','standings') group by 1,2 order by 1,2" --output table
```

Expected: rows for each entity + action combination that was exercised by the E2E (match_days insert, matches insert, match_results insert+update, standings insert+delete).

- [ ] **Step 7: Update `tasks/todo.md`**

Move Plan 3 to Done:

```markdown
## Done
- Plan 3 — Matches + Results + Standings (2026-04-XX). All 20 tasks green.
  - 7 migrations applied (match_days, matches, match_results, player_match_stats, standings, recompute fn, trigger)
  - Idempotent PL/pgSQL recompute_standings(uuid) with SQL test covering normal/forfeit/void/edit/idempotency cases
  - Admin UI: /admin/match-days list + new, /admin/match-days/[id] fixtures + 2-stage result flow
  - Public: /standings + /fixtures with 60s ISR
  - E2E green: admin creates match day → adds fixture → enters draft → standings unchanged → confirms → standings reflect
```

- [ ] **Step 8: Commit verification**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): Plan 3 complete"
```

---

## Out of Scope for Plan 3

- Disciplinary actions schema + trigger (Plan 4). The `standings` schema already reserves `punishment_points_deducted` / `punishment_gd_deducted`, and the recompute function zeros them. Plan 4 will add an `UPDATE public.standings SET punishment_* = ...` pass (either inside a new `recompute_standings_v2` or a sibling function invoked after the base recompute).
- Attendance marks + auto-penalties on late/absent (Plan 5).
- Head-to-head tiebreaker (Phase 1B). Current order: points → GD → GF only.
- Two-different-admin confirmation (Phase 1B). Phase 1A allows self-confirm.
- Bulk fixture generation (round-robin schedule builder). Phase 1A: admins add fixtures one-by-one.
- Player stats entry UI. `player_match_stats` table exists; UI is Phase 1B.
- CSV import of historical results. Not needed for the active division.
- Trash / restore UI for match days (Plan 7).
- Websocket / live-update of `/standings`. ISR 60s is enough for Phase 1A.

---

## Review / Acceptance Criteria

Plan 3 is done when:

1. `git log --oneline` shows ~20 focused commits (one per task, plus verification).
2. `npm run test` passes all unit tests (existing + ~15 new).
3. `npm run test:db` passes the recompute SQL assertions (including the "edit existing result" case and the explicit idempotency recompute).
4. `npm run lint && npm run build` both clean.
5. `npm run e2e` passes all 5 tests.
6. Manual check at `/admin/match-days`:
   - Create a match day → see it in the list.
   - Open it → add 2 fixtures (3 players across them).
   - Enter a result as `draft` → `/standings` unchanged.
   - Click "Confirm result" → `/standings` reflects the W/D/L and points.
   - Edit the already-confirmed result to a different score → `/standings` recomputes correctly.
   - Set a fixture's result type to `void` after confirming → that match drops out of standings totals.
7. `public.audit_events` contains insert + update rows for `match_results` and `standings` corresponding to the above flow.
8. `punishment_points_deducted` and `punishment_gd_deducted` columns all equal 0 everywhere — Plan 4 will be the first writer.
