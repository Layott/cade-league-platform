-- Plan 21 — fuzzy lookup RPC for fc26_players.
--
-- The Plan 23 ref-review UI calls server/fcdb/lookup.ts, which falls back
-- here when the slug-exact path returns 0 rows. Centralising the trigram
-- query in one SECURITY INVOKER function (no RLS on the table; safe to
-- expose) keeps the TS layer ignorant of pg_trgm specifics.
create or replace function public.fc26_players_fuzzy(
  p_name text,
  p_threshold real default 0.3,
  p_limit int  default 10
)
returns table (
  id                    uuid,
  source_dataset        text,
  source_row_id         text,
  name                  text,
  short_name            text,
  slug                  text,
  rating                int,
  "position"            text,
  alt_positions         text[],
  club                  text,
  league                text,
  nation                text,
  nation_iso            text,
  age                   int,
  height_cm             int,
  weight_kg             int,
  preferred_foot        text,
  weak_foot             int,
  skill_moves           int,
  body_type             text,
  work_rate_atk         text,
  work_rate_def         text,
  attributes            jsonb,
  item_type             text,
  value_coins_estimate  bigint,
  imported_at           timestamptz,
  created_at            timestamptz,
  updated_at            timestamptz,
  deleted_at            timestamptz,
  sim                   real
)
language sql
stable
as $$
  select
    p.id, p.source_dataset, p.source_row_id, p.name, p.short_name, p.slug,
    p.rating, p.position, p.alt_positions, p.club, p.league, p.nation,
    p.nation_iso, p.age, p.height_cm, p.weight_kg, p.preferred_foot,
    p.weak_foot, p.skill_moves, p.body_type, p.work_rate_atk,
    p.work_rate_def, p.attributes, p.item_type, p.value_coins_estimate,
    p.imported_at, p.created_at, p.updated_at, p.deleted_at,
    similarity(p.name, p_name) as sim
  from public.fc26_players p
  where p.deleted_at is null
    and similarity(p.name, p_name) > p_threshold
  order by sim desc, p.rating desc
  limit p_limit;
$$;
