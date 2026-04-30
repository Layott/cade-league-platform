-- User correction (2026-04-30): season schedule has the LAST weekend
-- on May 23, not May 30. The DB had a stray May-30 match_day entry +
-- was missing the May-23 entry. Move the row by UPDATING match_date
-- in place (preserves the existing match_day_id, fixtures wired to it,
-- attendance, audit trail, etc).
--
-- Idempotent: only UPDATE when a May-30 row exists AND no May-23 row
-- already exists (so re-running this migration after a reseed is safe).

do $$
declare
  v_id uuid;
  v_has_may23 boolean;
begin
  select id into v_id
  from public.match_days
  where match_date = date '2026-05-30'
    and deleted_at is null
  limit 1;

  select exists(
    select 1 from public.match_days
    where match_date = date '2026-05-23'
      and deleted_at is null
  ) into v_has_may23;

  if v_id is not null and not v_has_may23 then
    update public.match_days
    set match_date = date '2026-05-23',
        updated_at = now()
    where id = v_id;
    raise notice 'Moved match_day % from 2026-05-30 to 2026-05-23.', v_id;
  elsif v_id is null then
    raise notice 'No 2026-05-30 match_day to move. Skipping.';
  else
    raise notice '2026-05-23 already exists. Skipping move.';
  end if;
end$$;
