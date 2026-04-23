-- Plan 48 — `overlay-assets` storage bucket.
-- Public-read so admin-uploaded overlay images / ad videos can be served
-- straight from CDN without a signed-URL round trip on every overlay
-- render. Service-role writes only (the admin PUT uses a signed upload
-- URL generated server-side).
insert into storage.buckets (id, name, public)
values ('overlay-assets', 'overlay-assets', true)
on conflict (id) do nothing;

-- Storage policies. `storage.objects` owns read/write RLS. Public read on
-- the bucket, service-role writes handled by getServiceRoleSupabase() which
-- bypasses RLS. The explicit INSERT policy gates any future
-- client-originated PUTs behind `service_role`.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'overlay_assets_public_read'
  ) then
    create policy overlay_assets_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'overlay-assets');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'overlay_assets_service_write'
  ) then
    create policy overlay_assets_service_write
      on storage.objects
      for insert
      to service_role
      with check (bucket_id = 'overlay-assets');
  end if;
end$$;
