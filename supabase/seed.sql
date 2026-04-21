-- supabase/seed.sql — DEV ONLY. Runs via `supabase db reset` locally; never
-- touches production (production uses migrations + admin-driven data entry).
-- Idempotent: every insert is guarded with NOT EXISTS / ON CONFLICT.

-- -----------------------------------------------------------------------
-- Plan 10 — seed the Elite 2025-2026 squad_validation_rules row.
-- Values sourced from CADE Elite League Rulebook §4.3 (confirmed in
-- KNOWLEDGE/extracted/PLAN11-LADDER-GAPS.md):
--   max_budget_coins   : 10_000_000 (GK excluded in summation)
--   min_nigerian_items : 1 (in starting XI, playing first 45 min)
--   banned_item_types  : EVO players, Season Pass, Objective items
-- Icons + Heroes are allowed.
insert into public.squad_validation_rules
  (season_id, max_budget_coins, min_nigerian_items, banned_item_types, notes)
select s.id, 10000000, 1,
       array['evolution','season_pass','objective']::text[],
       'seeded from rulebook v1.7 §4.3'
from public.seasons s
where s.status = 'active' and s.deleted_at is null
  and not exists (
    select 1 from public.squad_validation_rules r
    where r.season_id = s.id and r.deleted_at is null
  );
