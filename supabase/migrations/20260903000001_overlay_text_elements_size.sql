-- Overlay design system — size axis for text/image elements.
-- ------------------------------------------------------------------
-- Adds nullable `width_px` + `height_px` to `overlay_text_elements` so
-- the admin design panel can resize image-kind elements (sponsor-logo-
-- floating, sponsor-logo-strip, image, bg-image) without a redeploy.
-- Same plumbing serves text elements that need a hard width cap (e.g.
-- caption wrap point).
--
-- Range gates: 1..2000 px each. NULL = "inherit author CSS size".
-- Bootstrap rule emits `width:Npx; height:Npx` declarations alongside
-- the existing left/top/zIndex/opacity rules — image kinds adopt the
-- new sizes; text kinds get a max-width clamp.
--
-- No behavior change for existing rows (both columns default NULL).

alter table public.overlay_text_elements
  add column if not exists width_px  integer,
  add column if not exists height_px integer;

alter table public.overlay_text_elements
  drop constraint if exists overlay_text_elements_width_px_range;
alter table public.overlay_text_elements
  add constraint overlay_text_elements_width_px_range
    check (width_px is null or (width_px between 1 and 2000));

alter table public.overlay_text_elements
  drop constraint if exists overlay_text_elements_height_px_range;
alter table public.overlay_text_elements
  add constraint overlay_text_elements_height_px_range
    check (height_px is null or (height_px between 1 and 2000));

comment on column public.overlay_text_elements.width_px is
  'Optional CSS width in px (1..2000). NULL leaves author width untouched.';
comment on column public.overlay_text_elements.height_px is
  'Optional CSS height in px (1..2000). NULL leaves author height untouched.';
