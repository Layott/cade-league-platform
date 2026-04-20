-- Public /players page needs to join public.users (for display_name).
-- Add a public-read policy scoped to non-deleted rows. Phase 1A users table
-- holds only display_name, email, phone, failed_login_count; none are secrets
-- for the league context. When NIN/bank columns land in Phase 1B, tighten
-- with column-level grants + a separate PII view.

create policy users_public_select
  on public.users for select
  using (deleted_at is null);
