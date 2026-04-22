-- Plan 23 — link a transcribed squad item to its FCDB resolution.
--
-- Nullable; ref sets via /admin/squads/[id] when locking in a pick from the
-- ambiguous-candidates dropdown (Plan 23 §3.4 acceptFcdbCandidate). FCDB
-- enrichment is informational only — the FK does not change the squad's
-- approve/reject decision authority (Plan 10).
--
-- ON DELETE SET NULL so a future Kaggle re-import that drops a row doesn't
-- cascade-delete the squad item; squad data wins. The audit trigger on
-- squad_player_items (attached in 20260428000103) fires on UPDATE so the
-- ref's pick is captured automatically (CLAUDE.md non-negotiable §3).
alter table public.squad_player_items
  add column if not exists resolved_fc_player_id uuid
    references public.fc26_players (id) on delete set null;

create index if not exists squad_player_items_resolved_fc_idx
  on public.squad_player_items (resolved_fc_player_id)
  where deleted_at is null and resolved_fc_player_id is not null;
