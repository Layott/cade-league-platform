# Lessons Learned

Append patterns after any correction from the user. Keep each entry short: what I did wrong, what to do instead, why.

## Template

```
**Date:** YYYY-MM-DD
**Context:** (what was happening)
**Mistake:** (what I did)
**Correction:** (what the user said or preferred)
**Rule for future:** (concrete behavior change)
```

## Entries

**Date:** 2026-04-20
**Context:** Scaffolding Next.js via `create-next-app` during Plan 0 Task 3.
**Mistake:** Ran `npx --yes create-next-app@latest apps/web ... --yes` before creating the `apps/` parent dir; got "The application path is not writable". Also double `--yes` (npx-level + scaffolder-level) is ambiguous.
**Correction:** `mkdir -p apps` first; drop trailing `--yes`; pin version (`create-next-app@15`).
**Rule for future:** Before running any scaffolder that takes a target subpath, ensure the parent dir exists. Pin major versions of scaffolders — `@latest` bites on Node version mismatches.

---

**Date:** 2026-04-20
**Context:** Linking Supabase CLI to a cloud project during Plan 0 cloud adaptation.
**Mistake:** Assumed `supabase login` in the user's terminal would propagate auth to my shell. Link command kept failing with "Access token not provided" because the stored token location wasn't reachable in this shell environment.
**Correction:** Use a Personal Access Token from https://supabase.com/dashboard/account/tokens and pass via `SUPABASE_ACCESS_TOKEN` env var — deterministic across shells. Also always pass `SUPABASE_DB_PASSWORD` inline for non-interactive `supabase link`.
**Rule for future:** For Supabase CLI ops in this environment, always export both `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` inline; don't rely on interactive `supabase login` completed elsewhere.

---

**Date:** 2026-04-20
**Context:** Writing the `audit_smoke.sql` self-test during Plan 0 Task 7.
**Mistake:** Initially included a cleanup step that ran `DELETE FROM public.audit_events WHERE ...` at the end of the smoke test. But the append-only trigger on audit_events blocks all UPDATE and DELETE, so the smoke test would have failed on its own cleanup.
**Correction:** Removed the cleanup. Audit rows persist tagged with `request_id = req-smoke-*` and can be filtered out of reports.
**Rule for future:** When designing tests that touch append-only tables, tag test data so reports can exclude it — never try to delete it.
