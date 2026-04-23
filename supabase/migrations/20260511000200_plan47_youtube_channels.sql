-- Plan 47 — YouTube channel registry.
--
-- Replaces the Plan 44 hard-coded `@CadeEsports` literal in
-- `/api/youtube/live` with a DB-driven list. Admin-only CRUD via
-- `/admin/youtube-channels` gated on `branding.manage` (re-used).
-- Multiple channels can be active; the default one is used when a
-- caller asks for "the" channel.

create table public.youtube_channels (
  id            uuid primary key default gen_random_uuid(),
  handle        text not null unique,
  display_label text,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.users(id) on delete set null,
  deleted_at    timestamptz,
  constraint youtube_channels_handle_format
    check (handle ~ '^@[A-Za-z0-9_.-]+$')
);

-- Only one row can have is_default = true at a time (partial unique
-- index over live rows). Admin UI enforces "promote to default" by
-- clearing the previous default inside a transaction.
create unique index youtube_channels_default_live_idx
  on public.youtube_channels ((true))
  where is_default and deleted_at is null;

create index youtube_channels_live_idx
  on public.youtube_channels (handle)
  where deleted_at is null;

select public.attach_audit('public.youtube_channels');

-- Seed the @CadeEsports default (matches Plan 44 hard-coded literal).
insert into public.youtube_channels (handle, display_label, is_default)
values ('@CadeEsports', 'CADE Esports', true)
on conflict (handle) do nothing;

alter table public.youtube_channels enable row level security;

create policy youtube_channels_read_all on public.youtube_channels
  for select to authenticated, anon
  using (deleted_at is null);
-- Writes via service-role only; gated in API by 'branding.manage'.
