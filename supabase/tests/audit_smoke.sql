-- Runs in a single transaction so SET LOCAL works across the inserts/updates/deletes.
do $$
declare
  v_smoke_id      uuid;
  v_request_id    text := 'req-smoke-' || gen_random_uuid()::text;
  v_total         int;
  v_insert_count  int;
  v_update_count  int;
  v_delete_count  int;
begin
  perform public.set_request_context(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    v_request_id
  );

  insert into public.audit_smoke (label) values ('hello') returning id into v_smoke_id;
  update public.audit_smoke set label = 'hello2' where id = v_smoke_id;
  delete from public.audit_smoke where id = v_smoke_id;

  select count(*) into v_total
    from public.audit_events
    where entity_type = 'audit_smoke' and request_id = v_request_id;
  if v_total <> 3 then
    raise exception 'expected 3 audit rows, got %', v_total;
  end if;

  select count(*) into v_insert_count
    from public.audit_events
    where entity_type = 'audit_smoke' and action = 'insert' and request_id = v_request_id;
  select count(*) into v_update_count
    from public.audit_events
    where entity_type = 'audit_smoke' and action = 'update' and request_id = v_request_id;
  select count(*) into v_delete_count
    from public.audit_events
    where entity_type = 'audit_smoke' and action = 'delete' and request_id = v_request_id;

  if v_insert_count <> 1 or v_update_count <> 1 or v_delete_count <> 1 then
    raise exception 'expected one of each action, got i=%, u=%, d=%',
      v_insert_count, v_update_count, v_delete_count;
  end if;

  -- role_permissions audit smoke: insert + delete should produce 2 audit rows
  -- tagged with this request_id and entity_type='role_permissions'. We pick
  -- the `viewer` role which has zero seed rows, with a throwaway permission
  -- string that matches the format constraint (no wildcard).
  insert into public.role_permissions (role, permission) values ('viewer', 'smoke.test');
  delete from public.role_permissions where role = 'viewer' and permission = 'smoke.test';

  select count(*) into v_total
    from public.audit_events
    where entity_type = 'role_permissions' and request_id = v_request_id;
  if v_total <> 2 then
    raise exception 'role_permissions: expected 2 audit rows, got %', v_total;
  end if;

  -- Audit rows stay (append-only). They are tagged with the smoke request_id
  -- and can be filtered out of reporting queries.

  raise notice 'audit-smoke: OK (request_id=%)', v_request_id;
end;
$$;
