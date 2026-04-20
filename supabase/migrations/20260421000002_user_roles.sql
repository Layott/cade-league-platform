create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  role        text not null check (role in ('admin','moderator','player')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (user_id, role)
);

create index user_roles_user_idx on public.user_roles (user_id) where deleted_at is null;
create index user_roles_role_idx on public.user_roles (role)    where deleted_at is null;

select public.attach_audit('public.user_roles');
