-- Overlay Design System Phase A — `overlay-bgs` storage bucket.
-- ------------------------------------------------------------------
-- Public-read bucket for admin-uploaded overlay backgrounds. Files are
-- referenced by the `bg-image` design token (token_value = public URL)
-- and consumed by the iframe via `--overlay-bg-image: url("...")` CSS
-- variable. 5 MB cap, image/png + jpeg + webp only.
--
-- Service-role writes only — `uploadOverlayBgAction` in
-- apps/web/src/app/admin/broadcast/v2/design/actions.ts gates on the
-- `overlay.design.manage` perm before invoking storage.from().upload().
-- The explicit INSERT/UPDATE/DELETE policies bind to `service_role` so
-- a stray browser-origin RLS request can never write here.
--
-- Idempotent — bucket insert + every policy is wrapped in EXISTS guards.
-- ------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'overlay-bgs',
  'overlay-bgs',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS policies on `storage.objects`. Public read so the SSR
-- iframe can resolve the URL without a signed-URL roundtrip per render
-- (matches the `overlay-assets` + `org-logos` pattern).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'overlay_bgs_public_read'
  ) then
    create policy overlay_bgs_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'overlay-bgs');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'overlay_bgs_service_insert'
  ) then
    create policy overlay_bgs_service_insert
      on storage.objects
      for insert
      to service_role
      with check (bucket_id = 'overlay-bgs');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'overlay_bgs_service_update'
  ) then
    create policy overlay_bgs_service_update
      on storage.objects
      for update
      to service_role
      using (bucket_id = 'overlay-bgs')
      with check (bucket_id = 'overlay-bgs');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'overlay_bgs_service_delete'
  ) then
    create policy overlay_bgs_service_delete
      on storage.objects
      for delete
      to service_role
      using (bucket_id = 'overlay-bgs');
  end if;
end$$;
