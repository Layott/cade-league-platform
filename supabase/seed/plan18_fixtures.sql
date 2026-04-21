-- Plan 18 — 78-match round-robin fixture seed for Elite 2025-2026.
--
-- Generated deterministically by KNOWLEDGE/extracted/_fixture_gen.py using the
-- circle-method (Berger table) over the 13-player roster with a virtual BYE.
-- 13 rounds × 6 matches = 78 = C(13, 2). Each player plays 12 matches and
-- rests exactly once.
--
-- Dates: Saturdays starting 2025-11-01, every 7 days. Venue fixed to
-- "CADE Studio, Lagos". Arrival cutoff 09:00, match start 10:00. All times
-- stored in the match_days TIME columns; downstream code interprets them as
-- Africa/Lagos (WAT) per the Phase 1A timezone non-negotiable.
--
-- Idempotent: match_days are UPSERTed on (season_id, match_date); matches are
-- UPSERTed on (match_day_id, home_player_id, away_player_id) — unique index
-- added in migration 20260506000000_matches_unique_fixture.sql.
--
-- Prerequisites:
--   * The real-roster-swap migration (20260506000001) has run, so every
--     gamer_tag below resolves to exactly one `public.players` row.
--   * The Elite 2025-2026 season exists with status='active'.
--
-- Run ordering inside the DO block: create the 13 match_days first, then the
-- 78 matches. A final verification block re-reads every inserted fixture and
-- raises if any home/away id came back NULL.

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
  perform set_config('app.request_id', 'seed:plan18_fixtures', true);

  select s.id into v_season_id
    from public.seasons s
    where s.status = 'active'
      and s.deleted_at is null
    limit 1;
  if v_season_id is null then
    raise exception 'plan18_fixtures: no active season found';
  end if;

  -- 1. Match days (13 rounds).
  insert into public.match_days
    (season_id, match_date, arrival_cutoff_time, match_start_time, venue_name, status)
  values
    (v_season_id, date '2025-11-01', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-11-08', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-11-15', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-11-22', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-11-29', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-12-06', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-12-13', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-12-20', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2025-12-27', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-01-03', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-01-10', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-01-17', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled'),
    (v_season_id, date '2026-01-24', time '09:00', time '10:00', 'CADE Studio, Lagos', 'scheduled')
  on conflict (season_id, match_date) do nothing;
end
$seed$;

-- 2. Matches — one INSERT per fixture. Each one resolves home + away via
-- subquery on users.gamer_tag; the trailing sanity DO block raises if any
-- players row was missing at insert time.

-- Round 1 — 2025-11-01 (bye: ADEFOLA)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-01'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-01'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-01'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-01'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-01'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-01'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 2 — 2025-11-08 (bye: TACTICAL)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-08'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-08'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-08'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-08'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-08'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-08'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 3 — 2025-11-15 (bye: MITCH)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-15'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-15'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-15'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-15'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-15'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-15'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 4 — 2025-11-22 (bye: KILLER_FREAK)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-22'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-22'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-22'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-22'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-22'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-22'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 5 — 2025-11-29 (bye: GURU)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-29'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-29'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-29'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-29'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-29'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-11-29'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 6 — 2025-12-06 (bye: DADABOI)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-06'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-06'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-06'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-06'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-06'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-06'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 7 — 2025-12-13 (bye: ANIFE)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-13'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-13'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-13'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-13'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-13'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-13'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 8 — 2025-12-20 (bye: WOLEVATION)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-20'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-20'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-20'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-20'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-20'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-20'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 9 — 2025-12-27 (bye: MR_OGA)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-27'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-27'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-27'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-27'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-27'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2025-12-27'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 10 — 2026-01-03 (bye: KINGNONEX)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-03'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-03'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-03'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-03'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-03'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-03'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 11 — 2026-01-10 (bye: KAYKAY)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-10'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-10'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-10'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-10'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-10'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-10'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 12 — 2026-01-17 (bye: FARUK)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'BAJI_JNR'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-17'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-17'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-17'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-17'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-17'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-17'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- Round 13 — 2026-01-24 (bye: BAJI_JNR)
insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ADEFOLA'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'ANIFE'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-24'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'DADABOI'      and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'WOLEVATION'   and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-24'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'FARUK'        and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'TACTICAL'     and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-24'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'GURU'         and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MR_OGA'       and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-24'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KAYKAY'       and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'MITCH'        and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-24'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

insert into public.matches (season_id, match_day_id, home_player_id, away_player_id, status)
select md.season_id, md.id,
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KILLER_FREAK' and p.deleted_at is null),
       (select p.id from public.players p join public.users u on u.id = p.user_id where u.gamer_tag = 'KINGNONEX'    and p.deleted_at is null),
       'scheduled'
  from public.match_days md where md.match_date = date '2026-01-24'
on conflict (match_day_id, home_player_id, away_player_id) do nothing;

-- 3. Verification — every fixture must resolve to non-null player ids and the
-- season must now hold exactly 78 scheduled matches.
do $verify$
declare
  v_null_rows int;
  v_total     int;
begin
  select count(*) into v_null_rows
    from public.matches
    where deleted_at is null
      and (home_player_id is null or away_player_id is null);
  if v_null_rows > 0 then
    raise exception 'plan18_fixtures: % matches have NULL home/away player id', v_null_rows;
  end if;

  select count(*) into v_total
    from public.matches m
    join public.match_days md on md.id = m.match_day_id
    where m.deleted_at is null
      and md.deleted_at is null
      and md.match_date between date '2025-11-01' and date '2026-01-24';
  if v_total <> 78 then
    raise exception 'plan18_fixtures: expected 78 scheduled fixtures, found %', v_total;
  end if;
end
$verify$;
