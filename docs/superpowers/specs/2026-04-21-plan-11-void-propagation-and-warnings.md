# Plan 11 — Phase 1B Part C: Void-match propagation + full late-arrival warnings ladder (Rule 5.4) + DisciplinaryPrecedent

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Supersedes:** flat ladder in `apps/web/src/server/attendance/penalty.ts` (Plan 5), void column in `match_results` (Plan 3 unused)
**Phase:** 1B, Part C (follows Plan 9/10; precedes Plan 12 appeals workflow)

---

## 1. Goals

1. Track per-player per-category offense counts in a first-class `disciplinary_precedents` table so Rule 5.4 progression is queryable and auditable, not reconstructed ad-hoc from attendance rows.
2. Replace the flat Phase 1A late/absent ladder (`-1 / -3`) with the full Rule 5.4 scaled ladder, including warning-case vs disciplinary-case distinction.
3. Implement Rule 3.4.4.2 void-match propagation: when a suspension is issued with `effective_from`/`effective_until`, every scheduled match for that player in that window is auto-voided, and standings recompute excludes `result_type = 'void'`.
4. Backfill precedents from the existing `attendance_marks` + `disciplinary_actions` history so the 13-player Elite roster starts Plan 11 with correct counts.
5. Admin UX: per-player precedents page, and suspension form preview of affected matches.

### 1.1 Success criteria

1. **Suspension voids the right matches.** Issuing a `sanction_type = 'ban'` (suspension) for player P over two match days (`effective_from` = MD4 date, `effective_until` = MD5 date) creates `match_results` rows with `result_type = 'void'` for exactly P's MD4 + MD5 fixtures — no others. P's `matches_played` stays flat across those days; opponents' `matches_played` also stays flat. Standings GD for P and each affected opponent does not change across the void window.
2. **Un-suspension restores.** Revoking the disciplinary_action (`revoked_at IS NOT NULL`) removes the void rows and a full recompute restores the original GD/points.
3. **Ladder progression.** First `late` → `-1 point`, no case row. Second `late` → `-3 points` + warning case. Third `late` → `-5 points` + disciplinary case. First `absent` → `-3 points` + disciplinary case + auto-forfeit. Second `absent` → `-5 points` + 1-match-day suspension + new disciplinary case. Each transition is driven solely by the `disciplinary_precedents.offense_count` prior to the current mark.
4. **Idempotent.** Every void/un-void change triggers `recompute_standings(season_id)` from scratch — no incremental patching.
5. **Backfill correctness.** After the backfill migration, `select * from disciplinary_precedents` returns one row per (player, category) observed in history, with `offense_count` equal to the count of non-revoked auto-actions in that category for that player.

### 1.2 Out of scope

- **Appeals that overturn voids.** Un-voiding through an appeal workflow is Plan 12 / Phase 2. Plan 11 only reacts to the imposing/revoking admin action.
- **Suspensions spanning multiple seasons.** Window evaluated against active season only.
- **Precedent decay.** Plan 11 persists them forever; a future plan may add `season_id` scope or decay job.
- **UI for editing a precedent count.** Scoped to simple ±1 nudge with mandatory reason; full precedent-editor CRUD deferred.
- **Non-attendance categories** — table supports them, but only `late_arrival` and `absent` get automatic trigger upserts in Plan 11.

---

## 2. Rule 5.4 ladder — authoritative values (to be verified against `KNOWLEDGE/`)

The ladder below is the **proposed** transcription. The concrete numeric values MUST be confirmed against `KNOWLEDGE/CADE_Elite_League_Rulebook_v1_7.docx` §5.4 and `KNOWLEDGE/RULE BOOK VER 7.0 - ESOCCER LEAGUE DIV 2 (2).pdf` §5.4 before merging. If rulebook values differ, update spec and open follow-up task — **do not silently rewrite code to match guesses**. See §10 Risks.

### 2.1 Late arrival (category = `late_arrival`)

| Offense count (after this mark) | Point deduction | Case created | Suspension |
|---|---|---|---|
| 1 | -1 | none | none |
| 2 | -3 | warning (`disciplinary_cases.status = 'open'`, ladder notes "warning") | none |
| 3 | -5 | disciplinary case | none |
| 4+ | -5 | disciplinary case | 1 match day |

### 2.2 Absence (category = `absent`)

| Offense count (after this mark) | Point deduction | Case created | Suspension | Auto-forfeit |
|---|---|---|---|---|
| 1 | -3 | disciplinary case | none | yes, if a fixture was scheduled for that match day |
| 2 | -5 | disciplinary case | 1 match day | yes |
| 3+ | rulebook TBD | disciplinary case | per rulebook | yes |

### 2.3 Quoting rule

Each row in `LADDER.ts` must carry an inline comment quoting the rulebook clause verbatim (`// Rule 5.4.2 "A player late for the third time..."`). Reviewers should reject any ladder entry without a quote.

---

## 3. Data model

### 3.1 New table: `disciplinary_precedents`

```sql
-- supabase/migrations/20260502000001_disciplinary_precedents.sql
create table public.disciplinary_precedents (
  id                uuid        not null default gen_random_uuid(),
  player_id         uuid        not null references public.players (id) on delete restrict,
  category          text        not null check (category in (
    'late_arrival','absent','unauthorized_access','equipment',
    'social_media','betting','match_fixing','other'
  )),
  offense_count     int         not null default 0 check (offense_count >= 0),
  last_offense_at   timestamptz,
  last_case_id      uuid        references public.disciplinary_cases (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  primary key (player_id, category)
);

create index disciplinary_precedents_id_idx
  on public.disciplinary_precedents (id);

create index disciplinary_precedents_active_idx
  on public.disciplinary_precedents (player_id, category)
  where deleted_at is null;

select public.attach_audit('public.disciplinary_precedents');
```

Notes:
- Composite PK `(player_id, category)` guarantees one row per combination; `id` kept as secondary uuid for audit FK convenience.

### 3.2 Extend `disciplinary_cases.incident_type`

```sql
-- supabase/migrations/20260502000002_extend_incident_types.sql
alter table public.disciplinary_cases
  drop constraint disciplinary_cases_incident_type_check;
alter table public.disciplinary_cases
  add constraint disciplinary_cases_incident_type_check
    check (incident_type in (
      'late_arrival','absent','forfeit','equipment','social_media',
      'unauthorized_access','betting','match_fixing','other'
    ));
```

### 3.3 Upsert trigger — attendance_marks + disciplinary_cases

```sql
-- supabase/migrations/20260502000003_precedent_upsert_trigger.sql
create or replace function public.upsert_precedent(
  p_player_id uuid,
  p_category  text,
  p_case_id   uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.disciplinary_precedents (player_id, category, offense_count, last_offense_at, last_case_id)
  values (p_player_id, p_category, 1, now(), p_case_id)
  on conflict (player_id, category) do update
    set offense_count   = disciplinary_precedents.offense_count + 1,
        last_offense_at = now(),
        last_case_id    = excluded.last_case_id,
        updated_at      = now()
  where disciplinary_precedents.deleted_at is null;
end;
$$;

create or replace function public.on_attendance_mark_precedent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_category text;
begin
  if tg_op = 'INSERT' then
    if new.status in ('late','absent') and new.deleted_at is null then
      v_category := case new.status when 'late' then 'late_arrival' else 'absent' end;
      perform public.upsert_precedent(new.player_id, v_category, new.auto_case_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_marks_precedent on public.attendance_marks;
create trigger attendance_marks_precedent
  after insert on public.attendance_marks
  for each row execute function public.on_attendance_mark_precedent();

create or replace function public.on_disciplinary_case_precedent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     and new.deleted_at is null
     and new.incident_type in ('unauthorized_access','equipment','social_media','betting','match_fixing','other','forfeit')
  then
    perform public.upsert_precedent(new.player_id, new.incident_type, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists disciplinary_cases_precedent on public.disciplinary_cases;
create trigger disciplinary_cases_precedent
  after insert on public.disciplinary_cases
  for each row execute function public.on_disciplinary_case_precedent();
```

Attendance marks are the source of truth for `late_arrival`/`absent`; cases for non-attendance categories.

### 3.4 `disciplinary_actions.sanction_type` — reuse `'ban'`

Existing `'ban'` with `effective_from`/`effective_until` — Plan 11 introduces semantic: `sanction_type = 'ban'` with both dates set ≥ today → propagate voids. No schema change required.

### 3.5 `match_results.result_type = 'void'`

Already exists. Current `recompute_standings` filters `mr.result_type in ('normal','forfeit')`, so voids are excluded. Plan 11 adds regression test (§7.1) verifying `result_type = 'void'` doesn't contribute to matches_played/GD/points.

---

## 4. Void propagation — SQL + Postgres functions

### 4.1 Helper: `propagate_suspension_voids(p_action_id uuid)`

```sql
-- supabase/migrations/20260502000004_propagate_suspension_voids.sql
create or replace function public.propagate_suspension_voids(p_action_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player_id       uuid;
  v_effective_from  date;
  v_effective_until date;
  v_actor_user_id   uuid;
  v_season_id       uuid;
  v_void_count      int := 0;
  r                 record;
begin
  select c.player_id,
         a.effective_from,
         a.effective_until,
         a.imposed_by
    into v_player_id, v_effective_from, v_effective_until, v_actor_user_id
    from public.disciplinary_actions a
    join public.disciplinary_cases   c on c.id = a.case_id
    where a.id = p_action_id
      and a.deleted_at is null
      and a.revoked_at is null
      and a.sanction_type = 'ban';

  if v_player_id is null then
    return 0;
  end if;

  if v_effective_from is null or v_effective_until is null then
    raise exception 'propagate_suspension_voids: action % missing effective_from/until', p_action_id;
  end if;

  for r in
    select m.id            as match_id,
           m.season_id,
           m.home_player_id,
           m.away_player_id
      from public.matches m
      join public.match_days md on md.id = m.match_day_id
     where m.deleted_at is null
       and md.deleted_at is null
       and (m.home_player_id = v_player_id or m.away_player_id = v_player_id)
       and md.match_date between v_effective_from and v_effective_until
  loop
    insert into public.match_results (
      match_id, home_score, away_score, result_type,
      entered_by, confirmed_by, confirmed_at, notes
    )
    values (
      r.match_id, 0, 0, 'void',
      v_actor_user_id, v_actor_user_id, now(),
      format('auto-voided: suspension action %s', p_action_id)
    )
    on conflict (match_id) do update
      set result_type  = 'void',
          home_score   = 0,
          away_score   = 0,
          confirmed_by = excluded.confirmed_by,
          confirmed_at = excluded.confirmed_at,
          notes        = excluded.notes,
          updated_at   = now();

    update public.matches
       set status = 'voided'
     where id = r.match_id;

    v_season_id := r.season_id;
    v_void_count := v_void_count + 1;
  end loop;

  if v_season_id is not null then
    perform public.recompute_standings(v_season_id);
  end if;

  return v_void_count;
end;
$$;

create or replace function public.unpropagate_suspension_voids(p_action_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_season_id uuid; v_count int;
begin
  with deleted as (
    delete from public.match_results
    where result_type = 'void'
      and notes = format('auto-voided: suspension action %s', p_action_id)
    returning match_id
  ),
  updated_matches as (
    update public.matches m
       set status = 'scheduled'
      from deleted d
     where m.id = d.match_id
    returning m.season_id
  )
  select count(*), max(season_id) into v_count, v_season_id from updated_matches;

  if v_season_id is not null then
    perform public.recompute_standings(v_season_id);
  end if;
  return v_count;
end;
$$;
```

### 4.2 Trigger wiring

```sql
-- supabase/migrations/20260502000005_ban_propagation_trigger.sql
create or replace function public.on_ban_action_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.sanction_type = 'ban'
       and new.deleted_at is null and new.revoked_at is null then
    perform public.propagate_suspension_voids(new.id);
  elsif tg_op = 'UPDATE' then
    if old.revoked_at is null and new.revoked_at is not null and new.sanction_type = 'ban' then
      perform public.unpropagate_suspension_voids(new.id);
    elsif old.deleted_at is null and new.deleted_at is not null and new.sanction_type = 'ban' then
      perform public.unpropagate_suspension_voids(new.id);
    elsif new.sanction_type = 'ban'
       and (new.effective_from <> old.effective_from or coalesce(new.effective_until,'0001-01-01') <> coalesce(old.effective_until,'0001-01-01')) then
      perform public.unpropagate_suspension_voids(new.id);
      perform public.propagate_suspension_voids(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists disciplinary_actions_ban_propagation on public.disciplinary_actions;
create trigger disciplinary_actions_ban_propagation
  after insert or update on public.disciplinary_actions
  for each row execute function public.on_ban_action_change();
```

### 4.3 Recompute filter — verify existing

`20260424000003_recompute_with_punishments.sql` already filters `mr.result_type in ('normal','forfeit')`. Plan 11 adds regression test. If audit test fails, write superseding migration that is explicit about the filter.

---

## 5. Server modules

### 5.1 `apps/web/src/server/precedents/` (new)

Files:
- `index.ts` — exports.
- `read.ts` — `getPrecedents(sb, playerId)` returns array of `(category, offense_count, last_offense_at, last_case_id)`.
- `adjust.ts` — `adjustPrecedent(sb, actorUserId, { playerId, category, delta, reason })`. Delta ∈ {-1, +1}. Writes directly; audit trigger captures before/after. Reason required, min 6 chars.
- `adjust.test.ts`.
- `ladder.ts` — pure functions:
  - `computeLateSanction(priorCount: number): LadderOutcome`
  - `computeAbsentSanction(priorCount: number): LadderOutcome`
  - `type LadderOutcome = { pointDeduction: number; createCase: 'none'|'warning'|'disciplinary'; suspensionMatchDays: number; autoForfeit: boolean; rulebookClause: string }`
- `ladder.test.ts` — exhaustive table-driven tests.

### 5.2 Rewrite `apps/web/src/server/attendance/penalty.ts`

Replace `flatLadder` with ladder consultation. New flow in `openAutoCase`:

1. Read current precedent count for `(player_id, category)`. If no row, count = 0.
2. Call `computeLateSanction(count)` / `computeAbsentSanction(count)` to get `LadderOutcome`.
3. If `createCase !== 'none'`, insert `disciplinary_cases` row (incident_type matches category, notes include rulebook clause + `"offense #N"`).
4. If `pointDeduction > 0`, insert `disciplinary_actions` with `sanction_type = 'point_deduction'`, `magnitude = pointDeduction`. For offense #1 (no case created), action has no linked case — see §5.4 migration.
5. If `suspensionMatchDays > 0`, compute `effective_from`/`effective_until` via `resolveSuspensionWindow` (§5.3). Insert second `disciplinary_actions` row with `sanction_type = 'ban'`; ban trigger propagates voids.
6. If `autoForfeit` and player has scheduled match this match day, reuse `punishments.ts applyForfeitMatchResult`.
7. Return IDs so `attendance/mark.ts` persists `auto_case_id` / `auto_action_id`. Store primary action (point_deduction) as the "dominant" action.

Precedent upsert is driven entirely by Postgres trigger (§3.3) — TS layer does NOT write `disciplinary_precedents` directly for attendance paths.

### 5.3 Ladder window resolver

`apps/web/src/server/precedents/window.ts`:
- `resolveSuspensionWindow(sb, seasonId, startFromDate, matchDays)` → `{ from, until }`.
- Queries `match_days` for `matchDays` next scheduled dates ≥ `startFromDate`.
- Falls back to `startFromDate` + 6 days if no match_days rows.

### 5.4 `disciplinary_actions.case_id` constraint

Currently `NOT NULL`. Plan 11 requires 1st-late action to have no case. **Decision: Option B** — create lightweight case row for every auto-ladder event; distinction is the `disciplinary_cases.status` value (`'auto'` for 1st-late, `'open'` for warning tier, `'open'` for disciplinary tier, resolved by admin later).

```sql
-- supabase/migrations/20260502000006_case_status_auto.sql
alter table public.disciplinary_cases
  drop constraint disciplinary_cases_status_check;
alter table public.disciplinary_cases
  add constraint disciplinary_cases_status_check
    check (status in ('auto','open','resolved'));
```

Admin cases list gets filter to hide `status = 'auto'` by default.

### 5.5 `apps/web/src/server/punishments/index.ts`

- Extend `issueSchema` to allow `sanctionType = 'ban'` with `effectiveFrom` + `effectiveUntil` as required fields.
- After inserting ban action, DB trigger handles propagation; server surfaces resulting void count. Add `previewSuspensionVoids(sb, playerId, effectiveFrom, effectiveUntil)` returning matches that _would_ be voided (read-only for admin form preview). Put in new `preview.ts` module.
- Extend `incidentType` enum to match §3.2.

---

## 6. UI

### 6.1 `/admin/precedents/[playerId]` (new)

- Server Component calling `getPrecedents(sb, playerId)` + `listPrecedentAuditEvents(sb, playerId)`.
- Table: one row per category with `offense_count`, `last_offense_at`, link to `last_case_id`.
- Adjust button per row opens inline form posting to `adjustPrecedentAction(formData)` with mandatory reason textarea.
- Link entry added to `/admin/players/[id]` → "View precedents".

### 6.2 `/admin/punishments/new` update

- Add `sanctionType` option `"ban"` → "Suspension".
- When `sanctionType === 'ban'` reveal two date inputs (`effective_from`, `effective_until`) marked required.
- Live preview panel (Client Component): on blur of date inputs, POST to `/api/admin/punishments/preview-voids` which calls `previewSuspensionVoids`. Render "This will void N scheduled matches: [...]". Debounced (300ms).
- Form submit unchanged — trigger does propagation.

### 6.3 `/admin/punishments/[id]` detail

- If action is `sanction_type = 'ban'`, show list of voided matches (query `match_results where notes = format('auto-voided: suspension action %s', id)`).
- Show "Revoke suspension" button; UI hint that revoke will un-void.

---

## 7. Testing

### 7.1 Unit tests (≥15 new)

Located beside modules; mocks Supabase.

**`precedents/ladder.test.ts` (8 tests)**
1. `computeLateSanction(0)` → `-1 / none / 0 / false`.
2. `computeLateSanction(1)` → `-3 / warning / 0 / false`.
3. `computeLateSanction(2)` → `-5 / disciplinary / 0 / false`.
4. `computeLateSanction(3)` → `-5 / disciplinary / 1 / false`.
5. `computeAbsentSanction(0)` → `-3 / disciplinary / 0 / true`.
6. `computeAbsentSanction(1)` → `-5 / disciplinary / 1 / true`.
7. Every outcome carries non-empty `rulebookClause`.
8. Late ladder at `priorCount >= 10` does not crash (returns last tier).

**`precedents/adjust.test.ts` (3 tests)**
9. `adjustPrecedent` with delta=+1 issues update with `offense_count + 1`.
10. `adjustPrecedent` with reason shorter than 6 chars throws.
11. `adjustPrecedent` when row missing inserts new row with `offense_count=1` (delta=+1) and refuses delta=-1.

**`attendance/penalty.test.ts` (4 new)**
12. Late mark with precedent count 0 creates 1 auto case + 1 point_deduction action, magnitude 1.
13. Late mark with precedent count 1 creates 1 warning case + 1 point_deduction action, magnitude 3.
14. Absent mark with precedent count 0 creates 1 disciplinary case + 1 point_deduction action + applies forfeit.
15. Absent mark with precedent count 1 creates point_deduction AND ban action with effective dates resolved from match_days.

Existing `flatLadder` tests deleted; commit message lists deleted test names.

**`punishments/preview.test.ts` (2 tests)**
16. `previewSuspensionVoids` returns matches whose match_day.match_date falls in window.
17. Returns empty array when no fixtures in window.

### 7.2 SQL smoke tests

Add `supabase/tests/void_propagation_smoke.sql` executed by new `npm run void:smoke`:
- Seed fixture, insert ban action, assert `match_results` row with `result_type='void'` exists and standings GD unchanged.
- Revoke action, assert void rows removed.

### 7.3 E2E (2 new)

**`late-ladder-progression.spec.ts`**
- Admin logs in, marks throwaway player P late on MD1, MD2, MD3.
- After each mark, navigates to `/admin/precedents/<playerId>` and asserts offense_count 1→2→3.
- After MD3, asserts `/admin/punishments` shows disciplinary-tier case.
- Asserts public `/punishments` shows -5 point deduction on MD3.

**`suspend-and-void.spec.ts`**
- Creates throwaway player Q with two scheduled matches across MD4/MD5.
- Issues suspension via `/admin/punishments/new` covering MD4+MD5.
- Asserts preview panel showed "This will void 2 scheduled matches".
- After submit, asserts Q's match status is `voided`.
- Opens `/standings`, captures Q's GD+points; asserts matches pre-suspension snapshot.
- Revokes ban, re-asserts match status is `scheduled` and standings unchanged.

### 7.4 Regression pass

- `npm run test`, `npm run lint`, `npm run build`, `npm --workspace apps/web run e2e`.
- `npm run audit:smoke` + new `npm run void:smoke`.

---

## 8. Backfill migration

```sql
-- supabase/migrations/20260502000007_backfill_precedents.sql
-- Runs once; idempotent via ON CONFLICT (player_id, category).
insert into public.disciplinary_precedents (player_id, category, offense_count, last_offense_at, last_case_id)
select
  am.player_id,
  case am.status when 'late' then 'late_arrival' else 'absent' end as category,
  count(*) as offense_count,
  max(am.marked_at) as last_offense_at,
  (array_agg(am.auto_case_id order by am.marked_at desc))[1] as last_case_id
from public.attendance_marks am
where am.deleted_at is null
  and am.status in ('late','absent')
group by am.player_id, am.status
on conflict (player_id, category) do update
  set offense_count   = excluded.offense_count,
      last_offense_at = excluded.last_offense_at,
      last_case_id    = excluded.last_case_id,
      updated_at      = now();

insert into public.disciplinary_precedents (player_id, category, offense_count, last_offense_at, last_case_id)
select
  c.player_id,
  c.incident_type as category,
  count(*),
  max(c.opened_at),
  (array_agg(c.id order by c.opened_at desc))[1]
from public.disciplinary_cases c
where c.deleted_at is null
  and c.incident_type in ('unauthorized_access','equipment','social_media','betting','match_fixing','other','forfeit')
group by c.player_id, c.incident_type
on conflict (player_id, category) do update
  set offense_count   = excluded.offense_count,
      last_offense_at = excluded.last_offense_at,
      last_case_id    = excluded.last_case_id,
      updated_at      = now();
```

---

## 9. Numbered tasks

1. Draft `LADDER.ts` with rulebook quotes. Send to user for verification BEFORE task 3.
2. Migration `20260502000001_disciplinary_precedents.sql` + attach audit.
3. Migration `20260502000002_extend_incident_types.sql` + `20260502000006_case_status_auto.sql`.
4. Migration `20260502000003_precedent_upsert_trigger.sql` + trigger smoke test.
5. Migration `20260502000004_propagate_suspension_voids.sql`.
6. Migration `20260502000005_ban_propagation_trigger.sql`.
7. Create `server/precedents/ladder.ts` + `ladder.test.ts`.
8. Create `server/precedents/read.ts` + `adjust.ts` + `adjust.test.ts`.
9. Create `server/precedents/window.ts`.
10. Rewrite `server/attendance/penalty.ts` to consult ladder. Delete flat-ladder tests; add new tests §7.1.
11. Extend `server/punishments/index.ts` with ban fields + `server/punishments/preview.ts`.
12. Add `/api/admin/punishments/preview-voids` route handler.
13. Build `/admin/precedents/[playerId]` page + server action.
14. Link precedents page from `/admin/players/[id]`.
15. Update `/admin/punishments/new` form with suspension fields + live preview.
16. Update `/admin/punishments/[id]` detail with voided-matches list.
17. Backfill migration `20260502000007_backfill_precedents.sql`.
18. SQL smoke script `supabase/tests/void_propagation_smoke.sql` + `npm run void:smoke`.
19. E2E `late-ladder-progression.spec.ts` + `suspend-and-void.spec.ts`.
20. Full verification pass (lint/test/build/e2e/audit:smoke/void:smoke).
21. Manual walkthrough of §1.1 scenarios 1-5; captured in todo.md review.
22. Commit in reviewable slices (migrations; SQL triggers; server modules; UI; tests).

---

## 10. Acceptance criteria

- All five success-criteria scenarios in §1.1 demonstrated.
- All ≥15 unit tests + both E2E specs green.
- `supabase db query` confirms `disciplinary_precedents` row count > 0 post-backfill.
- `recompute_standings` invocation count per ban-insert = 1 (measured via `pg_stat_statements`; acceptable drift up to 2).
- No existing Plan 1-10 test regresses.
- Admin can issue 2-match-day suspension end-to-end in under 90 seconds via UI.

---

## 11. Risks

1. **Rulebook ladder values must be verified by user.** §2 values are proposed. If v1.7 Elite differs from v7.0 Div 2, Elite wins. Block task 7 on confirmation.
2. **Suspension window vs match-day dates.** Use `date` type, not `timestamptz`. DB timezone = Africa/Lagos.
3. **Un-void edge case.** If admin revokes suspension AFTER results were manually entered for voided match, `unpropagate_suspension_voids` deletes only rows with exact `notes` marker. Manually re-entered results survive. Test case covers.
4. **Multi-action per mark.** `attendance_marks.auto_action_id` scalar; if mark produces point_deduction + ban, store point_deduction id. Ban discoverable via `disciplinary_cases.player_id + opened_at`.
5. **Case status extension** changes existing data's check constraint. Verify no existing rows violate the new constraint.
6. **Precedent auto-upsert via trigger, not application code.** Seed scripts must be audited; Plan 11 backfill re-computes from source data.
7. **Idempotent trigger cascade.** `propagate_suspension_voids` writes `match_results` rows which fire existing `match_results_recompute` trigger. Acceptable — still idempotent.

---

## 12. Files touched (index)

- `supabase/migrations/20260502000001_disciplinary_precedents.sql` (new)
- `supabase/migrations/20260502000002_extend_incident_types.sql` (new)
- `supabase/migrations/20260502000003_precedent_upsert_trigger.sql` (new)
- `supabase/migrations/20260502000004_propagate_suspension_voids.sql` (new)
- `supabase/migrations/20260502000005_ban_propagation_trigger.sql` (new)
- `supabase/migrations/20260502000006_case_status_auto.sql` (new)
- `supabase/migrations/20260502000007_backfill_precedents.sql` (new)
- `supabase/tests/void_propagation_smoke.sql` (new)
- `apps/web/src/server/precedents/` (new module)
- `apps/web/src/server/attendance/penalty.ts` (rewritten)
- `apps/web/src/server/attendance/penalty.test.ts` (rewritten)
- `apps/web/src/server/punishments/index.ts` (extended)
- `apps/web/src/server/punishments/preview.ts` (new)
- `apps/web/src/app/admin/precedents/[playerId]/page.tsx` (new)
- `apps/web/src/app/admin/punishments/new/page.tsx` (extended)
- `apps/web/src/app/admin/punishments/new/actions.ts` (extended)
- `apps/web/tests/e2e/late-ladder-progression.spec.ts` (new)
- `apps/web/tests/e2e/suspend-and-void.spec.ts` (new)
