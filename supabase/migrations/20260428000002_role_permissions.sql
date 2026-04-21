-- role_permissions stores granted permission strings per role.
-- Non-PII config data → no RLS. Business enforcement lives in hasPermAsync().
-- No deleted_at: a revoked permission is a DELETE (audit trigger captures it).
create table public.role_permissions (
  role        text not null,
  permission  text not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.users (id) on delete set null,
  primary key (role, permission),
  constraint role_permissions_role_check check (
    role in (
      'admin','loc','idc','referee','technical','production','design',
      'moderator','coach','team_manager','player','viewer'
    )
  ),
  constraint role_permissions_permission_format
    check (
      permission = '*'
      or permission ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_*]+)+$'
    )
);

create index role_permissions_role_idx on public.role_permissions (role);

select public.attach_audit('public.role_permissions');
