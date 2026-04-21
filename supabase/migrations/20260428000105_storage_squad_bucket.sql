-- Plan 10 — private storage bucket for Futbin screenshots.
-- Read/write mediated by server-side signed URLs (service role). No RLS
-- policies attached in Phase 1B; the public flag is explicitly false.
insert into storage.buckets (id, name, public)
values ('squad-screenshots', 'squad-screenshots', false)
on conflict (id) do nothing;
