-- 2026-05-10 — Match-day slot + lane ordering.
--
-- Existing schema has `matches.match_order` (Plan 27) for flat ordering.
-- The league's actual broadcast model groups matches into NUMBERED SLOTS
-- where each slot may run 1 or 2 matches simultaneously: a PRIMARY match
-- (livestreamed) + an optional SECONDARY match (offstream). Producers
-- need to sequence slots so the 11-match-scores-day overlay can
-- auto-advance from one slot to the next as both lanes finish.
--
-- Adds:
--   * `match_slot SMALLINT` — the slot number on the match day (1, 2, ...).
--     Nullable so legacy fixtures without an assigned slot keep working;
--     UI prompts admins to assign before the broadcast.
--   * `match_lane TEXT CHECK ('primary'|'secondary')` — which lane within
--     the slot the match runs on. Solo slots have only `primary`.
--   * Partial unique `(match_day_id, match_slot, match_lane)` so the
--     same lane in the same slot can never carry two live matches.

alter table public.matches
  add column if not exists match_slot smallint;

alter table public.matches
  add column if not exists match_lane text;

alter table public.matches
  add constraint matches_match_lane_chk
    check (match_lane is null or match_lane in ('primary','secondary'));

create unique index if not exists matches_md_slot_lane_live_uidx
  on public.matches (match_day_id, match_slot, match_lane)
  where deleted_at is null
    and match_slot is not null
    and match_lane is not null;

comment on column public.matches.match_slot is
  'Slot number on the match day (1, 2, 3, ...). Two matches sharing the same slot run simultaneously on different lanes (primary livestreamed, secondary offstream).';

comment on column public.matches.match_lane is
  'Lane within the slot. ''primary'' = livestreamed; ''secondary'' = offstream simul. Solo slots populate only ''primary''.';

comment on index public.matches_md_slot_lane_live_uidx is
  'Per-(match_day, slot, lane) uniqueness. Enforces one match per lane per slot. Soft-deleted rows excluded so reorders work without index conflicts.';
