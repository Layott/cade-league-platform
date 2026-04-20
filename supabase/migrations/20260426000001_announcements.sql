-- Announcements are authored in draft state (published_at IS NULL),
-- then either (a) published immediately or (b) scheduled_publish_at set
-- and later promoted by the cron route.

create table public.announcements (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  body_md                 text not null,
  priority                text not null default 'info'
                            check (priority in ('info','important','urgent')),
  audience_type           text not null
                            check (audience_type in ('all','role','users','players_in_season')),
  audience_role           text
                            check (audience_role in ('admin','moderator','player') or audience_role is null),
  audience_user_ids       uuid[],
  channels                text[] not null default array['in_app','email']::text[],
  scheduled_publish_at    timestamptz,
  published_at            timestamptz,
  published_by            uuid references public.users (id) on delete set null,
  is_public               boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,

  -- audience_role is required when audience_type='role'
  constraint audience_role_required
    check (audience_type <> 'role' or audience_role is not null),
  -- audience_user_ids is required and non-empty when audience_type='users'
  constraint audience_user_ids_required
    check (audience_type <> 'users'
           or (audience_user_ids is not null and array_length(audience_user_ids, 1) > 0))
);

create index announcements_published_idx
  on public.announcements (published_at desc)
  where deleted_at is null and published_at is not null;

create index announcements_scheduled_idx
  on public.announcements (scheduled_publish_at)
  where deleted_at is null and published_at is null and scheduled_publish_at is not null;

create index announcements_public_idx
  on public.announcements (published_at desc)
  where deleted_at is null and is_public = true and published_at is not null;

select public.attach_audit('public.announcements');
