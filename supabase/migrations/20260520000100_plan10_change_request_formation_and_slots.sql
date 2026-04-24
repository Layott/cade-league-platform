-- Plan 10 extension — Friday change window now supports three intents in a
-- single request row:
--   1. Formation change (e.g. 4-3-3 -> 4-4-2).
--   2. Slot rearrangement (same 11 cards, different pitch positions).
--   3. At most ONE card swap (original single-swap semantics).
--
-- A given row may encode any combination of (1), (2), (3) as long as the
-- final squad still has exactly 11 starters, zero duplicates, and at most
-- one NEW card introduced relative to the approved submission. The server
-- module enforces those invariants; the DB just records the payload.
--
-- Columns added:
--   new_formation TEXT NULL        - formation key from PitchLayout ("433", "442", ...)
--   new_slot_positions JSONB NULL  - array of 11 strings (resolved_fc_player_id OR "__out__"
--                                     marker when that slot is the swap-in slot).
--                                     Indexed 0..10 by new formation slot order.
--
-- Columns relaxed (swap is now optional):
--   player_out_name            -> nullable
--   player_in_name             -> nullable
--   player_in_item_type        -> nullable (retain check constraint when not null)
--   player_in_rating           -> nullable (retain range check when not null)
--   player_in_value            -> nullable (retain >= 0 check when not null)
--
-- The old unique partial index `one-live-row-per-submission` is retained
-- unchanged — whether the change is swap-only, formation-only, or mixed, a
-- player may only file one change request per weekly submission.

alter table public.squad_change_requests
  add column if not exists new_formation text,
  add column if not exists new_slot_positions jsonb;

-- Relax swap columns to nullable. The existing CHECK constraints are
-- inline with the column definitions — dropping them is needed before we
-- can allow NULLs for a formation-only change. Re-add as nullable-tolerant
-- checks (CHECK (x IS NULL OR ...)) so populated rows still obey the old
-- contract.

alter table public.squad_change_requests
  alter column player_out_name drop not null,
  alter column player_in_name drop not null,
  alter column player_in_item_type drop not null,
  alter column player_in_rating drop not null,
  alter column player_in_value drop not null;

-- PostgreSQL auto-named the inline checks; drop them by name if present,
-- then reattach nullable-tolerant versions. Using IF EXISTS keeps the
-- migration idempotent across environments where the name may differ.

alter table public.squad_change_requests
  drop constraint if exists squad_change_requests_player_in_item_type_check;
alter table public.squad_change_requests
  drop constraint if exists squad_change_requests_player_in_rating_check;
alter table public.squad_change_requests
  drop constraint if exists squad_change_requests_player_in_value_check;

alter table public.squad_change_requests
  add constraint squad_change_requests_player_in_item_type_check
    check (player_in_item_type is null
           or player_in_item_type in
              ('gold','silver','bronze','hero','icon','legend','special','other'));

alter table public.squad_change_requests
  add constraint squad_change_requests_player_in_rating_check
    check (player_in_rating is null or (player_in_rating between 1 and 99));

alter table public.squad_change_requests
  add constraint squad_change_requests_player_in_value_check
    check (player_in_value is null or player_in_value >= 0);

-- At least one intent must be expressed: a swap, a formation change, or a
-- slot rearrangement. Empty-intent rows are rejected at DB layer as a
-- belt-and-braces check alongside the server-side enforcement.
alter table public.squad_change_requests
  add constraint squad_change_requests_nonempty_intent_check
    check (
      player_in_name is not null
      or new_formation is not null
      or new_slot_positions is not null
    );
