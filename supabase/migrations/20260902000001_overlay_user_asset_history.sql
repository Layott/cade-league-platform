-- Overlay Builder Wave 2B — Task 2.
-- ------------------------------------------------------------------
-- New append-only table `overlay_user_asset_history` capturing the
-- prior version of a PSD asset before Photopea overwrites it. Lets an
-- admin revert a Photopea round-trip via a `revertToAssetSnapshot`
-- action surface (Task 5).
--
-- Append-only enforcement reuses the existing
-- `overlay_design_history_block_mutation()` function (mirrors
-- `overlay_user_design_history` from Wave 1A migration
-- 20260901000002).
--
-- The table stores a POINTER to the prior storage object — not the
-- PSD bytes themselves. The bridge action moves the prior object to
-- `overlay-user-assets/psd/history/<asset_id>/<created_at>.psd` and
-- writes the row pointing at the moved path. Restoring a snapshot
-- copies the historical object back to the live path.
--
-- Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2
-- ------------------------------------------------------------------

create table public.overlay_user_asset_history (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null,    -- intentionally NO FK: history survives
                                  -- soft-delete of parent asset
  storage_path  text not null,    -- path under overlay-user-assets bucket
  size_bytes    bigint not null,
  mime_type     text not null,
  note          text,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index overlay_user_asset_history_asset_idx
  on public.overlay_user_asset_history (asset_id, created_at desc)
  where deleted_at is null;

-- Append-only enforcement — reuse the existing block_mutation function.
-- The function takes no arguments and raises on TG_OP, so it works
-- identically for any table it is attached to.
drop trigger if exists overlay_user_asset_history_no_update
  on public.overlay_user_asset_history;
create trigger overlay_user_asset_history_no_update
  before update on public.overlay_user_asset_history
  for each row execute function public.overlay_design_history_block_mutation();

drop trigger if exists overlay_user_asset_history_no_delete
  on public.overlay_user_asset_history;
create trigger overlay_user_asset_history_no_delete
  before delete on public.overlay_user_asset_history
  for each row execute function public.overlay_design_history_block_mutation();

select public.attach_audit('public.overlay_user_asset_history');

alter table public.overlay_user_asset_history enable row level security;

create policy overlay_user_asset_history_no_direct
  on public.overlay_user_asset_history
  for all
  using (false)
  with check (false);

comment on table public.overlay_user_asset_history is
  'Append-only ledger of PSD asset snapshots taken before Photopea '
  'overwrites the live object. Restore via `revertToAssetSnapshot()`. '
  'See docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2.';
