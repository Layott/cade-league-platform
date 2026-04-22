-- Plan 26 — REAL LOC-supplied fixture schedule for Elite 2025-2026.
--
-- Supersedes the synthetic Berger-table seed in
-- `supabase/seed/plan18_fixtures.sql`. The synthetic seed laid out 13 rounds
-- of 6 matches across Saturdays from 2025-11-01; this real schedule is 8
-- match-days (Saturdays + Sundays from 2026-04-26 through 2026-05-30,
-- with one weekend skipped before the finale) totalling 78 fixtures,
-- copy-pasted verbatim from the LOC announcement.
--
-- Key shape changes vs Plan 18:
--   * 8 match-days instead of 13.
--   * Each player still ends the season with 12 matches (round-robin once
--     per pair across the season), but matches are unevenly distributed —
--     some days have 8 fixtures, some 11. The verification block at the
--     bottom of this file raises if total != 78 OR if any player ends with
--     anything other than 12 matches.
--   * Fixtures within a match-day carry an explicit `match_order` (1..N)
--     so the UI can render them in the announced order regardless of
--     `scheduled_time` (which the LOC schedule leaves blank).
--
-- Calendar (verified against the 2026 calendar — every day is a real Sat/Sun):
--   DAY 1  Sun 2026-04-26 (10 matches)
--   DAY 2  Sat 2026-05-02 (11 matches)
--   DAY 3  Sun 2026-05-03  (9 matches)
--   DAY 4  Sat 2026-05-09 (11 matches)
--   DAY 5  Sun 2026-05-10 (10 matches)
--   DAY 6  Sat 2026-05-16 (10 matches)
--   DAY 7  Sun 2026-05-17  (9 matches)
--   DAY 8  Sat 2026-05-30  (8 matches, finale — weekend of 5/23-5/24 skipped)
--
-- This seed is destructive within the active season's match domain:
-- it soft-deletes every existing match_day + match (those rows live on for
-- audit / restore via /admin/trash) before inserting the real schedule.
-- All names resolve via `public.players.gamer_tag` (which is where the tag
-- column actually lives — `public.users` does not have one). The trailing
-- DO block raises if any home/away id came back NULL.
--
-- Prerequisites:
--   * Migration `20260506000001_real_roster_swap.sql` — every gamer_tag
--     below resolves to exactly one `public.players` row.
--   * Migration `20260507000201_matches_match_order.sql` — `match_order`
--     column exists on `public.matches`.
--   * One active Elite 2025-2026 season row.
--
-- Idempotent: re-running this file soft-deletes whatever is there and
-- re-inserts the same 78 fixtures (so it converges, but the audit log
-- accumulates a soft-delete cycle each time — run once after schedule edits,
-- not as part of regular seeding).

do $seed$
declare
  v_season_id uuid;
  v_admin_id  uuid;
begin
  -- Attribution for audit events emitted by this seed.
  select u.id into v_admin_id
    from public.users u
    where u.email = 'admin@cade.local'
      and u.deleted_at is null
    limit 1;
  perform set_config('app.current_user_id', coalesce(v_admin_id::text, ''), true);
  perform set_config('app.current_user_role', 'admin', true);
  perform set_config('app.request_id', 'seed:plan26_real_fixtures', true);

  select s.id into v_season_id
    from public.seasons s
    where s.status = 'active'
      and s.deleted_at is null
    limit 1;
  if v_season_id is null then
    raise exception 'plan26_real_fixtures: no active season found';
  end if;

  -- 1. Soft-delete every existing match + match_day for the active season.
  --    /admin/trash continues to surface them for restore.
  update public.matches
     set deleted_at = now()
   where season_id = v_season_id
     and deleted_at is null;

  update public.match_days
     set deleted_at = now()
   where season_id = v_season_id
     and deleted_at is null;

  -- 2. Insert the 8 real match days. arrival_cutoff 09:00, KO 10:00,
  --    venue "CADE Studio, Lagos", status scheduled. Times stored naive,
  --    interpreted as Africa/Lagos by downstream code.
  insert into public.match_days
    (season_id, match_date, arrival_cutoff_time, match_start_time, venue_name, status)
  values
    (v_season_id, date '2026-04-26', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-05-02', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-05-03', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-05-09', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-05-10', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-05-16', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-05-17', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-05-30', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled');
end
$seed$;

-- 3. Insert the 78 fixtures. One INSERT per fixture; home + away resolved
-- via subquery on public.players.gamer_tag; match_order set explicitly.

-- DAY 1 — Sunday 2026-04-26 (rest: FARUK) — 10 matches
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       9, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       10, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-04-26' and md.deleted_at is null;

-- DAY 2 — Saturday 2026-05-02 (rest: KINGNONEX, TACTICAL) — 11 matches
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       9, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       10, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       11, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-02' and md.deleted_at is null;

-- DAY 3 — Sunday 2026-05-03 (rest: KAYKAY, GURU) — 9 matches
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       9, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-03' and md.deleted_at is null;

-- DAY 4 — Saturday 2026-05-09 (rest: KILLER_FREAK, WOLEVATION) — 11 matches
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       9, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       10, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       11, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-09' and md.deleted_at is null;

-- DAY 5 — Sunday 2026-05-10 (rest: ADEFOLA, ANIFE) — 10 matches
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       9, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       10, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-10' and md.deleted_at is null;

-- DAY 6 — Saturday 2026-05-16 (rest: MR_OGA, BAJI_JNR) — 10 matches
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       9, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       10, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-16' and md.deleted_at is null;

-- DAY 7 — Sunday 2026-05-17 (rest: DADABOI, MITCH) — 9 matches
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       9, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-17' and md.deleted_at is null;

-- DAY 8 — Saturday 2026-05-30 (rest: none) — 8 matches (finale; weekend gap before)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       1, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       2, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       3, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       4, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       5, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       6, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       7, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, match_order, status)
select md.season_id, md.id,
       (select p.id from public.players p where p.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p where p.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       8, 'scheduled'
  from public.match_days md where md.season_id = (select id from public.seasons where status='active' and deleted_at is null limit 1)
                           and md.match_date = date '2026-05-30' and md.deleted_at is null;

-- 4. Verification — raise if any home/away id is NULL (means a gamer_tag
-- failed to resolve), if total is not 78, or if any participant has != 12
-- matches across the active season.
do $verify$
declare
  v_season_id uuid;
  v_total int;
  v_null_count int;
  v_bad_player record;
begin
  select s.id into v_season_id
    from public.seasons s
    where s.status = 'active' and s.deleted_at is null
    limit 1;

  select count(*) into v_null_count
    from public.matches
    where season_id = v_season_id
      and deleted_at is null
      and (home_player_id is null or away_player_id is null);
  if v_null_count > 0 then
    raise exception 'plan26 verify: % fixtures have NULL home/away id', v_null_count;
  end if;

  select count(*) into v_total
    from public.matches
    where season_id = v_season_id
      and deleted_at is null;
  if v_total <> 78 then
    raise exception 'plan26 verify: expected 78 fixtures, got %', v_total;
  end if;

  for v_bad_player in
    select p.gamer_tag, count(*) as n
      from public.players p
      join public.matches m
        on (m.home_player_id = p.id or m.away_player_id = p.id)
       and m.season_id = v_season_id
       and m.deleted_at is null
     where p.deleted_at is null
       and exists (
         select 1 from public.season_participants sp
          where sp.season_id = v_season_id
            and sp.player_id = p.id
            and sp.deleted_at is null
       )
     group by p.gamer_tag
    having count(*) <> 12
  loop
    raise exception 'plan26 verify: player % has % matches (expected 12)',
      v_bad_player.gamer_tag, v_bad_player.n;
  end loop;

  raise notice 'plan26 verify: 78 fixtures across 8 match days, every player on 12.';
end
$verify$;
