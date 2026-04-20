-- Authentication events: login, login_failed, logout, password_reset,
-- new_device, session_revoked. Separate from audit_events because these are
-- security-centric, not CRUD audit.

create table public.auth_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users (id) on delete set null,
  event_type   text not null check (event_type in (
    'login','login_failed','logout','password_reset','new_device','session_revoked'
  )),
  ip_address   inet,
  user_agent   text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index auth_events_user_idx    on public.auth_events (user_id, created_at desc);
create index auth_events_type_idx    on public.auth_events (event_type, created_at desc);
