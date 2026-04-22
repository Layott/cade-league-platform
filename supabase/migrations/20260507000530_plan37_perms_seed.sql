-- Plan 37 — perms seed.
-- admin already holds '*' wildcard → covers both new perms implicitly.
-- production gets match_clock.manage so the producer can run the clock.
-- Idempotent.

insert into public.role_permissions (role, permission) values
  ('production', 'match_clock.manage')
on conflict (role, permission) do nothing;
