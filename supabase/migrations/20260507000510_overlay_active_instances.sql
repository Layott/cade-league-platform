-- Plan 37 — overlay_active_instances: multi-active slot model for editable
-- templates. Lower-third opts in first (3 slots: 1=bottom, 2=mid, 3=top).
-- Other templates remain on the single-active overlay_events contract until
-- they explicitly opt in (extends the CHECK constraint in a follow-up).

create table public.overlay_active_instances (
  id                  uuid primary key default gen_random_uuid(),
  stream_session_id   uuid not null references public.stream_sessions(id),
  template_key        text not null,
  instance_slot       int not null,
  payload             jsonb not null,
  triggered_at        timestamptz not null default now(),
  cleared_at          timestamptz,
  triggered_by        uuid references public.users(id),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint overlay_active_instances_slot_chk
    check (instance_slot between 1 and 3),
  constraint overlay_active_instances_template_chk
    check (template_key in ('lower_third'))
);

create unique index overlay_active_instances_one_per_slot_idx
  on public.overlay_active_instances (stream_session_id, template_key, instance_slot)
  where cleared_at is null and deleted_at is null;

create index overlay_active_instances_session_idx
  on public.overlay_active_instances (stream_session_id)
  where cleared_at is null and deleted_at is null;

-- Audit trigger
select public.attach_audit('public.overlay_active_instances');

-- RLS: read for authenticated; writes via service role (API gate
-- 'broadcast.manage').
alter table public.overlay_active_instances enable row level security;

create policy overlay_active_instances_read_authn on public.overlay_active_instances
  for select to authenticated
  using (deleted_at is null);
