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
