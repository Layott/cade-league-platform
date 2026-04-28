-- Overlay Design System Phase 1 (3/4)
-- ------------------------------------------------------------------
-- `overlay_design_history` — append-only snapshot ledger. Every token
-- save (and every revert) writes one row capturing the full token map
-- at that moment as `snapshot_json`. Used for the version-history
-- timeline + revert action.
--
-- Mirrors the `audit_events` / `caution_ledger_entries` /
-- `ocr_usage_log` append-only pattern: dedicated triggers raise on
-- UPDATE + DELETE, so rows are immutable post-insert. Soft-delete via
-- `deleted_at` is the only allowed lifecycle change AFTER the
-- triggers, but neither the server module nor any UI exposes that —
-- it is reserved for ops-side data fixes only.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §3.3
-- ------------------------------------------------------------------

create table public.overlay_design_history (
  id             uuid primary key default gen_random_uuid(),
  overlay_key    text not null,
  variant_id     text not null,
  snapshot_json  jsonb not null,
  changed_by     uuid not null references public.users (id) on delete restrict,
  reason         text,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index overlay_design_history_lookup_idx
  on public.overlay_design_history (overlay_key, variant_id, created_at desc)
  where deleted_at is null;

create index overlay_design_history_changed_by_idx
  on public.overlay_design_history (changed_by, created_at desc)
  where deleted_at is null;

-- Append-only enforcement.
create or replace function public.overlay_design_history_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'overlay_design_history is append-only; % not allowed', tg_op;
end;
$$;

drop trigger if exists overlay_design_history_no_update
  on public.overlay_design_history;
create trigger overlay_design_history_no_update
  before update on public.overlay_design_history
  for each row execute function public.overlay_design_history_block_mutation();

drop trigger if exists overlay_design_history_no_delete
  on public.overlay_design_history;
create trigger overlay_design_history_no_delete
  before delete on public.overlay_design_history
  for each row execute function public.overlay_design_history_block_mutation();

select public.attach_audit('public.overlay_design_history');

-- Service-role only. Reads come through server module
-- (`apps/web/src/server/overlays/design/history.ts`).
alter table public.overlay_design_history enable row level security;

create policy overlay_design_history_no_direct
  on public.overlay_design_history
  for all
  using (false)
  with check (false);
