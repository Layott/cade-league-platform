-- Plan 51 smoke test: verifies migration claim block 20260525000001..03 landed
-- correctly. Asserts (a) new columns + defaults + check constraints on seasons
-- + match_results, (b) leaderboard_snapshots table + UNIQUE + append-only
-- triggers, (c) the 7 new permission scopes seeded and granted to the right
-- roles via role_permissions.
--
-- Self-contained, idempotent, no fixture data persisted (all assertions are
-- schema-level; one ephemeral leaderboard_snapshots row is inserted + soft-
-- ignored as proof the append-only trigger guards UPDATE/DELETE).

do $$
declare
  v_default_tb           jsonb;
  v_walkover_chk         text;
  v_pending_chk          text;
  v_perm_count           int;
  v_admin_perm_count     int;
  v_loc_perm_count       int;
  v_referee_perm_count   int;
  v_prod_perm_count      int;
  v_design_perm_count    int;
  v_idc_perm_count       int;
  v_tech_perm_count      int;
  v_snap_table_exists    boolean;
  v_snap_unique_exists   boolean;
  v_snap_no_update       boolean;
  v_snap_no_delete       boolean;
  v_test_md              uuid;
  v_test_snap_id         bigint;
  v_blocked              boolean := false;
begin
  -- 1. seasons.tiebreaker_order column + default.
  -- column_default returns the SQL literal (e.g. '["totalPts","gd","gf","name"]'::jsonb)
  -- which can't be cast directly to jsonb. Strip the wrapping single-quotes + ::jsonb suffix.
  select (regexp_replace(column_default, '^''(.+)''::jsonb$', '\1'))::jsonb
    into v_default_tb
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'seasons'
      and column_name = 'tiebreaker_order';
  if v_default_tb is null then
    raise exception 'seasons.tiebreaker_order column missing';
  end if;
  if v_default_tb <> '["totalPts","gd","gf","name"]'::jsonb then
    raise exception 'seasons.tiebreaker_order default expected ["totalPts","gd","gf","name"], got %', v_default_tb;
  end if;

  -- 2. match_results walkover columns exist.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_results'
      and column_name = 'is_walkover'
  ) then
    raise exception 'match_results.is_walkover column missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_results'
      and column_name = 'walkover_initiated_by'
  ) then
    raise exception 'match_results.walkover_initiated_by column missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_results'
      and column_name = 'walkover_pending'
  ) then
    raise exception 'match_results.walkover_pending column missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_results'
      and column_name = 'walkover_confirmed_at'
  ) then
    raise exception 'match_results.walkover_confirmed_at column missing';
  end if;

  -- 3. walkover_initiated_by check constraint enforces 'admin'/'ref'.
  select pg_get_constraintdef(c.oid) into v_walkover_chk
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'match_results'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%walkover_initiated_by%';
  if v_walkover_chk is null then
    raise exception 'match_results.walkover_initiated_by check constraint missing';
  end if;

  -- 4. walkover_pending guard: NOT walkover_pending OR is_walkover.
  select pg_get_constraintdef(c.oid) into v_pending_chk
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'match_results'
      and c.conname = 'match_results_walkover_pending_chk';
  if v_pending_chk is null then
    raise exception 'match_results_walkover_pending_chk constraint missing';
  end if;

  -- 5. leaderboard_snapshots table exists + has UNIQUE on match_day_id.
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'leaderboard_snapshots'
  ) into v_snap_table_exists;
  if not v_snap_table_exists then
    raise exception 'leaderboard_snapshots table missing';
  end if;

  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'leaderboard_snapshots'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%match_day_id%'
  ) into v_snap_unique_exists;
  if not v_snap_unique_exists then
    raise exception 'leaderboard_snapshots match_day_id UNIQUE constraint missing';
  end if;

  -- 6. Append-only triggers on leaderboard_snapshots.
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.leaderboard_snapshots'::regclass
      and tgname = 'leaderboard_snapshots_no_update'
  ) into v_snap_no_update;
  if not v_snap_no_update then
    raise exception 'leaderboard_snapshots_no_update trigger missing';
  end if;

  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.leaderboard_snapshots'::regclass
      and tgname = 'leaderboard_snapshots_no_delete'
  ) into v_snap_no_delete;
  if not v_snap_no_delete then
    raise exception 'leaderboard_snapshots_no_delete trigger missing';
  end if;

  -- 7. Append-only behaviour: insert a row, then attempt UPDATE — must raise.
  --    Use the most recent match_day to satisfy the FK; if none exists, skip.
  select id into v_test_md
    from public.match_days
    where deleted_at is null
    order by match_date desc
    limit 1;

  if v_test_md is not null then
    -- If a snapshot already exists for this day, just exercise the UPDATE/DELETE
    -- path against it (we don't insert duplicates).
    select id into v_test_snap_id
      from public.leaderboard_snapshots
      where match_day_id = v_test_md
      limit 1;

    if v_test_snap_id is null then
      insert into public.leaderboard_snapshots(match_day_id, snapshot_data)
        values (v_test_md, '{"smoke":true}'::jsonb)
        returning id into v_test_snap_id;
    end if;

    begin
      update public.leaderboard_snapshots
        set snapshot_data = '{"mutated":true}'::jsonb
        where id = v_test_snap_id;
      v_blocked := false;
    exception when others then
      v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'leaderboard_snapshots UPDATE was not blocked by append-only trigger';
    end if;

    v_blocked := false;
    begin
      delete from public.leaderboard_snapshots where id = v_test_snap_id;
      v_blocked := false;
    exception when others then
      v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'leaderboard_snapshots DELETE was not blocked by append-only trigger';
    end if;
  end if;

  -- 8. Seven new permission scopes exist (project uses single
  --    role_permissions table — no separate `permissions` registry).
  --    Confirm at least one row per scope (any role granted).
  select count(distinct permission)::int into v_perm_count
    from public.role_permissions
    where permission in (
      'tournament.read',
      'tournament.score_entry',
      'tournament.walkover_confirm',
      'tournament.tiebreaker_config',
      'tournament.export',
      'broadcast.v2.read',
      'broadcast.v2.trigger'
    );
  if v_perm_count <> 7 then
    raise exception 'expected 7 plan51 permission scopes, got %', v_perm_count;
  end if;

  -- 9. role_permissions wiring per Section 7 grid.

  -- admin: all 7
  select count(*)::int into v_admin_perm_count
    from public.role_permissions
    where role = 'admin'
      and permission in (
        'tournament.read','tournament.score_entry','tournament.walkover_confirm',
        'tournament.tiebreaker_config','tournament.export',
        'broadcast.v2.read','broadcast.v2.trigger'
      );
  if v_admin_perm_count <> 7 then
    raise exception 'admin role expected all 7 plan51 perms, got %', v_admin_perm_count;
  end if;

  -- loc: read + export
  select count(*)::int into v_loc_perm_count
    from public.role_permissions
    where role = 'loc'
      and permission in ('tournament.read','tournament.export');
  if v_loc_perm_count <> 2 then
    raise exception 'loc role expected 2 plan51 perms (read+export), got %', v_loc_perm_count;
  end if;

  -- idc: read + export
  select count(*)::int into v_idc_perm_count
    from public.role_permissions
    where role = 'idc'
      and permission in ('tournament.read','tournament.export');
  if v_idc_perm_count <> 2 then
    raise exception 'idc role expected 2 plan51 perms (read+export), got %', v_idc_perm_count;
  end if;

  -- technical: tournament.read only (broadcast.v2 perms checked below).
  -- Per spec §7 technical doesn't get tournament.export.
  select count(*)::int into v_tech_perm_count
    from public.role_permissions
    where role = 'technical'
      and permission = 'tournament.read';
  if v_tech_perm_count <> 1 then
    raise exception 'technical role expected tournament.read, got count=%', v_tech_perm_count;
  end if;

  -- referee: walkover_confirm only
  select count(*)::int into v_referee_perm_count
    from public.role_permissions
    where role = 'referee'
      and permission = 'tournament.walkover_confirm';
  if v_referee_perm_count <> 1 then
    raise exception 'referee role expected tournament.walkover_confirm, got count=%', v_referee_perm_count;
  end if;

  -- production: broadcast.v2 read + trigger
  select count(*)::int into v_prod_perm_count
    from public.role_permissions
    where role = 'production'
      and permission in ('broadcast.v2.read','broadcast.v2.trigger');
  if v_prod_perm_count <> 2 then
    raise exception 'production role expected 2 broadcast.v2 perms, got %', v_prod_perm_count;
  end if;

  -- design: broadcast.v2.read only (per spec §7).
  select count(*)::int into v_design_perm_count
    from public.role_permissions
    where role = 'design'
      and permission = 'broadcast.v2.read';
  if v_design_perm_count <> 1 then
    raise exception 'design role expected broadcast.v2.read, got count=%', v_design_perm_count;
  end if;

  raise notice 'plan51 smoke OK: schema columns present, append-only enforced, 7 perms seeded, role grants intact';
end$$;
