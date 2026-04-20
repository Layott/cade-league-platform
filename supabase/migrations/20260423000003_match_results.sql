-- Exactly one result per match. Two-stage flow: enterResult writes the row with
-- confirmed_by NULL (status draft); confirmResult sets confirmed_by + confirmed_at.

create table public.match_results (
  id                    uuid primary key default gen_random_uuid(),
  match_id              uuid not null unique references public.matches (id) on delete cascade,
  home_score            int  not null check (home_score >= 0),
  away_score            int  not null check (away_score >= 0),
  home_possession_pct   int  check (home_possession_pct between 0 and 100),
  away_possession_pct   int  check (away_possession_pct between 0 and 100),
  result_type           text not null default 'normal'
                        check (result_type in ('normal','forfeit','void')),
  entered_by            uuid not null references public.users (id) on delete restrict,
  entered_at            timestamptz not null default now(),
  confirmed_by          uuid references public.users (id) on delete restrict,
  confirmed_at          timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check (
    (confirmed_by is null and confirmed_at is null)
    or (confirmed_by is not null and confirmed_at is not null)
  )
);

create index match_results_match_idx
  on public.match_results (match_id)
  where deleted_at is null;

create index match_results_confirmed_idx
  on public.match_results (confirmed_at)
  where deleted_at is null and confirmed_at is not null;

select public.attach_audit('public.match_results');
