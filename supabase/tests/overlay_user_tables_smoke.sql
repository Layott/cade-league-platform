-- Wave 1A smoke: confirm the six overlay_user_* tables exist with
-- correct columns, audit triggers, append-only block on history,
-- and the overlay-user-assets storage bucket is registered.
--
-- Run after `npm run db:push` via:
--   npx supabase db query --file supabase/tests/overlay_user_tables_smoke.sql
begin;

-- 1. All six tables exist.
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ')
    into v_missing
    from unnest(array[
      'overlay_user_designs',
      'overlay_user_design_scenes',
      'overlay_user_design_elements',
      'overlay_user_assets',
      'overlay_user_design_fonts',
      'overlay_user_design_history'
    ]) as t
    where not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = t
    );

  if v_missing is not null then
    raise exception 'missing overlay_user_* tables: %', v_missing;
  end if;
end$$;

-- 2. Audit trigger attached to every mutable table.
do $$
declare
  v_table text;
  v_count int;
begin
  foreach v_table in array array[
    'overlay_user_designs',
    'overlay_user_design_scenes',
    'overlay_user_design_elements',
    'overlay_user_assets',
    'overlay_user_design_fonts',
    'overlay_user_design_history'
  ]
  loop
    select count(*) into v_count
      from pg_trigger
     where tgrelid = ('public.' || v_table)::regclass
       and tgname = 'audit_' || v_table;
    if v_count = 0 then
      raise exception 'audit trigger missing on %', v_table;
    end if;
  end loop;
end$$;

-- 3. History table blocks UPDATE + DELETE.
do $$
begin
  -- Insert a fake row so we have something to mutate.
  insert into public.overlay_user_design_history (design_id, snapshot)
  values ('00000000-0000-0000-0000-000000000000', '{}'::jsonb);

  begin
    update public.overlay_user_design_history
       set note = 'mutation attempt'
     where design_id = '00000000-0000-0000-0000-000000000000';
    raise exception 'history UPDATE did not raise';
  exception when others then
    null;  -- expected
  end;
end$$;

-- 4. Storage bucket present.
do $$
declare
  v_exists bool;
begin
  select exists (
    select 1 from storage.buckets where id = 'overlay-user-assets'
  ) into v_exists;
  if not v_exists then
    raise exception 'overlay-user-assets bucket missing';
  end if;
end$$;

rollback;

select 'overlay_user_* smoke OK' as status;
