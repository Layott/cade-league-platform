-- Overlay Design Page v2 — Wave 2 Stage 1 (6/8)
-- ------------------------------------------------------------------
-- `partner-logos` storage bucket — admin-uploaded partner logos for
-- the overlay strip. Public read so SSR + iframe can resolve URLs
-- without signed-URL roundtrips. 500 KB cap because logos are tiny
-- transparent PNGs/SVGs/WebPs (NOT 5 MB like overlay-bgs which holds
-- full 1920×1080 backdrops).
--
-- Service-role writes only — `uploadPartnerLogoAction` (Stage 3)
-- gates on `overlay.design.manage` before invoking
-- storage.from('partner-logos').upload(). The explicit
-- INSERT/UPDATE/DELETE policies bind to `service_role` so a stray
-- browser-origin RLS request can never write here.
--
-- Idempotent — bucket insert + every policy is wrapped in EXISTS
-- guards. Mirrors the `overlay-bgs` bucket pattern from migration
-- 20260612000002.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.7
-- ------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-logos',
  'partner-logos',
  true,
  512000,
  array['image/png', 'image/svg+xml', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'partner_logos_public_read'
  ) then
    create policy partner_logos_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'partner-logos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'partner_logos_service_insert'
  ) then
    create policy partner_logos_service_insert
      on storage.objects
      for insert
      to service_role
      with check (bucket_id = 'partner-logos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'partner_logos_service_update'
  ) then
    create policy partner_logos_service_update
      on storage.objects
      for update
      to service_role
      using (bucket_id = 'partner-logos')
      with check (bucket_id = 'partner-logos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'partner_logos_service_delete'
  ) then
    create policy partner_logos_service_delete
      on storage.objects
      for delete
      to service_role
      using (bucket_id = 'partner-logos');
  end if;
end$$;
