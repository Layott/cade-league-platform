-- Plan 53 — Player photo overrides (Task 1, migration 4/4).
--
-- `player-photos` storage bucket — public-read so admin-uploaded
-- player photos can be served straight from CDN without a signed-URL
-- roundtrip on every overlay render. Service-role writes only (the
-- admin PUT uses a signed upload URL generated server-side, mirroring
-- Plan 48 `overlay-assets` pattern).
--
-- Idempotent — bucket insert + every policy guarded with EXISTS
-- checks against `pg_policies` so re-running is a no-op.

insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'player_photos_public_read'
  ) then
    create policy player_photos_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'player-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'player_photos_service_insert'
  ) then
    create policy player_photos_service_insert
      on storage.objects
      for insert
      to service_role
      with check (bucket_id = 'player-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'player_photos_service_update'
  ) then
    create policy player_photos_service_update
      on storage.objects
      for update
      to service_role
      using (bucket_id = 'player-photos')
      with check (bucket_id = 'player-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'player_photos_service_delete'
  ) then
    create policy player_photos_service_delete
      on storage.objects
      for delete
      to service_role
      using (bucket_id = 'player-photos');
  end if;
end$$;
