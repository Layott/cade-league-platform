-- Plan 10 — per-submission item rows (hand-transcribed from Futbin screenshot).
-- slot_index 0..10 = starting XI, 11..22 = bench / reserves.
create table public.squad_player_items (
  id                 uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references public.squad_submissions (id) on delete cascade,
  name               text not null,
  rating             int  not null check (rating between 1 and 99),
  position           text not null,
  value              bigint not null check (value >= 0),
  item_type          text not null check (item_type in
                       ('gold','silver','bronze','hero','icon','legend','special','other')),
  nationality_flag   text,
  slot_index         int  not null check (slot_index between 0 and 22),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- One live item per slot per submission. Soft-deleted rows don't block a
-- replacement in the same slot.
create unique index squad_player_items_sub_slot_live_uidx
  on public.squad_player_items (submission_id, slot_index)
  where deleted_at is null;

create index squad_player_items_submission_idx
  on public.squad_player_items (submission_id)
  where deleted_at is null;

select public.attach_audit('public.squad_player_items');
