-- 2026-05-04 — drop NOT NULL on futbin_screenshot_path. Player squad form
-- no longer collects a screenshot at submission time; the column stays so
-- existing rows + the admin review workflow keep working, but new rows can
-- now omit it.
alter table public.squad_submissions
  alter column futbin_screenshot_path drop not null;
