-- Bug 10 (2026-05-01) — persist the picker's chosen formation so the
-- broadcast overlay can render the EXACT shape the player selected
-- (`4-5-1` was previously displayed as `4-4-1-1` because the endpoint
-- derived shape post-hoc from D/M/F counts, which collapses formations
-- with the same starter distribution).
--
-- Stores the human-readable label form (`4-3-3`, `4-5-1`, ...) so the
-- overlay can render `payload.formation` directly without a key→label
-- map round trip. Submit-time code converts the picker's FormationKey
-- (`"433"`) via `formationLabel()` before insert.
--
-- Existing rows leave `formation` NULL — the broadcast endpoint falls
-- back to the lossy `deriveFormation()` heuristic for legacy rows so
-- nothing visibly regresses.
--
-- Constraint list mirrors every formation modelled in
-- `apps/web/src/components/squads/PitchLayout.tsx` (21 total: back-four
-- ×11, back-three ×6, back-five ×4). Adding a new formation to the UI
-- requires updating both this constraint AND `FormationKey`.

alter table public.squad_submissions
  add column if not exists formation text;

alter table public.squad_submissions
  add constraint squad_submissions_formation_check
  check (
    formation is null or formation in (
      -- Back-four (11)
      '4-3-3', '4-4-2', '4-2-3-1', '4-1-4-1', '4-1-2-1-2',
      '4-2-2-2', '4-2-4', '4-3-1-2', '4-3-2-1', '4-4-1-1', '4-5-1',
      -- Back-three (6)
      '3-5-2', '3-4-3', '3-4-1-2', '3-5-1-1', '3-4-2-1', '3-1-4-2',
      -- Back-five (4)
      '5-3-2', '5-2-1-2', '5-4-1', '5-2-3'
    )
  );

create index if not exists squad_submissions_formation_idx
  on public.squad_submissions (formation);
