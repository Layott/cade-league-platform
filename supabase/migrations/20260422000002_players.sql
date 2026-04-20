-- players extends public.users with competition-specific attributes.
-- One players row per users row (user_id is UNIQUE).
-- RLS enabled: PII host for Phase 1B NIN/bank columns. Turn it on now.

create table public.players (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references public.users (id) on delete cascade,
  gamer_tag       text not null,
  psn_id          text,
  jersey_number   int check (jersey_number between 1 and 99),
  photo_url       text,
  bio             text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index players_user_idx         on public.players (user_id)       where deleted_at is null;
create index players_gamer_tag_idx    on public.players (gamer_tag)     where deleted_at is null;
create index players_jersey_idx       on public.players (jersey_number) where deleted_at is null;

select public.attach_audit('public.players');

alter table public.players enable row level security;

create policy players_public_read
  on public.players for select
  using (deleted_at is null);

create policy players_self_read_any
  on public.players for select
  using (
    exists (
      select 1 from public.users u
      where u.id = players.user_id
        and u.supabase_auth_id = auth.uid()
    )
  );

create policy players_self_update
  on public.players for update
  using (
    exists (
      select 1 from public.users u
      where u.id = players.user_id
        and u.supabase_auth_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = players.user_id
        and u.supabase_auth_id = auth.uid()
    )
  );

create policy players_no_direct_insert
  on public.players for insert
  with check (false);

create policy players_no_direct_delete
  on public.players for delete
  using (false);
