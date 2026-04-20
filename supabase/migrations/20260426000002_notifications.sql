-- Per-user delivery ledger. One row per (announcement, user) pair.
-- No audit trigger — notifications are ephemeral delivery state,
-- not business data. The announcements row is the canonical record.

create table public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  announcement_id      uuid not null references public.announcements (id) on delete cascade,
  user_id              uuid not null references public.users (id) on delete cascade,
  delivered_channels   text[] not null default array[]::text[],
  read_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (announcement_id, user_id)
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where deleted_at is null and read_at is null;

create index notifications_announcement_idx
  on public.notifications (announcement_id)
  where deleted_at is null;
