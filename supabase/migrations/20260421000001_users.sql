-- public.users mirrors auth.users with our own columns.
-- auth.users is managed by Supabase; we add display_name, phone, etc.
-- PII lives here → RLS policies applied in a later migration.

create table public.users (
  id                  uuid primary key default gen_random_uuid(),
  supabase_auth_id    uuid unique not null references auth.users (id) on delete cascade,
  email               citext unique not null,
  phone               text,
  display_name        text not null,
  last_login_at       timestamptz,
  failed_login_count  int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index users_deleted_at_idx  on public.users (deleted_at);
create index users_email_idx       on public.users (email) where deleted_at is null;

select public.attach_audit('public.users');
