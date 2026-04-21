-- Plan 10 — squad_submissions: one live submission per (player, week_start_date).
-- week_start_date is the Thursday anchor in WAT (see apps/web/src/lib/time.ts
-- weekStartThursday). futbin_screenshot_path is the storage object key — never
-- a fully-signed URL; short-lived signed URLs are generated on demand.
create table public.squad_submissions (
  id                     uuid primary key default gen_random_uuid(),
  season_id              uuid not null references public.seasons (id) on delete cascade,
  player_id              uuid not null references public.players (id) on delete cascade,
  week_start_date        date not null,
  futbin_screenshot_path text not null,
  submitted_at           timestamptz not null default now(),
  validation_status      text not null default 'pending'
                         check (validation_status in ('pending','approved','rejected')),
  validated_by           uuid references public.users (id),
  validated_at           timestamptz,
  rejection_reason       text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

-- One live submission per player per week (partial unique so soft-deletes
-- don't block a resubmission).
create unique index squad_submissions_player_week_live_uidx
  on public.squad_submissions (player_id, week_start_date)
  where deleted_at is null;

create index squad_submissions_season_week_idx
  on public.squad_submissions (season_id, week_start_date)
  where deleted_at is null;

create index squad_submissions_status_idx
  on public.squad_submissions (validation_status, week_start_date)
  where deleted_at is null;

select public.attach_audit('public.squad_submissions');
