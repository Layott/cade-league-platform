-- Plan 26b — correct cloud match_day dates to actual Sat/Sun calendar.
-- Run order avoids collisions: each old date freed before reuse.
update public.match_days set match_date = '2026-05-03' where match_date = '2026-05-04' and deleted_at is null;
update public.match_days set match_date = '2026-05-09' where match_date = '2026-05-10' and deleted_at is null;
update public.match_days set match_date = '2026-05-10' where match_date = '2026-05-11' and deleted_at is null;
update public.match_days set match_date = '2026-05-16' where match_date = '2026-05-17' and deleted_at is null;
update public.match_days set match_date = '2026-05-17' where match_date = '2026-05-18' and deleted_at is null;
update public.match_days set match_date = '2026-05-30' where match_date = '2026-05-25' and deleted_at is null;
