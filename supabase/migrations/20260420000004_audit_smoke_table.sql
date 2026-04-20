-- A throwaway table used only to verify the audit trigger works end-to-end.
-- Real feature tables live in their own migrations (Plans 1+).
create table public.audit_smoke (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  created_at timestamptz not null default now()
);

select public.attach_audit('public.audit_smoke');
