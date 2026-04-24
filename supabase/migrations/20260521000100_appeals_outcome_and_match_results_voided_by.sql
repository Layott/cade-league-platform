-- Plan 50 (2026-04-24): Appeals auto-void + ban void-propagation with
-- explicit action→match_results link.
--
-- Part 1: add `appeals.outcome` so the admin can explicitly record whether
-- the appeal was UPHELD or DISMISSED. Previously the panel ruled in free-
-- text only, and admins had to manually revoke the linked punishment —
-- Plan 50 wires "upheld" to an automatic revoke + void-unwind. Keep the
-- existing `ruling` text column for the panel's written reasoning.
--
-- Part 2: add `match_results.voided_by_action_id` so the platform knows
-- exactly which disciplinary_action caused a given void — previously the
-- link was reconstructed from the free-text `notes` column, which was
-- fragile and leaked implementation detail into a user-visible field.
-- Existing void rows are backfilled by parsing their marker pattern.

--
-- 1. appeals.outcome
--
alter table public.appeals
  add column if not exists outcome text
    check (outcome in ('upheld','dismissed'));

comment on column public.appeals.outcome is
  'Plan 50: explicit panel decision — upheld triggers auto-revoke of the linked disciplinary actions + re-propagation of any ban voids; dismissed leaves the sanction in force. NULL until ruled.';

-- When status=ruled, outcome must be set. When status is anything else,
-- outcome must be NULL. Legacy rows that were ruled before Plan 50 have
-- outcome NULL and we do NOT backfill; the admin must re-rule them
-- explicitly if they want the auto-void behaviour.
alter table public.appeals
  drop constraint if exists appeals_outcome_consistent;
alter table public.appeals
  add constraint appeals_outcome_consistent
    check (
      (status <> 'ruled' and outcome is null)
      or (status = 'ruled')
    );

--
-- 2. match_results.voided_by_action_id
--
alter table public.match_results
  add column if not exists voided_by_action_id uuid
    references public.disciplinary_actions (id) on delete set null;

comment on column public.match_results.voided_by_action_id is
  'Plan 50: disciplinary_action whose ban window caused this match to be voided. NULL for non-void rows and for voids entered manually by admins. Used by unpropagate_suspension_voids and by the admin un-void UI.';

create index if not exists match_results_voided_by_action_idx
  on public.match_results (voided_by_action_id)
  where voided_by_action_id is not null and deleted_at is null;

--
-- 3. Backfill voided_by_action_id for existing auto-voids
--
-- Pre-Plan-50, propagate_suspension_voids tagged void rows via their free-
-- text `notes` column with the marker 'auto-voided: suspension action <uuid>'.
-- Extract the uuid and populate the new column so the old marker becomes
-- redundant. We keep the `notes` text intact for audit history but new
-- inserts (see 20260521000200) rely on the uuid column exclusively.
update public.match_results mr
   set voided_by_action_id = (
     substring(mr.notes from 'auto-voided: suspension action ([0-9a-f-]{36})')::uuid
   )
 where mr.result_type = 'void'
   and mr.notes like 'auto-voided: suspension action %'
   and mr.voided_by_action_id is null
   and exists (
     select 1
       from public.disciplinary_actions da
      where da.id::text = substring(mr.notes from 'auto-voided: suspension action ([0-9a-f-]{36})')
   );
