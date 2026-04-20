create table public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  ip_address          inet,
  user_agent          text,
  device_fingerprint  text not null,
  started_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  revoked_at          timestamptz,
  revoke_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index sessions_user_active_idx
  on public.sessions (user_id, started_at desc)
  where revoked_at is null and deleted_at is null;

create index sessions_fingerprint_idx
  on public.sessions (user_id, device_fingerprint)
  where deleted_at is null;

select public.attach_audit('public.sessions');
