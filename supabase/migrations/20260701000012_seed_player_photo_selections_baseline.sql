-- Plan 53 — Player photo overrides (Task 1, migration 3/4).
--
-- Seed one global selection row per roster player using the legacy
-- `DEFAULT_POSE_BY_SLUG` overrides from `apps/web/src/lib/player-photos.ts`.
-- Players not in the override map default to pose_index = 1 (manifest
-- pose 01 — the canonical first portrait).
--
-- Slug derivation matches the runtime convention:
--   lower(replace(replace(gamer_tag, ' ', '_'), '-', '_'))
-- Note: `players` only has `gamer_tag` (NOT NULL), no `display_name` —
-- the plan's `coalesce(p.gamer_tag, p.display_name, '')` is reduced to
-- `p.gamer_tag` since display_name doesn't exist on this table.
--
-- Idempotent — the partial unique index on (player_id, coalesce(overlay_key, '__global__'))
-- where deleted_at is null guarantees the on-conflict-do-nothing path
-- when re-running.

insert into public.player_photo_selections (player_id, overlay_key, pose_index, source, active)
select p.id,
       null::text                  as overlay_key,
       case
         when lower(replace(replace(p.gamer_tag, ' ', '_'), '-', '_')) = 'anife'      then 3
         when lower(replace(replace(p.gamer_tag, ' ', '_'), '-', '_')) = 'kingnonex'  then 2
         when lower(replace(replace(p.gamer_tag, ' ', '_'), '-', '_')) = 'king_nonex' then 2
         else 1
       end                         as pose_index,
       'manifest'                  as source,
       true                        as active
from public.players p
where p.deleted_at is null
on conflict do nothing;
