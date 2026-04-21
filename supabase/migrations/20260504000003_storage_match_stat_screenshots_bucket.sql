-- Plan 14 — private storage bucket for match stat screenshots.
--
-- Private (public=false); all access is server-side via service role through
-- signed URLs (matches squads/storage.ts pattern). No bucket-level policies
-- in Phase 1B — we treat the API layer as the sole gatekeeper.
insert into storage.buckets (id, name, public)
values ('match-stat-screenshots', 'match-stat-screenshots', false)
on conflict (id) do nothing;
