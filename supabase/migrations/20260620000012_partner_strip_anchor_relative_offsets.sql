-- Migrate `overlay_partner_strip_layout` to anchor-relative offset semantics.
--
-- Pre-2026-04-30: position_x_px / position_y_px were canvas-absolute coords.
-- Bootstrap math computed `bottom: 1080 - position_y_px` for bottom-anchored
-- layouts and `right: 1920 - position_x_px` for right-anchored. Default seed
-- of position_y_px=1020 + anchor=bottom-center → bottom: 60px (correct).
-- BUT admin setting position_x_px=0 with anchor=bottom-right wrote
-- `right: 1920px` → strip rendered off-canvas. Disappearance bug.
--
-- Post-fix (commit 14fae1af + this migration): semantics are direct anchor-
-- relative offsets. position_y_px=60 with anchor=bottom-center now means
-- "60px from canvas bottom" directly. Bootstrap writes `bottom:60px`. Admin
-- mental model now matches: type 0 → flush against the anchor edge.
--
-- This migration backfills existing rows so they keep their visual position
-- after the semantics change.

update public.overlay_partner_strip_layout
set
  position_y_px = case
    when anchor like 'bottom%' then greatest(0, 1080 - position_y_px)
    when anchor like 'top%'    then position_y_px
    when anchor like 'middle%' then position_y_px - 540  -- middle was offset from top
    else position_y_px
  end,
  position_x_px = case
    when anchor like '%right'  then greatest(0, 1920 - position_x_px)
    when anchor like '%left'   then position_x_px
    when anchor like '%center' then position_x_px
    else position_x_px
  end
where deleted_at is null;

-- Update default for new rows (was 1020).
alter table public.overlay_partner_strip_layout
  alter column position_y_px set default 60;
