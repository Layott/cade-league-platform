-- Plan 53 — Player photo overrides (Task 1, migration 1/4).
--
-- `player_photo_selections` resolves which pose any (player, overlay_key)
-- combo renders. NULL `overlay_key` = global default for that player;
-- non-null = per-overlay override. Partial unique index enforces one
-- active row per scope (using `coalesce(overlay_key, '__global__')` so
-- the index treats NULL as a real key).
--
-- Note (deviation): plan/spec asked for migration prefix
-- `20260620000010` but that block was already claimed by the universal
-- element labels work (Plan 58). Bumped to `20260701000010..13` to
-- preserve the monotonic timestamp rule in CLAUDE.md.

create table public.player_photo_selections (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete cascade,
  overlay_key   text null,
  pose_index    int  not null check (pose_index >= 1),
  source        text not null check (source in ('manifest','upload')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz null
);

create unique index player_photo_selections_unique_scope
  on public.player_photo_selections (player_id, coalesce(overlay_key, '__global__'))
  where deleted_at is null;

select public.attach_audit('public.player_photo_selections');
