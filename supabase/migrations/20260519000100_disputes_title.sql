-- Player dispute-submit rework: short Title summary alongside the uuid subject_id.
-- `subject_id` stays as the uuid pointer to match / sanction (populated by
-- dropdown picker on the client). `title` is the human-readable <=200 char
-- summary the raiser writes.

alter table public.disputes
  add column if not exists title text;

-- Soft backfill for any pre-existing rows so admin UI isn't empty.
-- Truncate existing description to 200 chars as a placeholder title.
update public.disputes
  set title = left(description, 200)
  where title is null;
