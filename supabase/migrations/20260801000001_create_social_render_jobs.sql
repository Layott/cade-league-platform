-- Plan 54 — Broadcast Social Media (Wave 1A, migration 1/6).
--
-- `social_render_jobs` tracks every render request issued from the
-- /admin/broadcast/social UI. One row per render attempt. Rows are
-- never mutated post-completion EXCEPT to flip `status`, set
-- `output_url` / `output_size_bytes` / `error_message` / `duration_ms`,
-- or capture the approval marker — all of which the audit trigger
-- snapshots. Soft-delete via `deleted_at`; hard-deletes blocked by
-- the soft-delete convention (CLAUDE.md §7).
--
-- `source_data` snapshots the payload (matches, scores, etc.) at the
-- moment the render was requested so re-runs replay identical bytes
-- regardless of upstream live-feed drift.
--
-- RLS intentionally NOT enabled — this table holds rendered-output
-- metadata, not PII. Business permissions (`social.read`/`render`/
-- `approve`/`delete`) gate at the API layer per CLAUDE.md §4.
--
-- Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4

create table public.social_render_jobs (
  id                 uuid primary key default gen_random_uuid(),
  template_key       text not null,
  size               text not null,
  format             text not null
    check (format in ('image','video')),
  source_data        jsonb not null,
  season_id          uuid references public.seasons(id),
  match_day_id       uuid references public.match_days(id),
  status             text not null default 'pending'
    check (status in ('pending','rendering','ready','failed','cancelled')),
  output_url         text,
  output_size_bytes  bigint,
  error_message      text,
  duration_ms        int,
  requested_by       uuid references public.users(id),
  approved_by        uuid references public.users(id),
  approved_at        timestamptz,
  posted_marker      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index ix_social_render_jobs_status
  on public.social_render_jobs (status)
  where deleted_at is null;

create index ix_social_render_jobs_template
  on public.social_render_jobs (template_key, created_at desc)
  where deleted_at is null;
