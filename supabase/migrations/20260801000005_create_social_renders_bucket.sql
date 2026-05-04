-- Plan 54 — Broadcast Social Media (Wave 1A, migration 5/6).
--
-- `social-renders` storage bucket holds the rendered output (PNGs +
-- MP4s) produced by the Phase-1 image renderer + Phase-3 video
-- worker. PRIVATE bucket — `public=false` because finished social
-- assets may include unannounced fixtures, embargoed scores, or
-- pre-publish previews; the admin UI fetches signed URLs to display.
--
-- 50 MB cap covers a 1-minute 1080p MP4 at conservative bitrate plus
-- headroom for future high-bitrate variants. Image renders sit at
-- ~500 KB so the cap only matters for video output.
--
-- Service-role writes only — the renderer (Server Action OR worker
-- service-role client) is the sole writer. Authenticated users can
-- READ via signed URLs the API hands out after `social.read` perm
-- checks; no anonymous public read.
--
-- Idempotent: bucket insert + every policy guarded with EXISTS checks
-- so re-runs are no-ops. Mirrors the `partner-logos` pattern from
-- migration 20260620000006 + `player-photos` from 20260701000013.
--
-- Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4 (Storage bucket)

insert into storage.buckets (id, name, public, file_size_limit)
values ('social-renders', 'social-renders', false, 50000000)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'social_renders_service_insert'
  ) then
    create policy social_renders_service_insert
      on storage.objects
      for insert
      to service_role
      with check (bucket_id = 'social-renders');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'social_renders_service_update'
  ) then
    create policy social_renders_service_update
      on storage.objects
      for update
      to service_role
      using (bucket_id = 'social-renders')
      with check (bucket_id = 'social-renders');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'social_renders_service_delete'
  ) then
    create policy social_renders_service_delete
      on storage.objects
      for delete
      to service_role
      using (bucket_id = 'social-renders');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'social_renders_service_read'
  ) then
    create policy social_renders_service_read
      on storage.objects
      for select
      to service_role
      using (bucket_id = 'social-renders');
  end if;
end$$;
