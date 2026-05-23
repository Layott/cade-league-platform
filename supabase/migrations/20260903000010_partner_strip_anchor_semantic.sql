-- Overlay partner-strip anchor semantic flip.
-- ------------------------------------------------------------------
-- Bootstrap math is changing from "canvas-coordinate" to "direct offset
-- from anchor edge" for partner-strip layout positioning. Translate
-- existing saved rows so the rendered position stays byte-identical:
--
--   bottom-* anchor: stored py was Y-from-canvas-top → flip to
--                    Y-from-canvas-bottom (1080 - py).
--   *-right  anchor: stored px was X-from-canvas-left → flip to
--                    X-from-canvas-right (1920 - px).
--
-- top-* and *-left + middle / *-center semantics were already
-- direct-offset so they're untouched.
--
-- Idempotent guard: only flips rows where the stored value is consistent
-- with the OLD semantic (e.g. py > 540 for bottom anchor means likely
-- canvas-coord, not a direct-offset > 540 from the bottom edge which is
-- nonsensical when the canvas is 1080 tall).

update public.overlay_partner_strip_layout
set position_y_px = 1080 - position_y_px,
    updated_at = now()
where anchor in ('bottom-left', 'bottom-center', 'bottom-right')
  and deleted_at is null
  and position_y_px > 540;

update public.overlay_partner_strip_layout
set position_x_px = 1920 - position_x_px,
    updated_at = now()
where anchor in ('top-right', 'middle-right', 'bottom-right')
  and deleted_at is null
  and position_x_px > 960;
