-- Plan 10 — squad_change_requests: Friday 21:00-22:00 WAT one-swap-per-week
-- record. authorized_by_ref_user_id must resolve to a user with the perm
-- 'squads.change_authorize' at write time (enforced in the server module).
create table public.squad_change_requests (
  id                         uuid primary key default gen_random_uuid(),
  submission_id              uuid not null references public.squad_submissions (id) on delete cascade,
  player_out_name            text not null,
  player_out_item_id         uuid references public.squad_player_items (id),
  player_in_name             text not null,
  player_in_item_type        text not null check (player_in_item_type in
                               ('gold','silver','bronze','hero','icon','legend','special','other')),
  player_in_rating           int  not null check (player_in_rating between 1 and 99),
  player_in_value            bigint not null check (player_in_value >= 0),
  player_in_nationality_flag text,
  authorized_by_ref_user_id  uuid not null references public.users (id),
  authorized_at              timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz
);

-- One live swap per submission (per player per week).
create unique index squad_change_requests_submission_live_uidx
  on public.squad_change_requests (submission_id)
  where deleted_at is null;

create index squad_change_requests_submission_idx
  on public.squad_change_requests (submission_id)
  where deleted_at is null;

select public.attach_audit('public.squad_change_requests');
