-- Widen user_roles.role check to the 12-value Phase 1B matrix.
-- The column uses a CHECK constraint (not a native ENUM), so no pg_enum surgery.
alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check check (
    role in (
      'admin',
      'loc',
      'idc',
      'referee',
      'technical',
      'production',
      'design',
      'moderator',
      'coach',
      'team_manager',
      'player',
      'viewer'
    )
  );
