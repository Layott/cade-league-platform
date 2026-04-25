-- Plan 51 — leaderboard_snapshots: append-only per-match-day capture of
-- the standings JSON at the moment of completion. Used for the tournament
-- page "history slider" + the broadcast-v2 leaderboard reveal animation
-- so we can show end-of-day standings deterministically without
-- recomputing on the fly.
--
-- One row per match_day_id (UNIQUE). Append-only (UPDATE/DELETE blocked
-- by trigger). Soft-delete via match_days cascade — when a match day is
-- soft-deleted upstream we leave the snapshot in place; when hard-cascaded
-- (ON DELETE CASCADE) it goes too. The trigger also blocks pure DELETE so
-- only the cascade path can actually clear a row.

create table if not exists public.leaderboard_snapshots (
  id              bigserial primary key,
  match_day_id    uuid not null unique references public.match_days (id) on delete cascade,
  snapshot_data   jsonb not null,
  captured_at     timestamptz not null default now()
);

create index if not exists leaderboard_snapshots_captured_idx
  on public.leaderboard_snapshots (captured_at desc);

-- Append-only enforcement. UPDATE + DELETE both raise.
create or replace function public.ls_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'leaderboard_snapshots is append-only (no UPDATE/DELETE)';
end;
$$;

drop trigger if exists leaderboard_snapshots_block on public.leaderboard_snapshots;
create trigger leaderboard_snapshots_block
  before update or delete on public.leaderboard_snapshots
  for each row execute function public.ls_block_mutation();

select public.attach_audit('public.leaderboard_snapshots');

comment on table public.leaderboard_snapshots is
  'Plan 51: append-only end-of-match-day standings capture. JSONB payload mirrors the recomputer output. UPDATE/DELETE blocked by trigger; cascade DELETE on match_day removal is allowed via FK.';
