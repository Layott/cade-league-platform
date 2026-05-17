-- Wave 1A smoke: confirm overlay_template_variants.kind column exists,
-- defaults to 'static', and the CHECK constraint rejects bad values.
--
-- Run after `npm run db:push` via:
--   npx supabase db query --file supabase/tests/overlay_template_variants_kind_smoke.sql
begin;

-- 1. Column exists with correct default + NOT NULL.
do $$
declare
  v_default text;
  v_nullable text;
begin
  select column_default, is_nullable
    into v_default, v_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'overlay_template_variants'
      and column_name = 'kind';

  if v_default is null or v_default not like '%static%' then
    raise exception 'kind column default is %, expected ''static''::text', v_default;
  end if;
  if v_nullable <> 'NO' then
    raise exception 'kind column is nullable; expected NOT NULL';
  end if;
end$$;

-- 2. Every existing row backfilled to 'static'.
do $$
declare
  v_bad_count int;
begin
  select count(*)
    into v_bad_count
    from public.overlay_template_variants
   where kind is null or kind not in ('static','dynamic');

  if v_bad_count > 0 then
    raise exception 'backfill incomplete: % rows with bad kind', v_bad_count;
  end if;
end$$;

-- 3. CHECK constraint rejects junk values.
do $$
begin
  begin
    insert into public.overlay_template_variants
      (overlay_key, variant_id, label, html_path, kind)
    values ('__smoke__','__smoke__','smoke','/dev/null','bogus');
    raise exception 'CHECK constraint did not reject kind=bogus';
  exception when check_violation then
    null;  -- expected
  end;
end$$;

rollback;

select 'overlay_template_variants.kind smoke OK' as status;
