-- Append-only audit log. No update/delete allowed, even by admins.

create table public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid,
  actor_role      text,
  action          text not null check (action in ('insert','update','delete')),
  entity_type     text not null,
  entity_id       text,
  before_json     jsonb,
  after_json      jsonb,
  ip_address      inet,
  user_agent      text,
  request_id      text,
  created_at      timestamptz not null default now()
);

create index audit_events_entity_idx  on public.audit_events (entity_type, entity_id);
create index audit_events_actor_idx   on public.audit_events (actor_user_id, created_at desc);
create index audit_events_created_idx on public.audit_events (created_at desc);

-- Block any UPDATE or DELETE on audit_events.
create or replace function public.audit_events_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only; % not allowed', tg_op;
end;
$$;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_events_block_mutation();

create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_events_block_mutation();
