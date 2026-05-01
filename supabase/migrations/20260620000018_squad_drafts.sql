-- Squad picker draft autosave (2026-04-30).
-- A `squad_drafts` row holds the in-flight pick state for a player + week so
-- that closing/refreshing the browser before clicking Submit doesn't lose
-- their formation, slots, subs, or screenshot upload reference.
--
-- One LIVE row per (player_id, week_start_date) — soft-deleted on successful
-- submit (clearDraft) so the partial unique index doesn't block the next
-- week's draft. Audit trigger attached for the standard insert/update trail.
-- RLS off; perms gated at the API layer (player owns own draft only).

create table public.squad_drafts (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references public.users (id),
  week_start_date     date not null,
  match_day_id        uuid references public.match_days (id),
  formation           text not null default '433',
  slots_json          jsonb not null default '[]'::jsonb,
  subs_json           jsonb not null default '[]'::jsonb,
  screenshot_path     text,
  set_by              uuid not null references public.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create unique index squad_drafts_one_active_per_week
  on public.squad_drafts (player_id, week_start_date)
  where deleted_at is null;

create index squad_drafts_match_day_idx
  on public.squad_drafts (match_day_id)
  where deleted_at is null;

select public.attach_audit('public.squad_drafts');
