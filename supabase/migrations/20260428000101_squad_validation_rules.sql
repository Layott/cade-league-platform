-- Plan 10 — squad validation rules (one live row per season).
-- Values for Elite 2025-2026: max_budget_coins=10_000_000 (GK excluded in UI
-- summation), min_nigerian_items=1, banned_item_types include Season Pass /
-- Objective / EVO players (Icons + Heroes are allowed). Seed inserts the row
-- conditionally (dev-only) in supabase/seed.sql.
create table public.squad_validation_rules (
  id                   uuid primary key default gen_random_uuid(),
  season_id            uuid not null references public.seasons (id) on delete cascade,
  max_budget_coins     bigint not null check (max_budget_coins >= 0),
  min_nigerian_items   int not null check (min_nigerian_items >= 0),
  banned_item_types    text[] not null default '{}',
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

-- One live rule row per season (Phase 1B). Enforced via partial unique index
-- so future soft-deleted rows don't conflict with a fresh row on the same
-- season.
create unique index squad_validation_rules_season_live_uidx
  on public.squad_validation_rules (season_id)
  where deleted_at is null;

create index squad_validation_rules_season_idx
  on public.squad_validation_rules (season_id)
  where deleted_at is null;

select public.attach_audit('public.squad_validation_rules');
