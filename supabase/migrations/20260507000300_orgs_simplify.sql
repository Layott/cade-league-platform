-- Plan 31 — orgs simplify.
-- Per user: "no need to have their cac document or cac number on the
-- platform, most important information is their logo, players under
-- them, coaches or managers under them also."
--
-- Hard-drops the CAC-related columns + index since the table is freshly
-- seeded with placeholder demo orgs only (no production data to
-- preserve). Adds `logo_url text null` for the new public-facing org
-- logo (Supabase Storage path or absolute URL — UI mints signed reads
-- only when needed; org logos are public so a CDN URL is fine too).

-- 1) Drop the unique CAC index first (depends on cac_number column).
drop index if exists public.organizations_cac_idx;

-- 2) Drop CAC columns. `cac_cert_url` references storage paths that
--    point at the `org-cac-certs` bucket; objects there become orphans
--    and can be cleaned in a follow-up storage sweep.
alter table public.organizations
  drop column if exists cac_number,
  drop column if exists cac_cert_url;

-- 3) Add logo_url. Nullable; orgs without a logo render the initials
--    block in the UI. No length cap at the DB level — kept tight in the
--    zod schema (max 500).
alter table public.organizations
  add column if not exists logo_url text null;

create index if not exists organizations_logo_idx on public.organizations (id)
  where deleted_at is null and logo_url is not null;
