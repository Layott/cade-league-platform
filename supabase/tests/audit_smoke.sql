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

  -- Plan 10 — squad tables smoke. Insert + update + soft-delete one row per
  -- new table, assert audit rows land tagged with this request_id.
  declare
    v_season_id     uuid;
    v_rule_id       uuid;
    v_player_id     uuid;
    v_user_id       uuid;
    v_submission_id uuid;
    v_item_id       uuid;
    v_change_id     uuid;
    v_pre_count     int;
    v_post_count    int;
  begin
    -- Need an FK-valid season + player + user. We pick any existing row.
    select id into v_season_id from public.seasons where deleted_at is null limit 1;
    select id into v_player_id from public.players where deleted_at is null limit 1;
    select id into v_user_id   from public.users   where deleted_at is null limit 1;

    if v_season_id is null or v_player_id is null or v_user_id is null then
      raise notice 'plan10 smoke skipped (missing season/player/user)';
    else
      -- squad_validation_rules (use an ephemeral season? we need unique live
      -- row; so update-then-delete if one already exists for the live season).
      insert into public.squad_validation_rules
        (season_id, max_budget_coins, min_nigerian_items, banned_item_types, notes)
      values (v_season_id, 1, 0, '{}'::text[], 'smoke-'||v_request_id)
      on conflict do nothing
      returning id into v_rule_id;
      if v_rule_id is not null then
        update public.squad_validation_rules set notes='smoke-u' where id = v_rule_id;
        update public.squad_validation_rules set deleted_at = now() where id = v_rule_id;
      end if;

      -- squad_submissions
      insert into public.squad_submissions
        (season_id, player_id, week_start_date, futbin_screenshot_path, notes)
      values (v_season_id, v_player_id, date '2099-01-01', 'smoke-key', 'smoke-'||v_request_id)
      returning id into v_submission_id;
      update public.squad_submissions set notes='smoke-u' where id = v_submission_id;

      -- squad_player_items
      insert into public.squad_player_items
        (submission_id, name, rating, position, value, item_type, nationality_flag, slot_index)
      values (v_submission_id, 'smoke', 80, 'ST', 1, 'gold', 'NG', 0)
      returning id into v_item_id;
      update public.squad_player_items set name='smoke-u' where id = v_item_id;
      update public.squad_player_items set deleted_at = now() where id = v_item_id;

      -- squad_change_requests
      insert into public.squad_change_requests
        (submission_id, player_out_name, player_in_name, player_in_item_type,
         player_in_rating, player_in_value, authorized_by_ref_user_id)
      values (v_submission_id, 'out', 'in', 'gold', 80, 1, v_user_id)
      returning id into v_change_id;
      update public.squad_change_requests set player_in_name='smoke-u' where id = v_change_id;
      update public.squad_change_requests set deleted_at = now() where id = v_change_id;

      -- Clean up submission (cascade will nuke items + change).
      update public.squad_submissions set deleted_at = now() where id = v_submission_id;

      select count(*) into v_post_count
        from public.audit_events
        where entity_type in (
          'squad_validation_rules',
          'squad_submissions',
          'squad_player_items',
          'squad_change_requests'
        ) and request_id = v_request_id;
      if v_post_count < 8 then
        raise exception 'plan10 smoke: expected >=8 audit rows, got %', v_post_count;
      end if;
    end if;
  end;

  -- Plan 13A — organizations + caution_ledger_entries smoke.
  -- Insert org + update; insert ledger row; assert audit capture; verify the
  -- append-only trigger on caution_ledger_entries blocks UPDATE.
  declare
    v_org_id       uuid;
    v_actor_uid    uuid;
    v_org_events   int;
    v_ledg_events  int;
    v_blocked      boolean := false;
  begin
    select id into v_actor_uid from public.users where deleted_at is null limit 1;
    if v_actor_uid is null then
      raise notice 'plan13 smoke skipped: no user available as actor';
    else
      insert into public.organizations (name, status)
        values ('smoke-org-'||substr(v_request_id,11,8), 'active')
        returning id into v_org_id;
      update public.organizations
        set status = 'suspended', updated_at = now()
        where id = v_org_id;

      insert into public.caution_ledger_entries (
        organization_id, entry_type, amount_coins, direction,
        balance_after_coins, entered_by_user_id, reference
      ) values (
        v_org_id, 'deposit', 100, 'credit', 100, v_actor_uid,
        'smoke-'||v_request_id
      );

      select count(*) into v_org_events
        from public.audit_events
        where entity_type = 'organizations'
          and entity_id = v_org_id::text
          and request_id = v_request_id;
      if v_org_events < 2 then
        raise exception 'organizations audit expected >=2, got %', v_org_events;
      end if;

      select count(*) into v_ledg_events
        from public.audit_events
        where entity_type = 'caution_ledger_entries'
          and request_id = v_request_id;
      if v_ledg_events < 1 then
        raise exception 'caution_ledger_entries audit expected >=1, got %',
          v_ledg_events;
      end if;

      -- Verify append-only block on UPDATE.
      begin
        update public.caution_ledger_entries
          set reference = 'tamper'
          where organization_id = v_org_id;
      exception when others then
        v_blocked := true;
      end;
      if not v_blocked then
        raise exception
          'caution_ledger_entries UPDATE was NOT blocked (append-only broken)';
      end if;

      -- Soft-delete smoke org.
      update public.organizations set deleted_at = now() where id = v_org_id;
    end if;
  end;

  -- Plan 14 — match_stat_screenshots + ocr_usage_log smoke. Insert + update
  -- + soft-delete on the screenshot table fires the audit trigger. Then
  -- prove ocr_usage_log rejects UPDATE and DELETE.
  declare
    v_mss_id    uuid;
    v_mss_mid   uuid;
    v_mss_uid   uuid;
    v_mss_n     int;
    v_log_id    uuid;
    v_blocked   boolean;
  begin
    select id into v_mss_mid from public.matches where deleted_at is null limit 1;
    select id into v_mss_uid from public.users  where deleted_at is null limit 1;
    if v_mss_mid is null or v_mss_uid is null then
      raise notice 'plan14 smoke skipped: missing match or user';
    else
      insert into public.match_stat_screenshots
        (match_id, storage_path, uploaded_by, parse_status, notes)
      values (
        v_mss_mid,
        'smoke/' || v_request_id || '.png',
        v_mss_uid,
        'pending',
        'plan14-smoke'
      ) returning id into v_mss_id;

      update public.match_stat_screenshots
        set parse_status = 'parsed', notes = 'plan14-smoke-u'
        where id = v_mss_id;

      update public.match_stat_screenshots
        set deleted_at = now()
        where id = v_mss_id;

      select count(*) into v_mss_n
        from public.audit_events
        where entity_type = 'match_stat_screenshots'
          and entity_id = v_mss_id::text
          and request_id = v_request_id;
      if v_mss_n <> 3 then
        raise exception 'match_stat_screenshots: expected 3 audit rows, got %', v_mss_n;
      end if;
    end if;

    -- ocr_usage_log append-only: insert a row, then prove UPDATE + DELETE
    -- both raise.
    insert into public.ocr_usage_log
      (engine, cost_usd_cents, success_bool, error_message)
    values
      ('tesseract', 0, true, 'plan14-smoke-'||v_request_id)
    returning id into v_log_id;

    v_blocked := false;
    begin
      update public.ocr_usage_log set error_message = 'tamper' where id = v_log_id;
    exception when others then
      if sqlerrm like '%append-only%' then
        v_blocked := true;
      else
        raise exception 'unexpected UPDATE error on ocr_usage_log: %', sqlerrm;
      end if;
    end;
    if not v_blocked then
      raise exception 'ocr_usage_log UPDATE was NOT blocked (append-only broken)';
    end if;

    v_blocked := false;
    begin
      delete from public.ocr_usage_log where id = v_log_id;
    exception when others then
      if sqlerrm like '%append-only%' then
        v_blocked := true;
      else
        raise exception 'unexpected DELETE error on ocr_usage_log: %', sqlerrm;
      end if;
    end;
    if not v_blocked then
      raise exception 'ocr_usage_log DELETE was NOT blocked (append-only broken)';
    end if;
  end;

  -- Audit rows stay (append-only). They are tagged with the smoke request_id
  -- and can be filtered out of reporting queries.

  raise notice 'audit-smoke: OK (request_id=%)', v_request_id;
end;
$$;
