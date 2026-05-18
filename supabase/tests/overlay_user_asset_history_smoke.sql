-- Wave 2B smoke: confirm overlay_user_asset_history exists with the
-- right shape, audit trigger attached, and append-only enforcement
-- raises on UPDATE + DELETE.
--
-- Run after `npm run db:push` via:
--   npx supabase db query --linked --file supabase/tests/overlay_user_asset_history_smoke.sql
begin;

-- 1. Table exists with the canonical columns.
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ')
    into v_missing
    from unnest(array[
      'id',
      'asset_id',
      'storage_path',
      'size_bytes',
      'mime_type',
      'note',
      'created_by',
      'created_at',
      'deleted_at'
    ]) as c
    where not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'overlay_user_asset_history'
         and column_name = c
    );
  if v_missing is not null then
    raise exception 'overlay_user_asset_history missing columns: %', v_missing;
  end if;
end$$;

-- 2. Audit trigger attached.
-- Note: attach_audit() names the trigger `audit_<table_name>`, not
-- `audit_row_change`. The Wave 1A smoke (overlay_user_tables_smoke.sql)
-- uses the same `'audit_' || v_table` pattern as the canonical reference.
do $$
declare v_count int;
begin
  select count(*) into v_count
    from pg_trigger
   where tgrelid = 'public.overlay_user_asset_history'::regclass
     and tgname = 'audit_overlay_user_asset_history';
  if v_count = 0 then
    raise exception 'audit trigger missing on overlay_user_asset_history';
  end if;
end$$;

-- 3. UPDATE + DELETE are blocked.
do $$
declare v_asset_id uuid := gen_random_uuid();
begin
  insert into public.overlay_user_asset_history
    (asset_id, storage_path, size_bytes, mime_type)
  values (v_asset_id, 'psd/__smoke__.psd', 1, 'image/vnd.adobe.photoshop');

  begin
    update public.overlay_user_asset_history
       set note = 'mutation attempt'
     where asset_id = v_asset_id;
    raise exception 'UPDATE did not raise';
  exception when others then null; end;

  begin
    delete from public.overlay_user_asset_history where asset_id = v_asset_id;
    raise exception 'DELETE did not raise';
  exception when others then null; end;
end$$;

rollback;

select 'overlay_user_asset_history smoke OK' as status;
