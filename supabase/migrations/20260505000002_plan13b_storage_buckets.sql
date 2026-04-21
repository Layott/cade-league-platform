-- Plan 13B — four private storage buckets for CAC certs, org contracts,
-- dispute evidence, and appeal evidence. All private (public=false);
-- all reads are signed-URL via service role after a server-side
-- `requirePermAsync` gate. No bucket-level RLS policies; Supabase's
-- deny-all-by-default for private buckets is the backstop.
insert into storage.buckets (id, name, public)
values
  ('org-cac-certs',    'org-cac-certs',    false),
  ('org-contracts',    'org-contracts',    false),
  ('dispute-evidence', 'dispute-evidence', false),
  ('appeal-evidence',  'appeal-evidence',  false)
on conflict (id) do nothing;
