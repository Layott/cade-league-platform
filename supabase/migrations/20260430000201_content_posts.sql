-- Plan 13A: Content posts (C)
-- Player-submitted social media posts; moderator verifies/rejects.
-- Weekly obligation: >=1 post across >=2 platforms per week.
-- week_start anchored to Monday (ISO dow=1) via CHECK.
-- Rejection requires reason.

create table public.content_posts (
  id                   uuid primary key default gen_random_uuid(),
  player_id            uuid not null references public.players (id) on delete restrict,
  week_start           date not null,
  platform             text not null check (platform in
                         ('twitter','instagram','tiktok','youtube')),
  post_url             text not null,
  submitted_at         timestamptz not null default now(),
  verified_by_user_id  uuid references public.users (id) on delete set null,
  verification_status  text not null default 'pending'
                         check (verification_status in ('pending','verified','rejected')),
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint content_posts_rejection_ck
    check (verification_status <> 'rejected' or rejection_reason is not null),
  constraint content_posts_week_start_monday_ck
    check (extract(isodow from week_start) = 1)
);

create index content_posts_player_week_idx
  on public.content_posts (player_id, week_start)
  where deleted_at is null;

create index content_posts_pending_idx
  on public.content_posts (submitted_at desc)
  where deleted_at is null and verification_status = 'pending';

select public.attach_audit('public.content_posts');

alter table public.content_posts enable row level security;

create policy content_posts_self_read on public.content_posts for select
  using (
    deleted_at is null and exists (
      select 1 from public.players p
      join public.users u on u.id = p.user_id
      where p.id = content_posts.player_id
        and u.supabase_auth_id = auth.uid()
    )
  );

create policy content_posts_no_direct_write on public.content_posts for all
  using (false) with check (false);
