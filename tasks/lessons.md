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

**Date:** 2026-04-24
**Context:** User asked for end-to-end notification system ("No in-app notification, no email — the player has to notice the status change themselves"). While implementing, parallel agents repeatedly overwrote my edits to `/admin/{disputes,appeals,squads,punishments}/[id]/actions.ts` + `components/public/SiteChrome.tsx`. First attempt used `git stash`/`git stash pop` to checkpoint while verifying the build — pop left the files mid-overwrite because the parallel agent had moved on, so my notify() integrations silently vanished from 4 files and I would have shipped the UI without any real write-path wiring.
**Mistake:** Used `git stash` around parallel-agent churn. Stash-pop conflicts resolve silently by preferring the on-disk version, so agent churn during the stash window eats your stashed lines. Also: dev server on a given port blocked by stale `.next` + another dev instance, and killing next dev on Windows via pkill doesn't always free the port — had to switch to a new port number.
**Correction:** Restore pattern when parallel agents are editing files you depend on: DO NOT stash — read the current on-disk state after every agent update, re-apply your diff with an Edit tool so the patch is conflict-aware per line, and re-verify by `grep -c "notify("` on each touched file before committing. If a dev server port is blocked on Windows, just bump the port (e.g. 3030 → 3040); don't burn minutes chasing stale processes.
**Rule for future:**
1. When CLAUDE.md or the user brief names files another agent is actively writing, NEVER `git stash`. Treat it like a live-branch rebase: grep-verify each expected hook-in still exists after any agent ping, re-Edit if it's been reverted.
2. Verify `.env.local` has the expected var KEYS present (`RESEND_API_KEY`, etc.) but do NOT assume they're populated. Wrappers like `apps/web/src/lib/email/resend.ts` already handle empty key by stub-printing — don't fake env values or commit placeholders.
3. Commit per phase (migration → server module → integrations → UI) so a parallel-agent collision at any one phase doesn't lose every prior phase of work.
4. For post-deploy smoke, use a short `_smoke_*.mjs` that loads `.env.local`, creates a service-role client, does one INSERT + one read + one soft-delete — takes 15 s, exercises the real cloud DB, catches RLS regressions that unit tests with mocked Supabase can't. Always `rm` the smoke file after the run so it doesn't get committed.

**Date:** 2026-04-24
**Context:** After commit `55bfadf` fixed three phantom-column bugs under `(auth)/profile/page.tsx` + `server/overlays/autofill.ts` (`disciplinary_actions.player_id|issued_at|disciplinary_case_id` + `appeals.disciplinary_action_id`), user asked for a codebase-wide audit. I parsed all 117 migrations into a `{table → Set<col>}` + FK map, scanned all 513 in-scope `.from("<table>")` chains, and found 6 residual phantom-column bugs the first pass missed. Root cause category: developer wrote field names from memory, got them plausibly-wrong (`rank` vs. assigned-from-sort-order, `games_played` vs. `matches_played`, `disciplinary_action_id` vs. `disciplinary_case_id` — the column that actually IS on `appeals`).
**Mistake:** Vitest mocks don't catch phantom columns because the stub returns whatever the test pretends Supabase returned. So `select("rank, points")` on `standings` passed all unit tests but blew up at runtime against the real DB. Same for `select("games_played, ...")` on `standings` (actual col is `matches_played`), and for `.select("disciplinary_action_id, status").in("disciplinary_action_id", ...)` on `appeals` (FK col is `disciplinary_case_id` — appeals link to cases, not actions). Also in `(auth)/profile/page.tsx` the earlier fix left an `alreadyAppealed` lookup still indexing by sanction.id when it should index by sanction.disciplinary_case_id — silently marking nothing appealed.
**Correction:**
- Files touched (commit TBD):
  - `apps/web/src/app/(auth)/profile/page.tsx` — L154-185: appeals query selects `disciplinary_case_id, status`; filter is `.in("disciplinary_case_id", caseIds)` where `caseIds = unique sanction.disciplinary_case_id`; `alreadyAppealed` uses `appealedCaseIds.has(s.disciplinary_case_id)`. Short-circuits when caseIds is empty so the `.in("", [])` no-op doesn't round-trip.
  - `apps/web/src/server/overlays/autofill.ts` — `buildStandingsWidgetPayload`: dropped `rank` from select + order; now orders by `(points desc, goal_difference desc, goals_for desc)` and assigns `rank: i + 1` in the JS mapper. `buildPlayerCardPayload` + `buildLowerThirdPayload`: renamed `games_played` → `matches_played` in select string + typed row + mapper output.
  - `apps/web/src/server/overlays/autofill.test.ts` — updated `buildStandingsWidgetPayload` test fixture + assertions to match the new sort-derived rank (removed `rank` from stub rows, added `goals_for`, kept `rank: 1` assertion on the derived output).
  - `apps/web/src/server/overlays/leaderboard_data.ts` — fixed the stale doc comment that claimed `standings` "historically had a `rank` column".
- Audit coverage: 513 Supabase `.from("<table>")` chains across 147 in-scope files (excludes `app/admin/broadcast/**`, `components/broadcast/**`, `(overlay)/overlay/**`, `server/broadcast/**`, `components/squads/SquadPitch*`, `app/player/squad/**`, `app/admin/squads/[id]/**`, `app/players/[id]/page.tsx`, `server/squads/list.ts` — all owned by parallel agents). Zero remaining bugs after fix.
- Full report: `docs/superpowers/specs/2026-04-24-phantom-column-audit.md`.
**Rule for future:**
1. Every new Supabase query MUST pair-check the column names against the migration that created / altered the table. If a column is wrong, lint/type-check + unit tests won't save you because the Supabase-js client types are `any`-ish and vitest mocks echo your own typing back.
2. Maintain a pre-commit script that parses `supabase/migrations/*.sql` into a schema map, enumerates every `.from("<tbl>")` in `apps/web/src/**`, and validates `.select()` / `.eq()` / `.order()` / `.insert()` / `.update()` columns against that map. Tools: `tmp_parse_schema.mjs` + `tmp_audit_queries.mjs` built during this audit — should be productized as `scripts/audit-schema.mjs` + wired into CI. An ALTER TABLE parser must handle comma-separated multi-column ADD COLUMN (`alter table public.x add column a ..., add column b ...`) — the naive regex `ALTER\s+TABLE.+ADD\s+COLUMN\s+(\w+)` misses siblings.
3. Standings table has NO `rank` column — every standings display MUST compute rank locally from `(points desc, goal_difference desc, goals_for desc)` order. Anyone writing new standings code should read this lesson first. "games_played" is called `matches_played`.
4. Appeals link to `disciplinary_cases` via `disciplinary_case_id`, NOT to `disciplinary_actions`. "Already appealed" semantics apply per-case, not per-sanction: all sanctions in a case share the appeal. When indexing an appealed-set, index by case_id and look up via `sanction.disciplinary_case_id`.
5. When an earlier commit fixes a phantom-column bug under one call site, grep the codebase for every related call site in the same slice. 3 files had the same bug family (profile + players/[id] + autofill) and only 2 got fully fixed in `55bfadf` — `appeals.disciplinary_action_id` was introduced NEW by that same commit's rewrite because the old `sanctions.map(s => s.id)` pipe was preserved.

---

**Date:** 2026-04-24
**Context:** Plan 42.3 shipped a standalone `BroadcastPreviewGrid` mini-iframe grid BELOW the broadcast trigger controls. User pointed out "the live previews should be with the controls, so you can see changes take effect" — the grid being on a separate row meant operators had to scroll to see the effect of every trigger. Also flagged a browser console error on `/admin/broadcast/[sessionId]`: `In HTML, <form> cannot be a descendant of <form>. at form (OffTriggerButton.tsx:83), at EditableTemplatePanel.tsx:306`.
**Mistake:** (1) Built the preview grid as a sibling section on the page instead of embedding each preview in its own control panel. Scannable global grid vs. in-context preview is a UX regression for live operators who need tight OODA loops between action and visual feedback. (2) `OffTriggerButton` renders its own `<form action=clear*Action>`. `EditableTemplatePanel` dropped it INSIDE the outer Edit & trigger `<form action=triggerOverlayAction>`. Browser auto-breaks the inner form out of the outer one during hydration — which broke other form listeners on the page until React recovered. The nested-form hydration warning was silenced in the existing E2E spec instead of fixed at the source.
**Correction:** (a) Extracted `OverlayMiniPreview` into its own component at `apps/web/src/components/broadcast/OverlayMiniPreview.tsx`. Mounted it INSIDE every `EditableTemplatePanel` (slot-capable templates get two tiles side-by-side, others get one) and INSIDE every legacy `trigger-card-*`. Removed the standalone `<BroadcastPreviewGrid>` mount + file. (b) Restructured `EditableTemplatePanel` so the OffTriggerButton is rendered as a SIBLING of the trigger `<form>`, not a descendant: both live inside a common `<div class="space-y-2">`. 91 forms on the broadcast page, zero nested — verified live via Chrome console + `document.querySelectorAll('form').filter(f => f.parentElement?.closest('form'))`.
**Rule for future:** (1) For any live-operator admin surface, embed the visual feedback in the SAME card as the control that changes it. Never put controls and feedback in separate vertical sections. (2) Whenever a component renders its own `<form>`, its PARENT callers must be audited — `grep -r "<ComponentName"` + check each enclosing JSX for `<form>`. HTML's "form inside form" is a hard constraint; lint rules don't catch it because JSX structure isn't HTML structure. Add a test: `document.querySelectorAll('form').filter(f => f.parentElement?.closest('form'))` should be empty on every admin page with multiple form buttons. (3) When an E2E spec filters out a warning via `if (lower.includes('hydration')) return false` — that's a TODO, not a pass. File a follow-up bug in the same commit.

---

**Date:** 2026-04-24
**Context:** Player-profile `/players/[id]` was rendering the submitted squad as a `<ul>` of text rows. Same for `/player/squad` existing-summary and `/admin/squads/[id]` (items table only — no pitch). User asked that submitted squads render Futbin-style on-pitch, mirroring the picker.
**Mistake:** Plan 30 built a polished Futbin picker (`SquadPickerBuilder` + `PitchLayout` + `FutCard`) but the read-only read surfaces duplicated the picker's layout data in plain-text form. Anyone browsing a player's profile saw a text dump instead of the squad image they submitted.
**Correction:** Extracted a reusable `SquadPitchView` that reuses `FutCard` + `PitchLayout`'s formation catalog. Extended `SquadItemRow` with an optional `fc_player` join off `resolved_fc_player_id` so the pitch cards can render Futbin CDN frame + portrait art when available, falling back to rating-band tiles for dormant / unresolved rows. Normalized the Supabase-js embed shape (array-or-single) once in `list.ts` so callers never have to array-check.
**Rule for future:** When adding a picker / builder surface for a domain object, always ship the matching READ-ONLY visualizer in the same slice. One-way "fancy input, plain text output" is a smell — read surfaces are seen 10x more than write surfaces. Any picker that stores slot/coordinate-shaped data deserves a `*View` companion that renders with the same visual vocabulary.

---

 Rows DID exist in `disciplinary_actions` (19 total confirmed via service-role diag) and the user's display_name + user_id were populated — so the earlier hypothesis that the `users:users!players_user_id_fkey!inner` embed was dropping rows was wrong.
**Mistake:** The admin page + public page + detail page were reading via `getServerSupabase()` (authenticated cookie client). Plan 39 C3 migration `20260508000002_plan39_business_table_rls.sql` enabled RLS on `disciplinary_actions` with a deny-all policy for `anon` + `authenticated`. Service-role bypasses RLS, but the page-level callers weren't using it. Result: admin authenticated as `admin@cade.local` sees zero rows even though the table has 19.
**Correction:** Switched the three list-page entry points — `/admin/punishments/page.tsx`, `/admin/punishments/[id]/page.tsx`, `/punishments/page.tsx` — to `getServiceRoleSupabase()`. Admin routes are gated by middleware; public `listPublic` filters `public_visible + !revoked + !deleted`. Added `revalidatePath` for `/admin/punishments`, `/punishments`, `/players/[id]` in every issue/revoke/update/delete server action.
**Rule for future:** When a migration enables RLS on a table, grep the codebase for page-level callers (`getServerSupabase()` + `.from('<table>')`) and swap them to service-role OR add a permissive SELECT policy. `CLAUDE.md` §4 says "RLS on PII + financial tables only" — but Plan 39 expanded that to 6 business tables. Any new RLS migration needs a callers-audit commit in the same slice.

---

**Date:** 2026-04-24
**Context:** Writing Vitest tests for a fn that uses `z.string().uuid()` schema validation.
**Mistake:** Used UUID strings like `00000000-0000-0000-0000-000000000001` in test fixtures. Zod v4 rejects these as NOT matching the v4 UUID grammar — the fourth group needs a leading `[89ab]` nibble, and there's a special nil-UUID case `00000000-0000-0000-0000-000000000000` allowed but my fixture used `...000000000001` which is neither nil nor v4.
**Correction:** Use clearly v4-shaped strings like `11111111-1111-4111-8111-111111111111` (version nibble = 4, variant nibble = 8). Or use `randomUUID()` from `node:crypto`.
**Rule for future:** Any `z.string().uuid()` schema in a test fixture must either (a) use a real `randomUUID()` value, (b) match v4 grammar explicitly, or (c) be the all-zero nil UUID. Never try to "obvious fake" UUIDs like `...000000000001`.

---

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

**Date:** 2026-04-22
**Context:** User hit a runtime stack-trace crash creating a match day on a date that already had one. Asked "why didn't your tests catch this bug?"
**Mistake:** Server-action unit tests mock Supabase entirely → real DB constraints (unique, FK, NOT NULL, RLS) never fire in test. E2E only covered the happy path with a fresh date — never the conflict. So the unhappy server-action path (DB throws → action doesn't catch → Next.js shows raw stack trace) was completely uncovered.
**Correction:** Added `apps/web/src/app/admin/match-days/new/actions.test.ts` covering 4 paths: success, duplicate-date Postgres unique violation, no-active-season, generic create-failed. Each asserts action calls `redirect()` with the expected error querystring.
**Rule for future:** Every server action that touches the DB must have a unit test for at least: (a) success path, (b) DB-error path with mocked rejection mimicking the real Postgres error message (`unique constraint "..."`, `foreign key constraint "..."`, `not-null`, `permission denied`), (c) any input-validation rejection path. Mocked Supabase = mocked happy path; only EXPLICIT mocked rejections cover the unhappy paths users actually hit.

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

---

**Date:** 2026-04-22
**Context:** Plan 39 C2 revoked table-wide SELECT on `public.users` and re-granted column-level SELECT on only (id, display_name, created_at, updated_at, deleted_at) to anon/authenticated. User reported "the ui has gone to shit." Landing `/` + `/players` returned 500; PostgREST returned `42501 permission denied for table users` on anon reads of players, disputes, and user_roles.
**Mistake:** C2 migration focused on direct column access to users but missed the ripple: every RLS policy scoped to PUBLIC (`{-}`) that subqueries `users.supabase_auth_id` is a plan error for anon once that column loses its grant. Postgres evaluates every permissive policy (no short-circuit across OR'd subquery policies), so even when a cheaper policy (`public_read WHERE deleted_at IS NULL`) would grant the row, the expensive subquery policy's plan fails first → 42501.
**Correction:** New migration `20260508000004_plan39_scope_self_policies_to_authenticated.sql` rescopes `players_self_read_any`, `players_self_update`, `disputes_self_read`, `user_roles_self_select`, `content_posts_self_read` from `TO PUBLIC` to `TO authenticated`. Anon's `auth.uid()` is NULL so the predicate never matched — narrowing is semantically identical and removes anon from the plan.
**Rule for future:** Any migration that revokes column-level SELECT grants on a PII-heavy table must FIRST grep all RLS policies referencing those columns (`pg_get_expr(polqual, polrelid) like '%<col>%'`) and, for each `{-}`-scoped policy that reads a now-revoked column in a subquery, pre-emptively scope it to `authenticated`. Also add an anon-smoke test to CI: `curl -H "apikey: <anon>" /rest/v1/<each_public_table>?select=id&limit=1` — must return 200 or empty array, never 42501.

---

**Date:** 2026-04-23
**Context:** Auditing `fc26_players` to count Futbin-enriched rows. Audit script filtered on `source_dataset='futbin.com'` and reported ~5k Futbin rows. Actual enriched row count was 20,373 — the scraper's upsert path had a slug+rating fallback that merged Futbin data INTO existing `source_dataset='kaggle'`/`'fut.gg'` rows rather than inserting new `futbin.com` rows. Briefly concluded 15k rows were lost.
**Mistake:** Treated `source_dataset` as the source of truth for "does this row have Futbin data?". It isn't — it's provenance of the row's FIRST insert. When an upsert path merges data from source B into a row originally from source A, the label stays A even though the row now carries B's fields.
**Correction:** Re-ran the audit filtering on semantic presence of the enrichment itself — `attributes->>'futbin_resource_id' IS NOT NULL` — which correctly returned 20,373. Then migrated those rows back to `source_dataset='futbin.com'` and removed the merge fallback from all 5 scrapers (commit `983cb2a` audit scope fix, separate migration commit for the data move).
**Rule for future:** When verifying that data was written, filter on the semantic presence of the data itself (a column/key the writer sets), not on a provenance label that may predate the write. If the ingest path has any in-place-merge fallback, the provenance label is lossy. Before panicking about "missing" rows, run a semantic-presence check (e.g. `attributes->>'<known_key>' IS NOT NULL`, or `LENGTH(image_url) > 0`) across ALL `source_dataset` values, not just the expected one.

---

**Date:** 2026-04-23
**Context:** `fc26_players.item_type` classifier used regex `/^(gold|silver|bronze|rare|common|normal)$/` exact-match on the Futbin `variant` string. Upstream started emitting numeric-prefixed labels like `0-silver`, `3-gold`, `12-bronze`, and those fell through to the default branch `item_type='special'`, inflating the special count.
**Mistake:** Exact-match regex against external-source labels. Treated the upstream's label shape as stable without testing the regex against a sample of the real data distribution.
**Correction:** Widened to `/^(\d+-)?(gold|silver|bronze|rare|common|normal)$/` for the base tiers, and added word-boundary `\b` checks for icon/toty/tots/hero/rttf so prefix/suffix variants route correctly. Shared the classifier in `KNOWLEDGE/extracted/_classify_variant.js` so all scrapers + ingest scripts import the same logic (commit `518be6b`).
**Rule for future:** Never use `^X$` exact-match regex on labels emitted by an external source. Always allow for common prefix/suffix drift (`(\d+-)?`, `-v\d+$`, trailing whitespace, Unicode normalization). Before shipping a classifier, run it across a representative sample of real data and assert the "default/special/unknown" bucket count is below a sanity threshold (e.g. <5%). If the default bucket explodes, the regex is wrong — don't trust that the classifier is correct just because no row errored.

---

**Date:** 2026-04-23
**Context:** Futbin card-frame CDN (`cdn3.futbin.com/content/fifa26/img/cards/tiny/`) is an imgix source enforcing HMAC-signed URLs (`?fm=png&ixlib=...&s=<HMAC>`). I shipped a FutCard client fallback + `_backfill_card_bg.js` that synthesised unsigned URLs like `.../1_gold.png`. All 20,424 rows got `sig_invalid` when the browser fetched them; picker showed black boxes.
**Mistake:** Treated the URL as path-addressable after grepping a static HTML snippet. Didn't notice the snippet already had `?s=<hmac>` attached — bare URLs are rejected.
**Correction:** `_revert_card_bg_backfill.js` cleared all 20,424 unsigned URLs. Removed the client synthesis from FutCard. The scraper captures Futbin's full signed URL from `<img src>` — let it populate `card_bg_url` naturally on subsequent runs.
**Rule for future:** Never synthesise imgix/CDN URLs. If the upstream page serves query-signed URLs, the signature is mandatory. Test ONE URL end-to-end (curl the exact string) before fanning out a backfill. When a scraper captures a URL, always store the FULL string (scheme + host + path + query), never re-assemble from parts.

---

**Date:** 2026-04-23
**Context:** `searchCards()` fuzzy path hand-listed fields in its return projection. After adding `cardBgUrl` to `CardSearchResult`, the exact-slug path carried it through via `...row` spread but the fuzzy path silently dropped it. Picker dropdown showed portraits without frames. Same class of bug had already bit us once when `attributes` jsonb was added to SELECT_COLUMNS but projectRow didn't read it.
**Mistake:** Hand-listed return projections — adding a new field requires editing N projections. Miss one and the field comes back undefined; downstream defaults take over silently.
**Correction:** Fuzzy path rewritten to `{ sim: _sim, ...rest } = row; return rest as CardSearchResult`. Exact-slug path already used spread. No field can silently drop now.
**Rule for future:** Never hand-list "all fields from source minus N internal ones". Always destructure-rest: `const { _internal, ...rest } = source; return rest`. Hand-listing is only acceptable when the target contract is significantly smaller than the source AND must stay authoritatively declared.

---

**Date:** 2026-04-23
**Context:** `LiveTotalsBar` Nigerian counter incremented for any NG-flagged card in starters OR bench subs. Server `validate.ts` only counts starting XI (slots 1-10, GK excluded). UI showed "1 / 1 NG ✓" while server refused the submission for missing Nigerians.
**Mistake:** Client-side counter diverged from server rule. No shared predicate for "is this item counted for the NG minimum".
**Correction:** Split client-side loops: coins sum all cards (budget includes subs), but Nigerian count iterates non-GK starters only. Matches `validate.ts` line-for-line.
**Rule for future:** Any UI counter claiming to mirror a server rule must share the scope predicate. Divergent scopes mean the UI lies — worse than not showing the metric. If the scope is non-trivial, extract a shared pure function both client + server import.

---

**Date:** 2026-04-23
**Context:** `createSubmission()` accepted any squad as `pending`. `evaluateRules()` only ran at admin-review time. A tampered request or JS-disabled client could land a squad 50M over budget with 0 Nigerian and 11 banned cards; ref would only catch it on review.
**Mistake:** Trusted client-side LiveTotalsBar warnings as "enforcement". They were advisory only.
**Correction:** `evaluateRules()` guard added inside `createSubmission()` between deadline check + insert. Any violation raises `ValidationError` with a human-readable first-offence summary. Server is now authoritative.
**Rule for future:** Client validation is ALWAYS advisory. The server action that writes to the DB must independently enforce every business rule, with no dependency on the client having shown a warning. Audit every mutation for this guard before shipping.

---

**Date:** 2026-04-23
**Context:** Futbin `/26/players` DOM puts the card-frame img under `img.playercard-s-26-bg` on TOTY/icon/hero rows but NOT silvers/bronzes (those use a different class we didn't enumerate). Class-based selector captured ~40% of the catalog; silvers + bronzes scraped with `card_bg_url` null.
**Mistake:** Calibrated the selector against the first 3 rows of page 1 (all TOTYs). Assumed DOM consistency across the full catalog.
**Correction:** Added a broader fallback: `img[src*='/img/cards/tiny/']` matches any img whose src hits the frame CDN regardless of class. Also fallback to computed `background-image` style on wrapper divs.
**Rule for future:** When scraping a paginated list, sample rows from ALL page ranges (first, mid, last) + ALL variant types (specials, normals, low-rated) before calibrating selectors. Paginated DOMs often vary by content type — page-1 shape may break on page 600.

---

**Date:** 2026-04-23
**Context:** Futbin's list page exposes nation only as a CDN icon URL (`/img/nation/18.png`) keyed by Futbin-internal integer IDs. No raw ISO code or country name text. `nation_iso` was 0% populated on all 22,407 futbin-sourced rows. Nigerian-count rule never ticked even for obvious Nigerians.
**Mistake:** Assumed any list page would expose nation in a text field. Didn't inspect the icon element structure before declaring scrape complete.
**Correction:** (a) Kaggle CSV backfill copied `nation` string for ~15k matching rows. (b) Slug-propagation pass: variants of the same player inherit the nation from any sibling. (c) Hand-curated famous-names map for ~60 icons Kaggle didn't cover (Kanu, Mikel, Pele…). (d) Scraper now captures `futbin_nation_id` from the CDN icon path; Nigerian check keys on string OR ID (env-overridable via `NG_FUTBIN_NATION_ID`).
**Rule for future:** External metadata may arrive as opaque numeric IDs rather than strings. Before committing to a scrape pipeline, dump ONE row's full extracted shape and check every semantic field has a durable representation. If it's ID-only, capture the ID AND plan the mapping path upfront.

---

**Date:** 2026-04-23
**Context:** `NavDrawer` uses `createPortal(document.body)` to escape the sticky-header `backdrop-filter` clip. SSR + first-client render mismatched — server rendered nothing for the portal subtree; client mounted it immediately. Hydration warnings on every page.
**Mistake:** Mounted the portal unconditionally on first client render, ignoring that SSR can't serialise portal output.
**Correction:** `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []);` — portal mounts on the next tick after hydration. SSR-null matches first-client-null.
**Rule for future:** `createPortal` in an SSR tree is ALWAYS a hydration hazard. Every portal-emitting Client Component gates the portal behind a `mounted` flag. If this pattern repeats more than twice, extract a `<ClientOnly>` utility.

---

**Date:** 2026-04-23
**Context:** Formation switcher dropped cards that didn't map slot-for-slot between old + new formations. User reported "Kanu disappeared when I swapped 4-3-3 → 3-4-1-2". Old code matched by exact position label then spilled overflow to subs; if subs saturated, cards were silently cleared.
**Mistake:** Lossy remap prioritised shape fidelity over card preservation.
**Correction:** Three-pass remap: (1) exact label match, (2) family match (DEF/MID/ATK/GK), (3) fill remaining empties in order. Every filled card always lands somewhere. Overflow grows the bench rather than dropping.
**Rule for future:** State transitions that remap user-picked items between shapes must preserve every item unless the user explicitly drops. Loss of user work is catastrophic. Prefer "put it somewhere sensible" over "clear it, they'll redo it". Explicit test: start with 11 slots filled, swap formations, assert final filled count = 11.

---

**Date:** 2026-04-24
**Context:** User reported "page loads without any UI design, just text." Dev log showed workspace-root warning: Next.js picked `C:\Users\Sweez\Desktop\LAYO\CLAUDE\package-lock.json` as workspace root instead of the repo itself. Misrouted the asset-path base — HTML rendered fine but Tailwind CSS 404'd from the wrong prefix.
**Mistake:** Didn't pin `outputFileTracingRoot`. Next 15's heuristic walks upward looking for the nearest lockfile; a stray parent-dir lockfile hijacked detection silently — no error, just broken asset paths.
**Correction:** `apps/web/next.config.ts` sets `outputFileTracingRoot: path.resolve(__dirname, "..", "..")`. Warning line gone; CSS serves correctly.
**Rule for future:** Any Next.js project nested inside a "workspace of workspaces" folder MUST set `outputFileTracingRoot` explicitly. If `next dev` logs "We detected multiple lockfiles" — fix immediately, don't ignore, because every other subtle issue (CSS paths, image optimisation, server action serialisation) silently misroutes.

---

**Date:** 2026-04-24
**Context:** Dev server crashed with `ENOENT: .next/routes-manifest.json` + `.next/server/app/api/fcdb/search/route.js` mid-session. 500 cascade on every page. `.next/` existed but only held `cache/diagnostics/types` — compiled output vanished.
**Mistake:** Ran `next dev` in parallel with a background agent editing `apps/web/src/**`. HMR tried to recompile while the agent's writes were mid-flight; Next 15 on Windows occasionally wipes the partial output without restoring.
**Correction:** Kill dev → `rm -rf apps/web/.next apps/web/node_modules/.cache` → relaunch. Server rebuilds from scratch.
**Rule for future:** Don't start `next dev` until all parallel agents writing to `apps/web/src/**` have finished. If `ENOENT .next/routes-manifest.json` appears, DO NOT retry requests — error is self-inflicted. Sequence: kill → wipe `.next` → 2s pause → relaunch. Consider a pre-flight script that `rm -rf .next` every `pre-dev`.

---

**Date:** 2026-04-24
**Context:** User submitted squad, got Zod error `Too big: expected string to have <=6 characters`. Squad `nationalityFlag` schema was `z.string().min(2).max(6)` — sized for ISO-2/ISO-3 codes only ("NG"/"NGA"). submit_picker.ts had been patched earlier (commit `2673395`) to fall back to `card.nation_iso ?? card.nation` because Futbin rows have empty nation_iso; the fallback sent "Nigeria" (7 chars) which blew the cap.
**Mistake:** Tight upstream input contract (max 6) didn't get revisited when the feeder code changed to emit longer strings. Related pattern to the Futbin nation saga in the log — when a field changes shape due to a fallback path, every downstream validator scoped to the old shape needs a re-audit.
**Correction:** Bumped `nationalityFlag` max to 64 (covers longest real country name). DB column is `text` (unbounded) so no downstream truncation. Both copies in `schemas.ts` updated — itemSchema + changeSchema (commit `5828a91`).
**Rule for future:** Whenever a code path adds a fallback that emits a differently-shaped string, `git grep` for every zod schema validating that same field shape downstream. Relax any schema whose constraints were written for the pre-fallback format. Pre-flight: before shipping a fallback, run the full test suite to catch rejected schemas; a silent production reject is worse than a failing test.

---

**Date:** 2026-04-24
**Context:** After 86e4aba broadened the scraper selector to catch silver/bronze card frames, the user re-ran the parallel scrape and reported cards still rendering as black rectangles. Coverage audit showed 9,487/22,418 futbin rows (42%) with `card_bg_url`; 12,931 missing, concentrated in `0-silver` (25%), `1-silver` (24%), `0-gold` (13%), `0-bronze` (59%), `1-bronze` (56%) — the exact variants the selector fix was supposed to catch. Every missing row had a `price_snapshot_at` BEFORE the fix landed (2026-04-23 14:00-20:00 UTC; fix at 23:21 UTC). Every row with bg had `price_snapshot_at` AFTER the fix. Headless probe of page 200 confirmed the live DOM exposes both `.playercard-s-26-bg` AND `/img/cards/tiny/` for silvers — capture isn't the issue anymore.
**Mistake:** `_lib_diff_upsert.js` `diffFields()` checked `card_image_url`, `futbin_variant`, `futbin_meta_rating`, weak_foot, skill_moves, mains, platform_prices, nation/league/club_id — but NOT `card_bg_url`. When a re-scrape captured a correct signed bg URL for a row whose price+stats+image+variant were unchanged (the common case for stable silver/bronze normals), `diffFields` returned `[]`, upsert labelled "unchanged", and the UPDATE was skipped. The new bg was built into `newAttrs` but never persisted. Result: the "re-scrape after the fix" the user expected to populate silvers/bronzes was a silent no-op for every row whose other fields hadn't moved. Also: `_scrape_futbin_headful.js`, `_scrape_futbin_range.js`, `_scrape_futbin_auto.js`, `_scrape_futbin_filters.js`, `_scrape_futbin_reverse.js` were never broadened in 86e4aba (only `_scrape_futbin_new.js` + `_scrape_futbin_parallel.js` were).
**Correction:** Added `card_bg_url` comparison to `diffFields` (any change fires "card_bg" → UPDATE). Broadened card-frame + portrait selectors across all five remaining Futbin scrapers to match the `new`+`parallel` pattern (class-selector → `/img/cards/tiny/` → `/img/cards/` fallback, accepts png/webp/jpg). Added `diff_upsert_bg.test.ts` with 4 cases: new-bg, unchanged, HMAC rotation, literal-noop.
**Rule for future:** When adding a new attribute the scraper captures, **the diff-comparator must include it**. Otherwise a row's first rescrape-after-the-fix silently no-ops. Grep every diff-comparator when adding a new `attrs.X` key: `attrs\.(\w+)\s*=` should always be paired with `oldAttrs.\1 !== newAttrs.\1` somewhere nearby — preferably in the same file, with a comment tying them. Also: when fanning out a selector fix across a scraper family, grep ALL `_scrape_*.js` for the old selector before declaring the fix shipped — "same pattern applied to three scrapers" is useless if five others use the narrow selector.

---

**Date:** 2026-04-23
**Context:** Testing a match-option label like `"Mon 2026-04-20 · vs WOLEVATION"` should NOT contain a score. Wrote `expect(label).not.toMatch(/\d-\d/)`. Test failed because `04-20` inside the date matches the same regex — date segments are `\d\d-\d\d`.
**Mistake:** Lazy regex. `/\d-\d/` matches any digit-dash-digit pair, and ISO dates are full of those. The intent was "no trailing N-N score" but the regex didn't anchor to that context.
**Correction:** Anchored to the suffix where scores actually live: `/· \d+-\d+$/`. Runs only at end-of-string after a ` · ` separator. The date segment never matches.
**Rule for future:** When asserting "label does NOT contain score like 2-1", anchor the regex to the format boundary (`/· \d+-\d+$/`, or `/\bvs .* \d+-\d+/`). Bare `\d-\d` will false-match ANY ISO date. Before using a regex in a negative-match assertion, sanity-check it against plausible inputs other than the target.

---

**Date:** 2026-04-24
**Context:** On `/admin/broadcast/[sessionId]` the admin hit `+1` home/away in `MatchControlPanel.tsx` and got `Error: no active score_bug for primary slot on session <id>` from `updateScoreBug` (match_flow.ts:448). Session had `primary_match_id` pinned (so the slot guard at 443 passed) but no score_bug overlay_events row existed — producer had not clicked "Start match" first, OR an earlier clear left the slot bare. Every subsequent +1/-1 threw the same error, effectively bricking the score widget.
**Mistake:** `updateScoreBug` assumed `startMatch` was always the seed path for the first score_bug row and threw when `findScoreBugForSlot` returned null. Conflated "no current_match" (a real error — scoring makes no sense) with "no bug yet" (a benign state — we can seed it on demand from the pinned matchId). Also: the three call sites (`scoreBugDeltaAction`, `resetScoreBugAction`, `updateScoreBug` reset branch) all hit the same hard-throw path, so the UX failure mode was identical regardless of which button the producer pressed.
**Correction:** (commit pending) Added `ensureScoreBug(sb, sessionId, slot, slotMatchId, actor)` in `match_flow.ts`. If an active row exists, returns it untouched (fast path). Otherwise hydrates the pinned match via `loadMatchForFlow`, builds a 0-0 score_bug payload via `buildScoreBugFromMatch`, triggers it via `triggerOverlay`, and re-reads it so the caller can apply the delta on top. `updateScoreBug` now calls `ensureScoreBug` instead of the bare find+throw. Kept the `slotMatchId`-null guard at 443 intact (that's still a real error — no match pinned = scoring meaningless). Unit test `match_flow.test.ts` > "Plan 42.2 — lazily auto-creates the score_bug when none exists" exercises both triggerOverlay calls (0-0 seed then 1-0 delta). E2E at `tests/e2e/broadcast-mini-preview-and-lazy-score-bug.spec.ts` drives the full flow end-to-end: insert a stream_session with `primary_match_id` set WITHOUT firing startMatch, click +1 home, assert the DOM shows `1` and `overlay_events` has a slot='primary' row.
**Rule for future:** When a function guards on multiple preconditions, split them by severity: hard-throw only for things the caller genuinely can't recover from (no pinned match, session ended). For "doable but needs seeding first" states, lazy-init + proceed. Pattern: any `if (!x) throw` in a data-path function is a code smell — ask "can I build `x` here from state I already have?" first. Same logic applies to UI-button → server-action flows where the user naturally expects the button to "just work" for every reasonable session state.

---

**Date:** 2026-04-24
**Context:** Writing a Playwright E2E for Plan 42.2 lazy auto-create. Test clicked `score-primary-home-plus` but the score stayed at 0. DB snapshot showed no new `overlay_events` rows. Fear: the fix didn't work.
**Mistake:** Clicked the `+1` form-submit button before React hydration settled. On `/admin/broadcast/[sessionId]` there's a pre-existing hydration warning from `OffTriggerButton` nesting `<form>` inside the `EditableTemplatePanel`'s outer `<form>` (tracked separately). That pre-existing warning delays ALL client-side submit-handler attachment on the page, including forms from unrelated components like the score-widget +1 button. First click fires before React has wired the submit handler — so the form doesn't POST to the server action, it does nothing.
**Correction:** (spec) Added a retry loop in the E2E: try click → wait 8s for the score to update → if still 0, dump DB state, sleep 1.5s, retry up to 3 times. This tolerates the slow hydration without masking the bug — if the fix itself was broken, even 3 retries wouldn't make the score update. In practice the first retry after the hydration warning settles works. (Also filed mental note to fix the nested-form hydration bug in a separate slice — it's not mine, don't touch it here.)
**Rule for future:** When writing Playwright tests that click buttons on pages with known hydration warnings (grep console errors on `page.on('pageerror', ...)` first), either (a) use a retry loop, (b) use `page.waitForFunction` until a hydration-indicator has settled, or (c) use the `waitUntil: 'networkidle'` nav option PLUS a small post-nav sleep. Don't assume React is ready just because `networkidle` fired — hydration happens AFTER the network settles. Also: when a form submit "silently does nothing", ALWAYS check the DB state first before concluding the server code is broken. Client-side-no-op and server-side-error look identical from the UI alone.

---

**Date:** 2026-04-24
**Context:** Extending the Friday 21:00-22:00 WAT `squad_change_requests` row to carry three coexisting intents (formation change, slot rearrangement, single swap). Original 2026-04-28 migration had `player_out_name`/`player_in_name`/`player_in_item_type`/`player_in_rating`/`player_in_value` all NOT NULL and inlined CHECK constraints.
**Mistake:** First pass at the new migration only added `new_formation` + `new_slot_positions` — forgot that a formation-only change leaves swap columns NULL, which collides with the existing NOT NULL. The inline `check (x in (…))` and `check (x between 1 and 99)` constraints also auto-named by Postgres, so dropping them needs `IF EXISTS` + the conventional `<table>_<column>_check` name.
**Correction:** Migration `20260520000100_plan10_change_request_formation_and_slots.sql` — `alter column … drop not null` on the five swap columns, `drop constraint if exists … _check` on each inline check, reattach null-tolerant versions `check (x is null or …)`. Added `squad_change_requests_nonempty_intent_check` so empty-intent rows are rejected at DB layer. Zod schema `.superRefine` enforces the same invariant at API layer + rejects the `playerIn-without-playerOut` foot-gun.
**Rule for future:** When relaxing a NOT NULL on a column with inline CHECK, first `DROP CONSTRAINT IF EXISTS <table>_<column>_check`, then `ALTER … DROP NOT NULL`, then reattach a null-tolerant CHECK. Postgres auto-names inline column-level checks deterministically — no need to look them up, but always guard with `IF EXISTS` so the migration is re-runnable across environments where a prior failed attempt may have partially applied.

---

**Date:** 2026-04-24
**Context:** Wrote a unit test with `XI_ITEM_IDS.map((id) => ({ kind: "existing" as const, itemId: id }))`, then tried to overwrite `plan[0] = { kind: "new" }`. tsc refused: the array element type narrowed to `{ kind: "existing"; itemId: string }` because of the `as const`.
**Mistake:** Used `as const` on object literals inside `.map()` thinking it would preserve the discriminator without over-narrowing. It over-narrowed — the compiler inferred the element type as the single variant, losing the union.
**Correction:** Defined `type PlanEntry = { kind: "existing"; itemId: string } | { kind: "new" }` and a `mkExistingPlan()` helper that returns `PlanEntry[]` via explicit `.map<PlanEntry>(…)`. Now `plan[i] = { kind: "new" }` compiles.
**Rule for future:** When building a discriminated-union array via `.map()`, either explicitly annotate the element type on the map (`.map<Foo>(…)`) or construct via `[].push`. `as const` on literals inside a mapper narrows the array's element type to one variant and blocks future assignments of the other variants.


---

**Date:** 2026-04-24
**Context:** User issued punishments against Faruk + Adefola but `/(auth)/profile` self-view, `/players/[id]` public profile, and `/admin/punishments` admin list all showed "clean slate"/zero rows. Earlier session fixed the list pages via service-role (RLS bypass) but the profile pages were still broken.
**Mistake:** Two separate schema-column bugs conflated with the RLS bug:
1. `/(auth)/profile/page.tsx` queried `disciplinary_actions.player_id` + `.order("issued_at")` + selected `disciplinary_case_id` + `incident_type` FROM `disciplinary_actions`. NONE of those columns exist on that table. The real schema: `disciplinary_actions.case_id → disciplinary_cases.player_id`, column is `imposed_at` (not `issued_at`), `incident_type` lives on `disciplinary_cases` not actions. Query silently returned zero rows for every player.
2. `apps/web/src/server/overlays/autofill.ts` (punishment ticker overlay) had the IDENTICAL bug: `player:player_id (...)` + `.eq("season_id", seasonId)` + `.order("issued_at", ...)`. `disciplinary_actions` has no `player_id` column AND no `season_id` column. Ticker overlay always empty.
3. `/players/[id]/page.tsx` had no sanctions section at all — user expected "punishments should show on Faruk's profile" but there was literally no UI for them.
**Correction:**
1. Rewrote profile query to embed `disciplinary_cases!inner ( player_id, incident_type )` + filter on `disciplinary_cases.player_id`; remapped response fields (`imposed_at → issued_at`, `case_id → disciplinary_case_id`) so downstream mapping untouched.
2. Rewrote autofill ticker query to join via `disciplinary_cases!inner → players!inner → users`; dropped the phantom `season_id` filter (scope deferred — would need join through matches/match_days); updated test rows to new shape.
3. Added `/players/[id]` Sanctions section using `listForPlayer(svc, id)` with service-role client (Plan 39 RLS bypass — same fix pattern).
4. Extended revalidation: `/admin/punishments/[id]/actions.ts` (revoke/update/softDelete) now fetches `player_id` via case-join BEFORE mutating, then revalidates `/profile` + `/players/[id]`. `/admin/punishments/new/actions.ts` adds `/profile` revalidation too. Punishments now reflect on every surface after issue/edit/delete/revoke.
**Rule for future:**
- When a bug involves a DB column, FIRST verify the column exists in the migration before patching. `grep -n "<col_name>" supabase/migrations/` or read the `CREATE TABLE` statement. Never trust field names in existing code — they rot when schemas evolve.
- When patching a query, `git grep` for every OTHER query on the same table to see if the same column-name mistake propagated. Column-name typos travel in packs (copy-paste).
- When a mutation action exists (create/update/delete/revoke), audit EVERY surface that reads the same row type. Revalidate them all. Lack of revalidation on one surface = stale data + "why isn't it reflecting" bug reports.
- RLS is a second-order gotcha: even a correct query returns zero rows if RLS blocks the authenticated client. Check RLS before assuming the query is wrong. Check the query before assuming RLS is wrong. Both are possible; both were live in this session.

---

**Date:** 2026-04-24
**Context:** /admin/broadcast/[sessionId] console: "In HTML, <form> cannot be a descendant of <form>" — `OffTriggerButton` (`<form action={clearInstanceAction}>`) rendered inside `EditableTemplatePanel`'s outer `<form action={triggerInstanceAction}>`. Produces a hydration warning + subtle form-submission bugs (inner form takes precedence, some buttons fire twice).
**Mistake:** Two separate components each own their own `<form>` wrapper, nested when composed. The pattern "each button has its own self-submitting form" works in isolation but composes badly — the second `<form>` is auto-unwrapped by the browser on hydration, causing the structure React SSR'd and the structure the DOM actually holds to diverge.
**Correction:** Rewrote `OffTriggerButton` to NOT wrap in `<form>`; switched to `<button formAction={clearAction}>` pattern OR rendered as sibling outside the outer form in `EditableTemplatePanel`. (Implementation handed to broadcast-refactor agent; commit forthcoming.)
**Rule for future:**
- Never compose two components each owning their own `<form>`. Either (a) one component wraps, the other uses `formAction` on its buttons, or (b) they render as siblings.
- Grep for multi-form pages: `apps/web/src/**` → `grep "<form" -n`. Audit any file with >1 `<form>` — are any nested? If the outer form has children components, check those components for inner forms too.
- HTML-invalid nesting triggers hydration mismatch even when it "looks fine" in dev — React reconciles by throwing away the client tree and re-mounting. Any interactive state (open dialogs, focused inputs, pending submissions) gets wiped. This is silent data loss, not just a warning.

---

**Date:** 2026-04-24
**Context:** Linkage audit slice. Closed §3 (no "My disputes" on /profile), §6 (no attendance visibility for player or admin), §9 (org/coach/manager IDs loaded but unrendered) + replaced Plan 39's over-coupling of service-role-everywhere on `/profile` + `/players/[id]` sanctions reads.
**Mistake:** Plan 39 C3 took the fast route — a deny-all RLS policy on `disciplinary_actions` + `attendance_marks` + `match_stat_screenshots` + `organization_contracts`. Any page that wanted to surface these tables then had to use service-role, bypassing RLS. That pattern is "trust the function" not "trust the database" — a future refactor that queries the table directly from an authenticated client leaks every private row. The audit (§Over-coupling #1) flagged this as the wrong abstraction.
**Correction:** Migration `20260520003000_disciplinary_rls_self_and_public.sql` replaces deny-all with two narrow policies per table:
  - `_public_select` — everyone can see rows that are public_visible + not revoked + not deleted.
  - `_self_select` — authenticated user can see every row whose chain of FKs traces back to `users.supabase_auth_id = auth.uid()`.
  `disciplinary_cases` + `appeals` get mirror policies so PostgREST nested embeds (`disciplinary_cases!inner(...)`) can traverse the join. `attendance_marks` + `organization_contracts` + `match_stat_screenshots` get matching narrow policies. Staff reads continue via service-role (bypasses RLS) — no change.
**Rule for future:**
- When a feature needs a page-level read of a sensitive table, **default to designing an RLS policy first**, not a service-role escape hatch. Service-role inside a Server Component is a weaker contract than a row-level policy: the former depends on a developer remembering to filter in-function; the latter cannot be bypassed without replacing the client.
- Policy pairs: `_public_select` + `_self_select` is the right shape when "everyone sees some, owner sees all". Single deny-all + app-layer filter is the wrong shape because it rules out anon reads entirely.
- Anon + authenticated are two different roles for policy purposes — but `auth.uid()` returns NULL for anon. A policy with `EXISTS (SELECT 1 FROM users WHERE supabase_auth_id = auth.uid())` scopes itself correctly without needing role-based branching.
- Every new RLS policy touching `users.supabase_auth_id` in a subquery MUST be scoped `TO authenticated`, NOT `TO PUBLIC` / unscoped. See §Plan 39 C2 lesson above for the plan-error pattern this avoids.
- When a page was reverted by a linter / concurrent edit, always re-verify the full set of changes with a `git status` + targeted `grep` for each expected token BEFORE running tests. Files silently rewinding to pre-edit state is a quiet failure mode in parallel-agent workflows.

**Date:** 2026-04-24
**Context:** Plan 50 (appeals auto-void + ban void-propagation link). User reported that (a) appeals were auto-voiding the linked sanction on submission — should instead wait for ruling outcome=upheld; (b) ban sanctions covering already-played matches needed automated match_results void propagation with admin un-void.
**Mistake:** (prior) The original appeals `rule()` wrote the ruling as free text only; the linked `disciplinary_actions` row was never touched, so an upheld appeal required the admin to manually revoke the punishment. And when a ban window covered already-entered results, `match_results.result_type='void'` was set but there was no structured link back to the originating action — only a free-text `notes` marker. That made admin debugging + undo logic fragile.
**Correction:** (commit `42591d79`)
- Added `appeals.outcome` enum column (`upheld`/`dismissed`) + `match_results.voided_by_action_id` uuid FK.
- `rule()` now takes outcome. On `upheld`, `onAppealUpheld()` revokes every live action on the case with a `[appeal:<id>] Upheld on YYYY-MM-DD. Panel ruling: ...` prefix; the Plan 11 ban trigger already unwinds voids on revoked_at→NOT NULL.
- `undoRuling()` scans by the prefix, un-revokes each; `on_ban_action_change` now has a fourth branch that re-propagates voids when revoked_at flips NOT NULL → NULL.
- Updated `propagate_suspension_voids` to write the uuid column (plus retain the marker for legacy rows); `unpropagate_suspension_voids` queries by column first, falls back to marker.
- UI: outcome selector + effects summary + undo on `/admin/appeals/[id]`; revoked-via-appeal tag + un-revoke button on `/admin/punishments/[id]`; voided-by-ban banner + per-match un-void form on `/admin/match-days/[id]`.
**Rule for future:**
- Cross-entity cascades (A-ruling → B-revoke → C-unvoid) must carry a durable discriminator so an undo path can find exactly what the original action touched. Free-text markers work but burn implementation detail into user-visible columns; dedicated FK columns + structured prefixes on reason fields are the right shape.
- When extending a DB trigger, audit every branch: the existing `on_ban_action_change` handled INSERT + revoke + soft-delete + date-edit but silently missed UN-revoke (revoked_at NOT NULL → NULL). A "propagate on state-flip" trigger needs a branch for every direction of every flip.
- For admin undo/reverse UX on a cascade, show the set of affected rows before the undo button so the admin knows what it will touch. `listEffectsForAppeal` exists exactly so the confirm dialog isn't a black box.


---

**Date:** 2026-04-24
**Context:** User reported "site says Internal Server Error" on `/player/disputes` + "home page loaded without design". Both symptoms had separate root causes but appeared in the same bug report. I jumped to fixes before grepping `tasks/lessons.md` — exactly the pre-flight check my own rule requires. User called it out: "this error is not supposed to happen again are you not supposed to load info of errors?"
**Mistake:** Skipped the pre-flight grep. Had I grepped "lockfile" / "CSS" / "workspace root" first I would have landed immediately on the 2026-04-24 entry documenting the stray `C:\Users\Sweez\Desktop\LAYO\CLAUDE\package-lock.json` hijacking Next's workspace-root detection. The `outputFileTracingRoot` fix only works AFTER config load; the lockfile-heuristic runs earlier and silently misroutes asset paths when a parent-dir lockfile exists. Deleting the stray file is the only reliable cure.
**Correction:**
1. Deleted `C:\Users\Sweez\Desktop\LAYO\CLAUDE\package-lock.json` AGAIN. Something — probably an npm install run from the parent dir — recreates it over time.
2. Wiped `apps/web/.next`, killed the dev server, restarted. Fresh dev comes up clean with no lockfile warning.
3. On the `/player/disputes` 500: verified columns (`opened_at`, `raised_by_user_id`, `title`, `subject_type`, `status`, `deleted_at` all present), verified admin has `disputes.read.own` perm in DB, verified page imports look correct. Likely the 500 was stale `.next` output referencing old column names / old RLS policies from before today's migrations. Cache wipe + restart should clear it. If it recurs, need an actual browser-side or dev-log stack trace — guessing from code grep isn't enough.
**Rule for future:**
- **Grep `tasks/lessons.md` FIRST on every new bug report.** Keywords from the symptom, not from guessed root causes. "Server error" → grep `500|ENOENT|compile`. "No design / broken CSS" → grep `lockfile|workspace|Tailwind|CSS`. This is the load-bearing rule I keep violating; next session must hardwire it.
- **If a fix removes a file but the file keeps coming back, add a guardrail** — `.gitignore` to prevent accidental commit, or a `postinstall`/prestart script that deletes the stray file. Leaving the recurrence unguarded means this lesson gets re-learned every time `npm install` runs in the wrong dir.
- **Never "fix from code grep alone" when diagnosing a 500.** Get the stack trace. Log-tail the dev server; ask the user for the Response-tab body; attach cookies and curl the authenticated path. Code grep is necessary but insufficient — the running server tells you which symbolic error fires and at what line.

---

**Date:** 2026-04-24
**Context:** Faruk logged in as himself, viewed `/profile` (self-view), disciplinary history empty. Also admins viewing `/players/[id]` for any player still saw only public sanctions even though the RLS migration `20260520003000` was in place.
**Mistake:** Two cousin bugs, both from RLS-protected embeds:
1. `/profile` sanctions query used `.select("... disciplinary_cases!inner ( ... )")` + `.eq("disciplinary_cases.player_id", X)`. PostgREST inline filter on an embed whose table has its own RLS policy silently drops rows when the policy predicate can't be evaluated in the embed subquery context — even though querying `disciplinary_cases` alone WITH the same predicate would work.
2. `server/punishments/index.ts` `listForPlayer` embedded `players!inner ( users:users!players_user_id_fkey!inner ( display_name ) )`. Plan 39 locked down `users` PII so the `users!inner` requirement drops EVERY case row for an authenticated client that isn't the user themselves. Admin viewing Faruk → zero cases → zero sanctions.
**Correction:**
1. `/profile` rewrite: two-step — fetch `disciplinary_cases` by `player_id` first, then `disciplinary_actions` by `case_id IN (...)`. No embed, no PostgREST inline-filter-on-embed. Policy predicates evaluate per-row on the base table, which works.
2. `listForPlayer` rewrite: three-step — fetch `players` row for id+gamer_tag, fetch cases by player_id, fetch actions by case_id IN (...). Drop the `users` embed entirely; display_name now falls back to `gamer_tag` since the users PII column is off-limits to non-self authenticated clients post-Plan-39.
**Rule for future:**
- **Never put a PostgREST `!inner` embed on a table with its own restrictive RLS** unless you have verified (a) the caller qualifies under every embedded table's policy OR (b) the embed is truly needed and you're on service-role. Prefer 2-step / 3-step manual joins.
- **PII columns on `users` (email, display_name) are off-limits to authenticated cookie clients viewing other users.** Rely on `players.gamer_tag` (public-readable) instead for display purposes in client-facing reads. Admin surfaces that truly need display_name go through service-role.
- When a list surface ships "empty state" unexpectedly, TEST the query against ACTUAL cookie session auth, not service-role. Vitest mocks can't catch this. Either write an E2E spec that logs in as a seeded player OR manually curl with a JWT.

