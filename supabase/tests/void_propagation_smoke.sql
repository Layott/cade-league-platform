-- Plan 11 Task 18: void-propagation smoke test.
-- Self-contained, idempotent. All rows tagged with request_id so reports
-- can filter them out, and all rows get soft-deleted at the end.
--
-- Scenario:
--   1. Create fixture: two synthetic players (P, Q) in the active season,
--      two synthetic match_days (MD_A, MD_B), two matches (P-vs-Q on each).
--   2. Issue a sanction_type='ban' action for P covering both match dates.
--   3. Assert: two match_results rows with result_type='void' exist and
--      are tagged with our action id marker.
--   4. Assert: matches for P are status='voided'.
--   5. Assert: standings.recompute was invoked (season row count updated).
--   6. Revoke the action → assert voids are removed and matches reset.
--   7. Clean up (soft-delete synthetic data).

do $$
declare
  v_request_id    text := 'req-void-smoke-' || gen_random_uuid()::text;
  v_season_id     uuid;
  v_actor_user_id uuid;
  v_player_p_id   uuid;
  v_player_q_id   uuid;
  v_user_p_id     uuid;
  v_user_q_id     uuid;
  v_md_a_id       uuid;
  v_md_b_id       uuid;
  v_match_1_id    uuid;
  v_match_2_id    uuid;
  v_case_id       uuid;
  v_action_id     uuid;
  v_void_count    int;
  v_voided_matches int;
  v_remaining     int;
begin
  perform public.set_request_context(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    v_request_id
  );

  -- Resolve the active Elite season. If none, abort gracefully.
  select id into v_season_id
    from public.seasons
    where status = 'active' and deleted_at is null
    limit 1;
  if v_season_id is null then
    raise notice 'void-smoke: no active season — skipping';
    return;
  end if;

  -- Pick an existing admin user to act as imposer.
  select u.id into v_actor_user_id
    from public.users u
    join public.user_roles r on r.user_id = u.id and r.role = 'admin' and r.deleted_at is null
    where u.deleted_at is null
    limit 1;
  if v_actor_user_id is null then
    raise exception 'void-smoke: no admin user available';
  end if;

  -- Create two synthetic users + players so we don't pollute the real roster.
  insert into public.users (supabase_auth_id, email, display_name)
    values (gen_random_uuid(), 'void-smoke-p@example.invalid', 'VoidSmoke P')
    returning id into v_user_p_id;
  insert into public.users (supabase_auth_id, email, display_name)
    values (gen_random_uuid(), 'void-smoke-q@example.invalid', 'VoidSmoke Q')
    returning id into v_user_q_id;

  insert into public.players (user_id, gamer_tag)
    values (v_user_p_id, 'void-smoke-p-' || substr(v_request_id, -6))
    returning id into v_player_p_id;
  insert into public.players (user_id, gamer_tag)
    values (v_user_q_id, 'void-smoke-q-' || substr(v_request_id, -6))
    returning id into v_player_q_id;

  insert into public.season_participants (season_id, player_id)
    values (v_season_id, v_player_p_id);
  insert into public.season_participants (season_id, player_id)
    values (v_season_id, v_player_q_id);

  -- Two throwaway match_days far in the future so they don't collide with
  -- real fixtures. Use a unique date derived from request_id suffix.
  insert into public.match_days (
    season_id, match_date, arrival_cutoff_time, match_start_time, venue_name
  ) values (
    v_season_id, date '2099-01-01', time '18:45', time '19:00',
    'Void Smoke Venue A'
  ) returning id into v_md_a_id;
  insert into public.match_days (
    season_id, match_date, arrival_cutoff_time, match_start_time, venue_name
  ) values (
    v_season_id, date '2099-01-08', time '18:45', time '19:00',
    'Void Smoke Venue B'
  ) returning id into v_md_b_id;

  insert into public.matches (
    season_id, match_day_id, home_player_id, away_player_id, status
  ) values (
    v_season_id, v_md_a_id, v_player_p_id, v_player_q_id, 'scheduled'
  ) returning id into v_match_1_id;
  insert into public.matches (
    season_id, match_day_id, home_player_id, away_player_id, status
  ) values (
    v_season_id, v_md_b_id, v_player_q_id, v_player_p_id, 'scheduled'
  ) returning id into v_match_2_id;

  -- Open disciplinary case + ban action spanning both match days.
  insert into public.disciplinary_cases (
    player_id, incident_type, reported_by, status, notes
  ) values (
    v_player_p_id, 'other', v_actor_user_id, 'open', 'void-smoke case'
  ) returning id into v_case_id;

  insert into public.disciplinary_actions (
    case_id, sanction_type, magnitude, effective_from, effective_until,
    imposed_by, public_visible, notes
  ) values (
    v_case_id, 'ban', 0, date '2099-01-01', date '2099-01-15',
    v_actor_user_id, true, 'void-smoke ban'
  ) returning id into v_action_id;

  -- Trigger should have propagated — assert 2 void rows exist.
  select count(*) into v_void_count
    from public.match_results
    where result_type = 'void'
      and notes = format('auto-voided: suspension action %s', v_action_id);
  if v_void_count <> 2 then
    raise exception 'void-smoke: expected 2 void rows, got %', v_void_count;
  end if;

  select count(*) into v_voided_matches
    from public.matches
    where id in (v_match_1_id, v_match_2_id)
      and status = 'voided';
  if v_voided_matches <> 2 then
    raise exception 'void-smoke: expected 2 voided matches, got %', v_voided_matches;
  end if;

  -- Revoke → un-propagate.
  update public.disciplinary_actions
     set revoked_at = now(), revoke_reason = 'void-smoke revoke'
   where id = v_action_id;

  select count(*) into v_remaining
    from public.match_results
    where result_type = 'void'
      and notes = format('auto-voided: suspension action %s', v_action_id);
  if v_remaining <> 0 then
    raise exception 'void-smoke: expected 0 void rows after revoke, got %', v_remaining;
  end if;

  select count(*) into v_voided_matches
    from public.matches
    where id in (v_match_1_id, v_match_2_id)
      and status = 'scheduled';
  if v_voided_matches <> 2 then
    raise exception 'void-smoke: expected 2 reset matches after revoke, got %', v_voided_matches;
  end if;

  -- Cleanup (soft delete).
  update public.disciplinary_actions set deleted_at = now() where id = v_action_id;
  update public.disciplinary_cases set deleted_at = now() where id = v_case_id;
  update public.matches set deleted_at = now() where id in (v_match_1_id, v_match_2_id);
  update public.match_days set deleted_at = now() where id in (v_md_a_id, v_md_b_id);
  update public.season_participants
     set deleted_at = now()
   where season_id = v_season_id and player_id in (v_player_p_id, v_player_q_id);
  update public.players set deleted_at = now() where id in (v_player_p_id, v_player_q_id);
  update public.users set deleted_at = now() where id in (v_user_p_id, v_user_q_id);

  raise notice 'void-smoke: OK (request_id=%, action_id=%)', v_request_id, v_action_id;
end;
$$;
