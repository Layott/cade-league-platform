-- Plan 42 — match-aware overlays. Add `current_match_id` + `match_started_at`
-- to `public.stream_sessions` so the broadcast control panel can pin a single
-- in-flight match to the session. All autofill helpers and the score-bug
-- instance subscribe to this state.
--
-- Partial index keeps the "active current match" lookup fast without bloating
-- the shared stream_sessions indexes.
-- Idempotent (IF NOT EXISTS).

alter table public.stream_sessions
  add column if not exists current_match_id uuid
    references public.matches(id);

alter table public.stream_sessions
  add column if not exists match_started_at timestamptz;

create index if not exists stream_sessions_current_match_idx
  on public.stream_sessions (current_match_id)
  where current_match_id is not null and deleted_at is null;
