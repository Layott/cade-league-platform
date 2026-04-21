-- Plan 18 — swap the 13 placeholder roster rows (player01..player13@cade.local)
-- to the real CADE Elite 2025-2026 gamer-tag identities.
--
-- Design:
--   * Idempotent UPDATE path — match existing `public.users` rows by the
--     placeholder email and rewrite display_name / email + bump psn_id on the
--     paired `public.players` row. Jersey numbers are preserved (the order of
--     the original placeholder seed already maps 1:1 to the real roster list
--     below, so we rely on jersey_number rather than reassigning it).
--   * Fallback INSERT path — when the placeholder row is missing but the real
--     email also isn't present, create a new auth.users + public.users pair so
--     a cold DB reaches the same end-state. We emit a NOTICE when this kicks
--     in so operators can spot it in logs.
--   * UPDATE-by-real-email path — if the migration was already applied and
--     placeholder rows are gone, re-running is a no-op on names/tags.
--
-- The audit trigger is already attached to public.users and public.players.
-- We seed `app.current_user_id` with the admin row so every audit event is
-- attributed to admin@cade.local rather than NULL. If no admin row exists yet
-- (unusual) we fall back to NULL — the trigger tolerates it.

do $mig$
declare
  v_admin_id uuid;
  v_roster   jsonb := $roster$[
    {"placeholder":"player01@cade.local","email":"adefola@cade.local",    "display":"Adefola",      "gamer_tag":"ADEFOLA"},
    {"placeholder":"player02@cade.local","email":"anife@cade.local",      "display":"Anife",        "gamer_tag":"ANIFE"},
    {"placeholder":"player03@cade.local","email":"baji.jnr@cade.local",   "display":"Baji Jnr",     "gamer_tag":"BAJI_JNR"},
    {"placeholder":"player04@cade.local","email":"dadaboi@cade.local",    "display":"Dadaboi",      "gamer_tag":"DADABOI"},
    {"placeholder":"player05@cade.local","email":"faruk@cade.local",      "display":"Faruk",        "gamer_tag":"FARUK"},
    {"placeholder":"player06@cade.local","email":"guru@cade.local",       "display":"Guru",         "gamer_tag":"GURU"},
    {"placeholder":"player07@cade.local","email":"kaykay@cade.local",     "display":"KayKay",       "gamer_tag":"KAYKAY"},
    {"placeholder":"player08@cade.local","email":"killer.freak@cade.local","display":"Killer Freak","gamer_tag":"KILLER_FREAK"},
    {"placeholder":"player09@cade.local","email":"kingnonex@cade.local",  "display":"KingNonex",    "gamer_tag":"KINGNONEX"},
    {"placeholder":"player10@cade.local","email":"mitch@cade.local",      "display":"Mitch",        "gamer_tag":"MITCH"},
    {"placeholder":"player11@cade.local","email":"mr.oga@cade.local",     "display":"Mr Oga",       "gamer_tag":"MR_OGA"},
    {"placeholder":"player12@cade.local","email":"tactical@cade.local",   "display":"Tactical",     "gamer_tag":"TACTICAL"},
    {"placeholder":"player13@cade.local","email":"wolevation@cade.local", "display":"Wolevation",   "gamer_tag":"WOLEVATION"}
  ]$roster$::jsonb;
  v_row         jsonb;
  v_public_user_id uuid;
  v_auth_user_id   uuid;
begin
  -- Attribute all audit rows emitted by this migration to the admin account
  -- where possible. Null-safe: the audit trigger tolerates an empty setting.
  select u.id into v_admin_id
    from public.users u
    where u.email = 'admin@cade.local'
      and u.deleted_at is null
    limit 1;
  perform set_config('app.current_user_id', coalesce(v_admin_id::text, ''), true);
  perform set_config('app.current_user_role', 'admin', true);
  perform set_config('app.request_id', 'migration:20260506000001_real_roster_swap', true);

  for v_row in select * from jsonb_array_elements(v_roster) loop
    v_public_user_id := null;

    -- 1. Placeholder match (most common path after Plan 1/2 seed).
    select u.id into v_public_user_id
      from public.users u
      where u.email = (v_row->>'placeholder')::citext
        and u.deleted_at is null
      limit 1;

    -- 2. Already-real match (re-running this migration).
    if v_public_user_id is null then
      select u.id into v_public_user_id
        from public.users u
        where u.email = (v_row->>'email')::citext
          and u.deleted_at is null
        limit 1;
    end if;

    if v_public_user_id is not null then
      -- Update path: rewrite user email + display_name, and rewrite the paired
      -- players row's gamer_tag + psn_id. jersey_number is left untouched.
      update public.users
         set email        = (v_row->>'email')::citext,
             display_name = v_row->>'display',
             updated_at   = now()
       where id = v_public_user_id
         and (email <> (v_row->>'email')::citext
              or display_name is distinct from (v_row->>'display'));

      update public.players
         set gamer_tag   = v_row->>'gamer_tag',
             psn_id      = 'PSN_' || (v_row->>'gamer_tag'),
             updated_at  = now()
       where user_id = v_public_user_id
         and (gamer_tag <> (v_row->>'gamer_tag')
              or psn_id is distinct from ('PSN_' || (v_row->>'gamer_tag')));

      raise notice 'roster-swap: updated % → % (%).',
        v_row->>'placeholder', v_row->>'email', v_row->>'gamer_tag';
    else
      -- Fallback insert path: neither placeholder nor real row exists. Mint a
      -- fresh auth.users row; handle_new_auth_user trigger will populate
      -- public.users. Then insert the paired public.players row.
      --
      -- We still set a password-less row (encrypted_password NULL) — the real
      -- password is provisioned out-of-band by scripts/seed-players.mjs or
      -- the admin UI. email_confirmed_at is set so login works once a password
      -- recovery link is issued.
      v_auth_user_id := gen_random_uuid();
      insert into auth.users (
        id, instance_id, aud, role, email,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values (
        v_auth_user_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated', 'authenticated',
        v_row->>'email',
        now(),
        jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
        jsonb_build_object('display_name', v_row->>'display'),
        now(), now()
      );

      -- handle_new_auth_user already created public.users; fetch its id.
      select u.id into v_public_user_id
        from public.users u
        where u.supabase_auth_id = v_auth_user_id
        limit 1;

      if v_public_user_id is null then
        raise exception 'roster-swap: handle_new_auth_user did not create public.users for %',
          v_row->>'email';
      end if;

      insert into public.players (user_id, gamer_tag, psn_id)
      values (
        v_public_user_id,
        v_row->>'gamer_tag',
        'PSN_' || (v_row->>'gamer_tag')
      );

      raise notice 'roster-swap: inserted fresh roster row for % (%).',
        v_row->>'email', v_row->>'gamer_tag';
    end if;
  end loop;
end
$mig$;
