-- Plan 39 hardening (2026-04-28) — server-side size + MIME caps for every
-- storage bucket. Until now several private buckets (squad-screenshots,
-- match-stat-screenshots, org-cac-certs, org-contracts, dispute-evidence,
-- appeal-evidence) had `file_size_limit = NULL` and
-- `allowed_mime_types = NULL`, so a caller holding a signed PUT URL could
-- upload an arbitrarily-large file of any MIME type — an egress + storage-
-- cost vector for any authenticated user (writes are admin-perm-gated for
-- some, player-perm-gated for others).
--
-- Caps below match the per-action size checks already present where they
-- exist (overlay-assets at 10MB image / 100MB video, OCR at 10MB image),
-- and add new caps where none existed. They are bucket-policy defense-in-
-- depth; the per-action checks remain authoritative for friendly clients.

-- Player-submitted screenshots (Futbin proof). Image only, 10MB.
update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/png','image/jpeg','image/webp']::text[]
 where id = 'squad-screenshots';

-- Plan 14 OCR screenshots. Image only, 10MB.
update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/png','image/jpeg','image/webp']::text[]
 where id = 'match-stat-screenshots';

-- Org CAC + contracts. PDFs + images, 25MB.
update storage.buckets
   set file_size_limit = 25 * 1024 * 1024,
       allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp']::text[]
 where id in ('org-cac-certs','org-contracts');

-- Dispute / appeal evidence. Mixed media, 25MB.
update storage.buckets
   set file_size_limit = 25 * 1024 * 1024,
       allowed_mime_types = array[
         'application/pdf',
         'image/png','image/jpeg','image/webp','image/gif',
         'video/mp4','video/webm','video/quicktime',
         'text/plain'
       ]::text[]
 where id in ('dispute-evidence','appeal-evidence');

-- Public org logos. Image only, 5MB.
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml']::text[]
 where id = 'org-logos';

-- Brand-settings logos (Plan 47). Image only, 5MB.
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml']::text[]
 where id = 'brand-logos';

-- overlay-assets already capped per its own bucket creation migration
-- (Plan 48). Re-assert here to keep the policy in one place.
update storage.buckets
   set file_size_limit = greatest(coalesce(file_size_limit, 0), 100 * 1024 * 1024),
       allowed_mime_types = coalesce(
         allowed_mime_types,
         array['image/png','image/jpeg','image/webp','video/mp4','video/webm']::text[]
       )
 where id = 'overlay-assets';
