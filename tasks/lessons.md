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
**Context:** User reported newly-issued punishments for FARUK/ADEFOLA didn't reflect on `/admin/punishments` nor `/punishments`. Rows DID exist in `disciplinary_actions` (19 total confirmed via service-role diag) and the user's display_name + user_id were populated — so the earlier hypothesis that the `users:users!players_user_id_fkey!inner` embed was dropping rows was wrong.
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

