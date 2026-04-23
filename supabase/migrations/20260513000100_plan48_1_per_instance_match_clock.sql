-- Plan 48.1 — per-instance match clocks.
--
-- Prior shape: one clock per stream_session (PK on stream_session_id).
-- This collapsed primary + secondary match timers into a single shared
-- value, which breaks the Plan 42.1 dual-slot broadcast flow.
--
-- New shape: clocks are keyed on (stream_session_id, instance_key). The
-- instance_key is a free-form text column — typical values:
--   'primary'   — the match shown on the livestream
--   'secondary' — the off-stream match (Plan 42.1)
--   plus room for future per-overlay clocks ('halftime_break' etc).
--
-- Back-compat: existing rows get instance_key='primary'. Old API paths
-- that omit slot still address the primary clock.
--
-- Plan 37's append-only audit trigger + RLS posture remain untouched.

alter table public.match_clock
  add column if not exists instance_key text not null default 'primary';

-- Drop old PK if it is still single-column, then re-add composite PK.
-- Use DO block so the migration is idempotent across Supabase versions.
do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'match_clock'
      and indexname = 'match_clock_pkey'
  ) then
    alter table public.match_clock drop constraint match_clock_pkey;
  end if;
end $$;

alter table public.match_clock
  add constraint match_clock_pkey primary key (stream_session_id, instance_key);

-- Helpful lookup when filtering per-session without knowing instance.
create index if not exists match_clock_session_idx
  on public.match_clock (stream_session_id) where deleted_at is null;
