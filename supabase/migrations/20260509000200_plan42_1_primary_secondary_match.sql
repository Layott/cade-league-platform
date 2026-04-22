-- Plan 42.1 — primary + secondary match slots on stream_sessions.
--
-- Motivation: CADE broadcast runs TWO concurrent matches — a PRIMARY match
-- visible on the livestream, and a SECONDARY match played in parallel but
-- off-stream. Plan 42 only modelled one slot (`current_match_id`). This
-- migration promotes the schema to two independent slots while keeping
-- the old column live as a back-compat alias mirrored to
-- `primary_match_id` via a BEFORE INSERT/UPDATE trigger.
--
-- Back-compat contract
-- --------------------
-- When a writer touches `current_match_id` (legacy) OR `primary_match_id`
-- (new) the trigger keeps both columns equal; same for
-- `match_started_at` ↔ `primary_match_started_at`. Consumers may migrate
-- lazily. Secondary slot has no legacy alias.
--
-- Forward DDL only: partial indexes, trigger function, trigger binding.
-- Idempotent via IF NOT EXISTS / CREATE OR REPLACE.

alter table public.stream_sessions
  add column if not exists primary_match_id uuid
    references public.matches(id);

alter table public.stream_sessions
  add column if not exists primary_match_started_at timestamptz;

alter table public.stream_sessions
  add column if not exists secondary_match_id uuid
    references public.matches(id);

alter table public.stream_sessions
  add column if not exists secondary_match_started_at timestamptz;

create index if not exists stream_sessions_primary_match_idx
  on public.stream_sessions (primary_match_id)
  where primary_match_id is not null and deleted_at is null;

create index if not exists stream_sessions_secondary_match_idx
  on public.stream_sessions (secondary_match_id)
  where secondary_match_id is not null and deleted_at is null;

-- -- One-shot backfill: mirror any existing Plan 42 data onto the primary
-- -- columns. Safe because both sides are idempotent (COALESCE).
update public.stream_sessions
   set primary_match_id         = coalesce(primary_match_id, current_match_id),
       primary_match_started_at = coalesce(primary_match_started_at, match_started_at)
 where current_match_id is not null
   and primary_match_id is null;

-- Trigger: keep current_match_id ↔ primary_match_id in lockstep on any
-- write. Whichever side the caller modified, the other mirrors it. This
-- keeps legacy admin UIs (Plan 42) functional during the Plan 42.1 roll-
-- out and allows new UIs to prefer primary_*.
create or replace function public.stream_sessions_mirror_primary()
returns trigger
language plpgsql
as $$
begin
  -- INSERT: honour whichever column is non-null; copy to the other.
  if tg_op = 'INSERT' then
    if new.primary_match_id is null and new.current_match_id is not null then
      new.primary_match_id := new.current_match_id;
      new.primary_match_started_at := coalesce(new.primary_match_started_at, new.match_started_at);
    elsif new.current_match_id is null and new.primary_match_id is not null then
      new.current_match_id := new.primary_match_id;
      new.match_started_at := coalesce(new.match_started_at, new.primary_match_started_at);
    end if;
    return new;
  end if;

  -- UPDATE: detect which alias moved and mirror to the other. If both moved
  -- to the same value (common when a single caller writes both), no-op.
  if new.primary_match_id is distinct from old.primary_match_id
     and new.current_match_id is not distinct from old.current_match_id then
    new.current_match_id := new.primary_match_id;
    new.match_started_at := new.primary_match_started_at;
  elsif new.current_match_id is distinct from old.current_match_id
     and new.primary_match_id is not distinct from old.primary_match_id then
    new.primary_match_id := new.current_match_id;
    new.primary_match_started_at := new.match_started_at;
  end if;

  return new;
end;
$$;

drop trigger if exists stream_sessions_mirror_primary_trg on public.stream_sessions;
create trigger stream_sessions_mirror_primary_trg
  before insert or update on public.stream_sessions
  for each row
  execute function public.stream_sessions_mirror_primary();

comment on column public.stream_sessions.primary_match_id is
  'Plan 42.1 — primary (on-stream) match. Mirrored to current_match_id via trigger for back-compat.';
comment on column public.stream_sessions.secondary_match_id is
  'Plan 42.1 — secondary (off-stream) match. No legacy alias.';
comment on column public.stream_sessions.current_match_id is
  'Plan 42 (deprecated) — alias for primary_match_id. Retained for back-compat; writes are mirrored.';
