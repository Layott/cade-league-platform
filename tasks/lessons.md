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

---

**Date:** 2026-04-20
**Context:** Plan 1 Task 14 — E2E login test failed with "Forbidden" after admin credentials entered.
**Mistake:** Wrote RLS policy `user_roles_no_direct` blocking ALL client access to user_roles. Middleware uses the user's JWT client (not service role) so it couldn't read own roles to decide admin/moderator gating.
**Correction:** Added migration 007 replacing the policy with `user_roles_self_select` (allows user to read own rows) + separate `_no_write/_no_update/_no_delete` policies (blocks direct mutations). Writes still happen server-side via service role.
**Rule for future:** When designing RLS policies, think about EVERY real read path — including middleware that runs with the user's JWT. "server-managed only" doesn't mean "deny all reads" if the middleware itself is a legitimate read client.

---

**Date:** 2026-04-20
**Context:** Scaffolding Next.js 15 pages that accept `searchParams`.
**Mistake:** Typed `searchParams` as a plain object `{ error?: string }`. Next.js 15 passes `searchParams` as a `Promise<...>` in async Server Components.
**Correction:** Type it as `Promise<{...}>` and `await searchParams` at top of the component.
**Rule for future:** In Next.js 15, both `params` and `searchParams` are Promises in async Server Components. Always await them.

---

**Date:** 2026-04-26
**Context:** Plan 6 — adding `isomorphic-dompurify` for markdown sanitization; `next build` failed with `ENOENT: default-stylesheet.css` during "Collecting page data" for every route that transitively imported DOMPurify.
**Mistake:** Assumed any npm package could be bundled by webpack. `isomorphic-dompurify` pulls in `jsdom`, which loads its own `default-stylesheet.css` asset from `node_modules/jsdom/lib/jsdom/browser/` at runtime. When Next bundles jsdom into `.next/server/chunks/*`, the CSS asset path no longer resolves.
**Correction:** Add `serverExternalPackages: ["isomorphic-dompurify", "jsdom"]` to `next.config.ts` so these packages stay in `node_modules` at runtime instead of being bundled.
**Rule for future:** Any server-side dependency that ships non-JS assets (CSS, WASM, data files) it loads at runtime needs to go in `serverExternalPackages`. When `next build` fails with ENOENT on a file inside a package's own tree, this is the first thing to check.

---

**Date:** 2026-04-26
**Context:** Plan 6 — writing Supabase table join mocks for `expandAudience` tests; then typechecking the real implementation.
**Mistake:** Used `as { ... }[]` direct cast on Supabase `.select("a:table(col)")` results. TypeScript infers the join as `{ a: { col: any }[] }[]` (array), so a cast to `{ a: { col: string } | null }[]` (object) fails with TS2352 "neither type sufficiently overlaps".
**Correction:** Go through `unknown` first: `as unknown as { a: { col: string } | null }[]`. The supabase-js types don't currently express "to-one" vs "to-many" joins.
**Rule for future:** For Supabase join result casts, use `as unknown as <shape>` rather than direct `as <shape>` — the inferred types assume many-side unless a typed client/codegen says otherwise.

---

**Date:** 2026-04-20
**Context:** Plan 7 Part B — running `next build` while a `next dev` server (plus playwright's webServer on another port) was still running.
**Mistake:** `next build` writes a production artifact to `.next/`, overwriting the dev server's manifest files. Subsequent requests to the dev server returned 500 with `Cannot find module '.next/server/middleware-manifest.json'`. E2E tests interpreted this as an SSR code bug.
**Correction:** Never run `next build` while a dev server (including Playwright's `webServer`) has `.next/` open. If you must, kill the dev server first OR wipe `.next/` and restart after the build. In CI the point is moot — `reuseExistingServer: !CI` ensures Playwright always starts fresh.
**Rule for future:** Before running `next build`, check `ps` for any `next dev` processes using the same `.next/`. If present, either skip the build, run in a fresh worktree, or `rm -rf .next && restart dev`.

---

**Date:** 2026-04-21
**Context:** Mid-Plan 9 kickoff. User asked for checkpoints on "approve to proceed?" + "paste rulebook values?".
**Mistake:** Deferred to user for things I could have done myself — approvals I was already authorized to act on, and a file extraction I could script.
**Correction:** "Never ask me for something if it's something you can do yourself."
**Rule for future:** When the user has given a clear directive ("continue building, spin up agents, move fast"), DO NOT re-request permission for each sub-step. Also, never dead-end on a file format barrier (.docx, .pdf, .xlsx) — convert it with pandoc / python-docx / pdftotext / openpyxl myself and proceed. Only ask the user when a decision genuinely requires human judgement or external knowledge (org policy, budget, credentials), never for execution mechanics I can resolve with a tool.

---

**Date:** 2026-04-21
**Context:** Extracting rulebook tables for Plan 11 ladder. python-docx reported rows 2-5 of the Late Arrival table as literal `''`. I flagged them as "blank in source — needs LOC input".
**Mistake:** Trusted python-docx output blindly. User corrected with screenshots of the rendered docx — rows 2-5 actually have values. python-docx splits on page-break-in-table and returns one empty row per split; the real content lives in a sibling table element further down the `doc.tables` array.
**Correction:** User: "there's information there you can't see?" — I'd already escalated to them for something I should have debugged.
**Rule for future:** When python-docx returns empty cells in a table that HAS visible content in the rendered file, do NOT flag it as "missing data". Instead: (a) iterate every `doc.tables` entry, not just the one whose header matches — a split table appears as 2+ tables; (b) try `pymupdf`/`fitz` on a PDF export of the docx; (c) use Python's `zipfile` to unpack the raw `word/document.xml` and regex-grep the rows. Only escalate to the user AFTER those three paths fail. And never stage a "blocked on external input" status before exhausting extraction alternatives.

---

**Date:** 2026-04-21
**Context:** Plan 12 TDD tests failed on load with "Cannot access 'publishMock' before initialization".
**Mistake:** Wrote `const publishMock = vi.fn()` at module top then `vi.mock("./realtime", () => ({ publish: publishMock }))`. Vitest hoists `vi.mock` above imports (and above the `const`), so at mock-factory time the closure reference to `publishMock` is still in the temporal dead zone.
**Correction:** `const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }))` lifts the mock object to the same hoist band as `vi.mock`. Then the factory closes over a real value.
**Rule for future:** Any mock factory that references a module-level vi.fn/spy needs `vi.hoisted`. If a test errors with "Cannot access X before initialization" where X is a mock const, that's the fix.

---

**Date:** 2026-04-21
**Context:** Plan 12 overlay pages failed `next build` with "useSearchParams() should be wrapped in a suspense boundary".
**Mistake:** Client components that call `useSearchParams()` force a CSR bailout during prerender even with `export const dynamic = "force-dynamic"`. Next.js 15 still attempts to resolve the page shell at build time.
**Correction:** Export the page as `() => <Suspense fallback={null}><Inner /></Suspense>` and put `useSearchParams` in `Inner`.
**Rule for future:** Any Client Component page that reads `useSearchParams` in Next.js 15 must be wrapped in a Suspense boundary at the page root. `force-dynamic` alone is not enough.

---

**Date:** 2026-04-21
**Context:** Plan 12 overlay route group. Root `app/layout.tsx` wraps every page in `<SiteChrome>`; a route group's `layout.tsx` inherits from the root, cannot replace html/body, cannot remove the parent wrapper.
**Mistake:** Initially tried to rely on only the route-group layout to strip chrome. Chrome rendered anyway.
**Correction:** Two-sided fix. (1) Extend `SiteChromeClient.HIDDEN_PREFIXES` with `/overlay` so the client chrome self-hides on that URL prefix. (2) In the route-group layout, a client `useEffect` adds `.overlay-mode` to `<html>` + `<body>` so `html.overlay-mode { background: transparent !important }` rules in `globals.css` zero out the backgrounds.
**Rule for future:** Root layout is load-bearing — route groups cannot unlayer it. To opt specific paths out of global chrome, patch the chrome component's HIDDEN list AND use a classname-driven CSS override for body-level styling. Don't fight Next.js conventions by trying to move html/body into a child layout.

---

**Date:** 2026-04-21
**Context:** Executing Plan 12 while parallel agents were landing Plans 10/11/13/14. `npm run build` broke on an attendance `flatLadder` export that didn't exist in the snapshot I saw, and `npm run test` had 22 failures in orgs/disputes/appeals modules.
**Mistake:** Initially tried to verify the full wave before claiming Plan 12 complete. Spent time diagnosing failures that were in other agents' unfinished code.
**Correction:** Per CLAUDE.md "parallel agents are churning files" rule: checkpoint my own work, verify my slice in isolation (`vitest run src/server/broadcast src/server/overlays src/perms.seed.test.ts`), commit + push, and document the wave-level verification gap in the review.
**Rule for future:** When other agents are mid-commit on adjacent code, run targeted `vitest run <my-paths>` + `tsc --noEmit <my-paths>` rather than the monorepo-wide commands. Full wave verification is a separate pass once the churn settles. Document the gap explicitly in the plan review so nothing gets lost.
