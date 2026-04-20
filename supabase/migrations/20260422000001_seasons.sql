-- Phase 1A hard-codes a single season: Division 1 Elite 2025-2026.
-- Multi-season abstraction is a Phase 1B non-goal (spec §16).
-- No RLS: this table holds no PII and public routes read it server-side
-- via the anon key. Business logic gates writes (admin-only) at the API layer.

create table public.seasons (
  id              uuid primary key default gen_random_uuid(),
  year_range      text not null unique,
  division_name   text not null,
  start_date      date not null,
  end_date        date not null,
  status          text not null
                    check (status in ('upcoming','active','completed','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index seasons_status_idx
  on public.seasons (status)
  where deleted_at is null;

select public.attach_audit('public.seasons');

-- Hard-coded Elite 2025-2026 season row.
insert into public.seasons (year_range, division_name, start_date, end_date, status)
values ('2025-2026', 'Division 1 Elite', '2025-09-01', '2026-06-30', 'active')
on conflict (year_range) do nothing;
