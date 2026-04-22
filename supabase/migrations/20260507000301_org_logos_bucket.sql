-- Plan 31 — `org-logos` storage bucket.
-- Public-read so org logos can be served straight from CDN without a
-- signed-URL round trip on every page render. Server-write only — uses
-- the Plan 13B signed-upload pattern via service-role client.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;
