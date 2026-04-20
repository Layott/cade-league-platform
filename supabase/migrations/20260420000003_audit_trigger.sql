-- Generic row-change audit trigger.
-- Reads app.current_user_id / app.current_user_role / app.request_id
-- set by the API layer via SET LOCAL on each request.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid;
  v_actor_role    text;
  v_request_id    text;
  v_entity_id     text;
  v_before        jsonb;
  v_after         jsonb;
begin
  v_actor_user_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  v_actor_role    := nullif(current_setting('app.current_user_role', true), '');
  v_request_id    := nullif(current_setting('app.request_id', true), '');

  if tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
    v_entity_id := coalesce((to_jsonb(new)->>'id'), null);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_entity_id := coalesce((to_jsonb(new)->>'id'), null);
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
    v_entity_id := coalesce((to_jsonb(old)->>'id'), null);
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, action,
    entity_type, entity_id, before_json, after_json, request_id
  ) values (
    v_actor_user_id, v_actor_role, lower(tg_op),
    tg_table_name, v_entity_id, v_before, v_after, v_request_id
  );

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

-- Helper: attach the audit trigger to a table by name.
create or replace function public.attach_audit(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_trigger_name text;
begin
  v_trigger_name := 'audit_' || replace(p_table::text, '.', '_');
  execute format(
    'drop trigger if exists %I on %s',
    v_trigger_name, p_table
  );
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function public.audit_row_change()',
    v_trigger_name, p_table
  );
end;
$$;

-- Helper: set request context from the API layer.
create or replace function public.set_request_context(
  p_user_id   uuid,
  p_role      text,
  p_request_id text
) returns void
language plpgsql
as $$
begin
  perform set_config('app.current_user_id', coalesce(p_user_id::text, ''), true);
  perform set_config('app.current_user_role', coalesce(p_role, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
end;
$$;
