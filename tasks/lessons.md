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

**Date:** 2026-04-29
**Context:** User reported h2h overlay stats showing `—` on prod even when triggered, and top-scorers staying frozen empty even with 10 confirmed matches in the season. Investigation found two distinct root causes plus a meta-lesson.
**Mistake:** Three layered bugs. (a) `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts` — the `resolvePinnedPlayerIds` chain queried `users.gamer_tag` to map displayName → user_id → player_id, but the `users` table has NO `gamer_tag` column. It lives on `players`. The Supabase JS client surfaces 42703 errors via the `error` field which the destructure ignored — so `data` was always null + the chain always returned an empty cards array. Unit tests passed because the mock client returned whatever `opts.users` pretended Supabase returned (Vitest mocks don't validate against real schema). (b) Same h2h chain — even if the column existed, `V2_PLAYER_NAMES` writes "BAJI JNR" / "KING NONEX" / "MR OGA" / "KILLER FREAK" with spaces but the actual DB rows have underscores ("BAJI_JNR", "KINGNONEX", "MR_OGA", "KILLER_FREAK"). A direct uppercase `.in()` would still miss those 4 of 13 players. (c) `top_scorers_data.ts` aggregated only from `goal_events` + `player_match_stats`, both of which are 0 rows on this season — the score-entry flow writes ONLY team-level `home_score`/`away_score` into `match_results`. So the overlay was always empty even though standings had goals_for=11 for BAJI_JNR, 15 for KAYKAY, etc.
**Correction:** Commit pending — files: `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts` (drop `users` step, resolve via `players.gamer_tag` + `normalizeTag` strip-spaces-and-underscores), `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.test.ts` (mock-shape update + new regression test for "BAJI JNR" → "BAJI_JNR"), `apps/web/src/server/overlays/top_scorers_data.ts` (added match_results.home_score/away_score fallback for matches with no per-player attribution; matchIdsWithExplicit set guards against double-counting), `apps/web/src/server/overlays/top_scorers_data.test.ts` (3 new regression tests: fallback-only, explicit-wins-over-fallback, walkover_pending exclusion).
**Rule for future:**
1. **Trust the schema, not the destructure.** When chain calls a Supabase column that may not exist, the `error` field carries the truth — the destructured `data` will be silently null. Always check `if (error) throw...` on every Supabase chain that participates in a critical lookup, OR pre-flight the query against `information_schema.columns` for any new code path. Mock-passed tests are NOT proof against phantom-column bugs.
2. **Reconcile cross-system identity formats up front.** When code in one place writes "BAJI JNR" (UI display) and code in another reads "BAJI_JNR" (DB tag), the lookup will silently fail in prod. For the 13-row roster, write a `normalizeTag` (strip whitespace+underscores+uppercase) once + use it on BOTH sides of every comparison. For any join that bridges two naming conventions, explicitly document the canonicalization in the function docstring.
3. **If a "live data" overlay is empty, query the underlying table directly** before assuming the bug is in the iframe / postMessage / fetch wire. `npx supabase db query --linked "SELECT count(*) FROM <table> WHERE ..."` takes 5 seconds and tells you whether the data even exists. Bug 2 here was not "the wire is broken" — it was "the data source has 0 rows because the writer doesn't populate it."
4. **Tier data sources for overlays that aggregate.** Top-scorers reads goal_events (per-goal authoritative) → player_match_stats (per-match aggregate) → match_results.home_score/away_score (team-level fallback). Each tier covers a different granularity of data the score-entry flow may or may not have written. Without the team-level fallback, an overlay can stay empty for an entire season because the per-player path was never wired.
5. **Schema mismatch + space-vs-underscore + empty-fallback bugs are all silent regressions.** Build a smoke test that hits the live cloud DB through the actual route handler (not mocked Supabase) for every overlay endpoint and asserts non-empty payload when the season has confirmed matches. The 24 unit tests for these routes all passed before this fix even though prod was broken on every overlay.

**Date:** 2026-04-24
**Context:** User reported 4 bugs on `/admin/broadcast/[sessionId]`: (1) page loads slow (40+ scaled iframes, each a Realtime WS + full 1920×1080 DOM). (2) starting-soon-timer + layout-timer emit a per-second "tick" audio cue by default, conflicting with caster VO + intro music. (3) Trigger OFF button for `up_next_bug` + `layout_timer` did nothing — overlay stayed on. (4) Audit of exit animations.
**Mistake:** Three distinct wrongs. (a) `OverlayMiniPreview` mounted `<iframe>` eagerly on every render. Perf defender `loading="lazy"` on the iframe isn't enough — React still creates the element + queues the GET + spawns a Supabase Realtime WebSocket per tile before the browser gets a chance to skip paint. (b) `starting_soon_timer/page.tsx` had `const resolvedSlot = (soundSlot === undefined ? "tick-1s" : soundSlot)` — falsy-default to tick. `layout-timer/page.tsx` hard-coded `useOverlaySound("tick-1s", ...)` unconditionally. Registry defaults were `"tick-1s"`. All three paths defaulted to NOISE. (c) `OffTriggerButton` categorised `up_next_bug` + `layout_timer` as multi-instance — routing their OFF to `clearInstanceAction` (which scans `overlay_active_instances`). But both templates' TRIGGER path writes into `overlay_events` (via `triggerOverlayAction`), not `overlay_active_instances`. Result: OFF button rendered disabled (no instanceId) or fired a no-op against an empty table. The overlay row in `overlay_events` never got cleared → Realtime never published `overlay.cleared` → overlay stayed on.
**Correction:**
- `apps/web/src/components/broadcast/OverlayMiniPreview.tsx` — IntersectionObserver-gated lazy mount. Tile renders a cheap `loading preview…` placeholder with `content-visibility: auto` + `contain-intrinsic-size` until first visibility (rootMargin 200 px, threshold 0.01). Belt-and-suspenders: staggered `setTimeout(400 + Math.min(2400, offsetTop × 0.4) ms)` fallback so tiles that never scroll into view still mount within ~3s — keeps Playwright E2E contracts intact + prevents a surprising "this tile is dark forever" UX for producers who don't scroll.
- `apps/web/src/app/(overlay)/overlay/starting-soon-timer/page.tsx` — resolvedSlot now `(soundSlot ?? null)` so the default is silent; operator must opt in via payload `soundSlot: "tick-1s"`.
- `apps/web/src/app/(overlay)/overlay/layout-timer/page.tsx` — new `?tick=1` (or `?silent=0`) URL flag; `ClockBody` takes `tickEnabled: boolean` prop that gates `useOverlaySound("tick-1s", ...)`. `timer-end` at 0 still fires regardless (non-disruptive cue at the moment it matters most).
- `apps/web/src/server/overlays/registry.ts` — `defaultSoundSlot` for both `layout_timer` + `starting_soon_timer` flipped to `null`.
- `apps/web/src/components/broadcast/OffTriggerButton.tsx` — `MULTI_INSTANCE_KEYS` shrunk to just `{ lower_third }`. `up_next_bug` + `layout_timer` now route through `clearOverlayAction` which hits `overlay_events` + publishes `overlay.cleared` with the right event id.
- `apps/web/src/components/broadcast/OffTriggerButton.test.tsx` — old test asserting `up_next_bug` as multi-instance inverted to assert the fixed routing + added `layout_timer` coverage.
**Rule for future:**
1. When an iframe carries its own Realtime / WebSocket / network IO, NEVER mount it eagerly on pages that can render 10+ instances. Default to IntersectionObserver OR explicit "Load preview" button. Eager-mount + scale-down is a trap — the browser's lazy-load heuristics don't know about your WS.
2. `content-visibility: auto` is a paint/layout optimization, NOT a mount gate — it skips rendering, not React effects. Still need lazy-mount for effects + iframes.
3. Whenever a template's default soundSlot is non-null, challenge it: does it play ONCE (stinger enter, whoosh) or REPEATEDLY (tick-1s per second)? Repeated cues MUST default to silent unless the producer explicitly opts in.
4. Routing table between {trigger table, clear action} must be explicit + tested. Every template key appears in EXACTLY ONE of the two tables (overlay_events OR overlay_active_instances). Unit-test the mapping: for each template, invoke OffTriggerButton with `latestEventId` AND `instanceId` and assert the form routes to the right action + carries the right hidden input.
5. E2E that asserts `iframe.getAttribute('src')` after lazy-mount lands MUST also either (a) scroll to the element first, or (b) wait up to the known fallback-delay budget. Don't rewrite the lazy-mount to "solve" the test — the lazy-mount itself is the feature. While implementing, parallel agents repeatedly overwrote my edits to `/admin/{disputes,appeals,squads,punishments}/[id]/actions.ts` + `components/public/SiteChrome.tsx`. First attempt used `git stash`/`git stash pop` to checkpoint while verifying the build — pop left the files mid-overwrite because the parallel agent had moved on, so my notify() integrations silently vanished from 4 files and I would have shipped the UI without any real write-path wiring.
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

---

**Date:** 2026-04-24
**Context:** User clicked "Mark all read" in the notifications bell dropdown; the red unread badge blinked to 0 then reverted to the original count after the dropdown closed. Symptom: optimistic UI correct, server mutation silently no-opped, subsequent `unreadCount()` re-read the same `read_at IS NULL` rows and re-populated the badge. Reported against bell → `/api/notifications/read-all` → `markAllRead()` path.
**Mistake:** Migration `20260520002000_notifications_full.sql` enabled RLS on `public.notifications` with ONLY a `notifications_self_select` policy. The original comment even hand-waved: "UPDATE flows through server code via service-role, so no UPDATE policy is required." But the API routes (`/api/notifications/read-all`, `/api/notifications/[id]/read`) build their Supabase client via `getServerSupabase()` — a USER-SCOPED cookie client, not service-role. Under RLS with no matching UPDATE policy, Postgres silently returns zero affected rows: the query succeeds (no error bubbles up), so our `markAllRead` returned happy path, but the DB was unchanged. Third time this exact class of RLS silent-no-op has bitten us (Plan 39 C2/C3, disciplinary_actions `20260520003000`, now notifications). Compounding this: `markAllRead`/`markRead` returned `void` without any `.select()`, so even the server had no count to sanity-check against.
**Correction:** (commit to follow)
1. Migration `20260521003000_notifications_self_update_rls.sql` adds `notifications_self_update` policy `FOR UPDATE TO authenticated USING (user_id = (select id from users where supabase_auth_id = auth.uid()))` with matching `WITH CHECK`. Mirror of the SELECT policy so a user can only mark their own rows read.
2. `@/server/notifications/index.ts::markAllRead` + `markRead` + the parallel copies in `@/server/announcements/index.ts` now return the flipped-row count via an appended `.select("id")` terminal. The return value is not enforced by callers today but gives the API route (or a future guard) a truthful "we flipped N rows" signal — a silent RLS no-op now returns 0 where 1+ was expected.
3. Cloud-DB smoke `_smoke_notifications_mark_read.mjs` (removed after verify) ran the exact user-scoped UPDATE path via a minted magic-link session for Faruk, proved the test row flips under the new policy, confirmed via service-role read-back that `read_at` is non-null, cleaned up.
**Rule for future:**
- **The "service-role on writes" assumption is only safe if you AUDIT every caller and confirm none use user-scoped clients.** Any UPDATE/INSERT hit from `getServerSupabase()` under RLS needs a matching policy, period. Vitest mocks can't catch this because the stub doesn't simulate RLS. Treat "no UPDATE policy because service-role only" as a lie unless you've grepped every `from("<table>").update(`/`insert(` call in the repo and verified client origin.
- **Mutation helpers should return a count, not void.** An append-only `.select("id")` at the tail of every UPDATE costs one extra column-read but gives callers a truthful observability signal. Silent `{ error: null, data: [] }` is indistinguishable from success without it.
- **For RLS migrations on tables with existing writers, ship a cloud-DB smoke in the same commit.** Drop a `_smoke_<X>.mjs` at the root that mints a magic-link session (via `auth.admin.generateLink`), replays the exact UPDATE shape, asserts rows-flipped + DB state, cleans up, then `rm`s itself post-run. Takes ~30s, catches RLS regressions that unit tests with mocked Supabase never will. Magic-link > password because dev passwords rotate and password-based smoke breaks silently.


---

**Date:** 2026-04-24
**Context:** User reported "disciplinary history is still blank" even after the 2-step RLS-safe fetch fix on `/profile` landed. Had convinced self that the bug was RLS-related. Actually the user's subnav "Profile" link pointed to `/player/profile` — a Plan-13B stub that only shows email + display_name. Rich profile (sanctions + everything else) lives at `/profile`. Two different URLs, one wired into nav, the other not.
**Mistake:** Did not audit ALL pages named "profile" when investigating the empty-sanctions report. Stopped at `/(auth)/profile/page.tsx` assuming that was where the user was. Real browser URL would have shown the mismatch in ~5 seconds. Also: the user-visible link in the subnav wasn't updated when the rich profile shipped.
**Correction:** Replaced `/player/profile/page.tsx` with a server redirect to `/profile`. Both entry points now resolve to the full view. Subnav + NavDrawer links untouched (redirect is transparent).
**Rule for future:**
- **When a user reports "X is missing on page Y", `grep -rn "page.tsx" apps/web/src/app` for every page named Y.** Multiple route groups in Next.js = multiple pages can share a logical name. Don't assume; enumerate.
- **When shipping a new rich page that supersedes a stub, update the stub in the SAME commit — either delete it, redirect it, or converge the two.** Leaving the stub at its old URL means the subnav keeps pointing at dead content. This is a parallel to the player↔admin parity rule in CLAUDE.md, applied to player↔player.
- **Ask for the exact browser URL before guessing**. The user is looking at their URL bar; we're blind without it.

---

**Date:** 2026-04-24
**Context:** After shipping `34ac6ed7` (redirect `/player/profile` → `/profile`), user asked whether any OTHER pages suffer the same stub-vs-rich mismatch. Full repo sweep required across 96 `page.tsx` files + every nav component (`SiteChromeClient`, `NavDrawer`, `AdminSubnav`, `PlayerSubnav`, `UserBadgeShell`, `TrashTabs`, `NotificationsDropdown`).
**Mistake:** No new mistake — this is a proactive audit ruling out whether the profile-stub bug class repeats elsewhere. BUT: two leftover nav href values (`NavDrawer` PLAYER_LINKS + `PlayerSubnav` TABS) were still pointing at the now-redirecting `/player/profile`, meaning every "Profile" click did a hop → server redirect → `/profile`. Functional but slower + the URL bar flashed the wrong path.
**Correction:**
1. Audited all 96 pages; only stubs found were (a) the already-fixed `/player/profile` redirect, (b) `/admin/trash` → `/admin/trash/[first-entity]` (intentional index pattern, not a stub), (c) `(overlay)/overlay/*` `PreviewStub` pages which are production OBS/vMix browser sources + not user-nav targets.
2. Updated `NavDrawer.tsx` PLAYER_LINKS "Profile" href `/player/profile` → `/profile`.
3. Updated `PlayerSubnav.tsx` TABS "Profile" href `/player/profile` → `/profile`.
4. Kept `/player/profile` redirect page for stale bookmarks / deep links.
5. Report: `docs/superpowers/specs/2026-04-24-stub-page-audit.md`.
**Rule for future:**
- **When shipping a redirect fix, also update every nav href that pointed at the old URL.** The redirect works but the hop adds latency + flashes the wrong path in the address bar. Grep every nav component (not just `PlayerSubnav.tsx`) for the old href and switch to the canonical rich URL.
- **When auditing for stub-vs-rich mismatch across a repo, sort pages by line count ascending — stubs cluster at the bottom.** Combined with a grep for "placeholder", "TODO", "richer version", "later plan" this surfaces ~90% of candidates in one pass.
- **Distinguish INDEX-to-first-tab redirects from STUB redirects.** `/admin/trash` redirecting to `/admin/trash/[first-entity]` is a canonical UX pattern (you always land on some content). A stub redirect exists because the original page never got the intended content. The audit table should call these out separately so future passes don't re-flag the index ones.
- **Overlay/browser-source routes are DISTINCT from user-nav routes by design.** They render transparent + are loaded by OBS/vMix at 1920×1080. Never treat them as stubs just because they use a `PreviewStub` harness — the harness is the production wrapper.


---

**Date:** 2026-04-24
**Context:** `/profile` disciplinary history blank for every player despite: (a) rows in DB, (b) RLS self+public policies in place, (c) 2-step fetch rewrite. Added runtime diag that printed `error=infinite recursion detected in policy for relation "disciplinary_cases"`.
**Mistake:** Migration `20260520003000_disciplinary_rls_self_and_public.sql` wrote **mutually-recursive EXISTS clauses**:
- `disciplinary_cases_public_select` USING: EXISTS (... from disciplinary_actions ...)
- `disciplinary_actions_self_select` USING: EXISTS (... from disciplinary_cases ...)

Postgres can't statically resolve which policy applies first → infinite recursion at query time. The error is silent to the client except via `error.message`; data just comes back empty. Vitest mocks + service-role smoke both bypass RLS, so this class of bug never surfaces until an actual authenticated session makes the query.
**Correction:** `20260521004000_fix_disciplinary_rls_recursion.sql` drops the EXISTS from `disciplinary_cases_public_select`. Case metadata (player_id, incident_type, opened_at, status) is non-sensitive — actions table still gates the sensitive payload. Policy now just `USING (deleted_at IS NULL)`.
**Rule for future:**
- **Never write two RLS policies that reference each other.** If you're about to add an EXISTS clause on table A that references table B, check whether B's own policies reference A. If yes, one of them has to be unconditional (no cross-reference). Draw the dependency graph on paper before writing the migration.
- **Every new RLS migration must ship with an authenticated-session smoke test.** Service-role smokes don't catch recursion. The real test is: mint a JWT → SELECT → assert row count > 0. Without this, recursion + policy-misconfiguration bugs ship silently.
- **When a list shows "empty state" unexpectedly, log `.error.message` from the Supabase response.** The Supabase client doesn't throw on RLS errors; it returns `{ data: null, error: {...} }`. Code that ignores `.error` turns every policy bug into a silent empty state. Add `if (error) throw ...` or at least `console.warn(error)` to every server-side query.


---

**Date:** 2026-04-25
**Context:** v2 broadcast overlays user smoke surfaced 8 distinct visual bugs. Strict-gate `body { opacity: 0 }` + `body.cade-visible { opacity: 1 !important }` + `body:not(.cade-visible) * { animation-play-state: paused }` (commit `e3014ead`) was hiding too much: WHITE full-canvas before trigger ON for h2h-5 / leaderboard / match-scores-day (the halftone-green stadium bg WAS in the DOM but body opacity 0 hid it); only stats animated for h2h-2 (player-col children inherited paused state from `* { animation-play-state: paused }`); h2h-3 + h2h-5 + match-scores-day auto-animated OUT without trigger OFF (stage-loop infinite + per-shell exit animations baked at 11.2s); trigger OFF on lower-third / up-next / score-bug killed exit anim (body cade-exiting opacity 0 immediately hid it); timer flashed in-then-out (auto-exit on 0:00).
**Mistake:** Tried to gate visibility at the `body` level for ALL 16 overlays without distinguishing two categories: (A) small anchored bugs where the canvas is meant to be transparent + only the bug element is visible, and (B) full-canvas overlays where the halftone-green bg should be visible BEFORE trigger ON and only the inner content (top-band, player cards, stats) should be gated. Body-level gate works for category A but DESTROYS the bg-image for category B. Also, the universal `* { animation-play-state: paused }` rule killed parent-driven cascade animations on h2h-2 (player-col → photo/name/logo) because children inherit the paused state.
**Correction:** Replaced strict gate with split gate (commit `ebb2c811`):
- `body { opacity: 1 !important }` always (transparent canvas for cat A, opaque bg for cat B).
- For cat A (timer, lower-third, score-bug, up-next, partners-strip): only the actual bug element gated.
- For cat B (BRB, h2h-2/3/5, leaderboard, match-scores-day, starting-soon, stream-ended, top-scorers, orgs, coaches, penalties, animated-bg): inner content shells listed explicitly (`.top-band`, `.chevrons`, `.player-col`, `.stats-card`, etc.) gated via `body:not(.cade-visible):not(.cade-exiting) <selector> { opacity: 0 !important; animation-name: none !important }`. On `cade-exiting`, single-play `cade-fade-out 0.5s forwards` runs.
- Removed the Plan 51 cade-gate observer (commit `92cb5cd2`) that wrote inline body opacity — it fought the new split-gate.
- Removed h2h-3 stage-loop, h2h-5 per-shell auto-out animations, match-scores-day infinite loops (replaced with single-play overrides).
- Timer no longer auto-exits on 0:00 (stays until {type:'hide'}).
- Timer accepts `{expiresAt: ISO}` payload (Plan 51 layout_timer schema).
- Up-next normalizePlayer reads `gamerTag` (canonical Plan 51 slug) + `photoUrl` direct from payload.
**Rule for future:**
- **Categorize before gating.** Small anchored bugs (lower-third, score-bug, timer, up-next, partner-strip) have transparent canvas — gate only the bug element. Full-canvas overlays (everything else) have a bg-image that must always be visible — gate only inner content shells. NEVER apply a single body-level opacity gate to both categories; you destroy the bg in cat B.
- **`body:not(.x):not(.y) * { animation-play-state: paused }` is too aggressive.** It cascades to descendants whose visibility depends on a parent's animation. If parent A has `animation: x-in 1s both` and children inherit visibility from x-in's `both` fill mode, pausing the children kills their visibility entirely — even though the parent's own animation isn't what we wanted to gate. List specific shells in the gate selector, not `*`.
- **Single-play vs infinite-loop animations are NOT interchangeable.** A keyframe with `infinite` + auto-OUT segments at 95% will ALWAYS cycle, even if the gate hides it visually. The fix is to REPLACE the keyframe via `animation-name: cade-fade-in` override on cade-visible, NOT to rely on opacity to hide the cycling. If the design source has `animation: foo 13s infinite` with foo's exit at 97%, EVERY 13 seconds the user sees the content vanish + reappear regardless of any gate.
- **Auto-exit-on-zero is NEVER what an operator wants.** Timers, banners, and any element with a logical "end state" (00:00, last item) should STAY visible at that state until explicit hide. The "flash + exit" pattern is wrong: operator hits OFF when they want OFF, not when the timer happens to hit 0.
- **Inline JS that writes `body.style.opacity = '0'` is incompatible with cade-exiting exit animations.** Body opacity 0 INSTANTLY hides everything including the inner element trying to play its exit animation. If you need a body-level fallback, use a CSS class with `transition: opacity 0.5s` so the fade has time to play.
- **Plan 51 `gamerTag` is the canonical slug, not `slug`.** Future overlay schemas may rename — always read both `gamerTag` (new) AND `slug` (legacy) from incoming payloads. And accept direct `photoUrl` from autofill since it's already resolved by the server.

**Date:** 2026-04-26
**Context:** S2 smoke pass on broadcast v2 surfaced three operator-confusion bugs hours before going live: (1) match-day swap silently fails when the target day already has another active session — `useTransition` swallows the rejected promise, status indicator clears, no error feedback. (2) "Save preset" button on Lower Third 1-3 opens a native `window.prompt()` dialog — looks unstyled + freezes browser automation. (3) Mini-preview iframes for cards #15 Orgs / #16 Coaches / #17 Penalties always look "live" regardless of server ON/OFF state — the operator can't trust the preview to mirror what's on stream.
**Mistake:**
- (Bug #1) Used bare `await setSessionMatchDayAction(fd)` inside a `startTransition` callback. The server action throws Error("Another session is already active on that match day…") but `useTransition` swallows the rejection — by design — so the UI gives no signal, just clears the saving spinner.
- (Bug #3) Used `window.prompt(...)` for ad-hoc text input. Native dialogs (a) freeze browser automation including Playwright + claude-in-chrome, (b) ignore stylesheets, (c) block keyboard navigation in production-grade UI.
- (Bug CC#2) `OverlayDataInjector` fires `INITIAL_FETCH_PATH[overlayKey]` whenever the iframe loads + sessionId is set — regardless of whether the overlay is currently triggered. Because the v2 overlay HTML treats `{type:'update'}` AS `{type:'show'}` (calls `show()` from the same branch), every mount of a data-driven preview renders fully visible — even when the overlay is OFF on stream. Operators can't trust the mini-preview as a reflection of what's on the broadcast.
**Correction (commit pending):**
- `apps/web/src/app/admin/broadcast/v2/[sessionId]/MatchDaySelector.tsx` — wrapped `setSessionMatchDayAction` in try/catch; introduced `error` state; render error in the existing `[role=status]` live region with `text-[var(--flare)]` + `aria-invalid` on the select. Errors clear on next attempt.
- `apps/web/src/components/broadcast/v2/controls/LowerThirdControl.tsx` — replaced `window.prompt()` with inline input + Save/Cancel buttons. New `presetNameDraft: string | null` state (null = not editing). Enter commits, Escape cancels. Test updated to assert prompt is NOT called + new test for Esc/Cancel paths.
- `apps/web/src/components/broadcast/v2/overlay-keys.ts` — `v2OverlayUrl(...)` now accepts `active` arg; preview URLs append `&active=0|1`, live URLs (no preview) never include it. `apps/web/src/components/broadcast/v2/ControlCard.tsx` — accepts `active` prop, threads it through the preview URL. `apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx` — reads `preview` + `active` query; non-preview URLs default to `active=true` so OBS / standalone smoke calls keep their existing fetch-on-mount behaviour. `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx` — new `active?: boolean` prop (default true); initial-fetch effect short-circuits when `active=false`. Realtime channel subscription stays on regardless so server state changes mid-session repaint the iframe.
- 6 control wrappers updated to pass `active={active}` to `ControlCard`: LeaderboardControl, MatchScoresDayControl, TopScorersControl, OrgsControl, CoachesControl, PenaltiesControl. Other controls don't have `INITIAL_FETCH_PATH` entries so the gate is irrelevant for them.
**Rule for future:**
1. **`useTransition` swallows promise rejections.** When wrapping a server action in `startTransition(async () => { await action(...) })`, ALWAYS try/catch inside the async callback + surface the error to local state. Otherwise users see the spinner clear with no feedback when the server throws — looks like a silent fail. Pre-flight: any server action that can throw a 23505 / RLS / permission error needs a UI surface for the message.
2. **Never use `window.prompt`/`confirm`/`alert` in production UI.** They look unstyled, freeze browser automation (Playwright + claude-in-chrome wait forever), and break keyboard nav. Always inline a small input + Save/Cancel buttons or a styled modal. Use `useState<string | null>` (null = collapsed) to toggle the editor.
3. **A mini-preview iframe is NOT the live overlay.** When a preview iframe carries its own data-fetch + auto-show logic, gate that logic on the SERVER's actual active state, not just on iframe mount. Pass the active flag via URL search param (preview-only) so the OBS browser source path is unaffected. Realtime updates flow regardless — only the initial seed needs gating.
4. **Update the test in the same slice as the fix.** Removed `window.prompt` → existing test that mocked prompt is now wrong. Added gate prop → existing test that fetched on mount needs an explicit `active={true}` companion + a new `active={false}` negative test. Don't ship a fix that leaves green tests asserting the OLD behavior.


---

**Date:** 2026-04-26
**Context:** Hour-before-event hotfix pass: 5 user-reported overlay bugs blocking the live stream. (1) Lower-third slot 1 trigger leaks into all 3 mini-preview cards because OverlayDataInjector relays the realtime `instance.triggered` channel into every cards iframe regardless of slot scope; exit anim "single frame" jump cut. (2) Score-bug photos do not update + king nonex shows back-facing pose: `V2_PLAYER_SLUGS.king_nonex` (underscore) does not match the asset folder `kingnonex`, and pose 1 has `face_detected:false` per manifest. (3) Up-next photos same kingnonex pose 1 issue. (4) Match-scores-day fires once then breaks + needs photos: server `MatchScoreRow` shape carries `home`/`away` strings only — no `slug`/`photoUrl` — so the HTML row builder renders empty `<img>` tags. The 3-part split (Part 1/2/3 + Show all) is operationally unreliable. (5) Leaderboard rows fade in instead of sliding in.
**Mistake:**
- (Bug 1) `OverlayDataInjector` subscribes ALL preview-iframe instances to `overlay:<sessionId>`. Three lower-third cards = three independent subscriptions = every `instance.triggered{slot:1,...}` fires postMessage `{type:"show",slot:1,...}` into ALL three nested HTML iframes. The HTMLs slot routing is correct — but inside card 2 the slot-1 anchor renders even though card 2 is supposed to drive slot 2.
- (Bug 1 exit) `.lt` baseline opacity 0 + `.lt.exiting { opacity: 1 }` snap from 1 → 0 with no transition when the `exiting` class is removed at +1100ms.
- (Bug 2/3) `V2_PLAYER_SLUGS` in TS includes `king_nonex` but the asset folder is `kingnonex` (no underscore). The score-bug `photoUrl(slug)` did no canonicalization. Pose 1 for kingnonex has `face_detected:false` per manifest.json — never reviewed before defaulting to it.
- (Bug 4) `match_scores_day_data.ts` returns `home: string` only. The HTML expected `m.p1PhotoUrl` field but server never populated it. Schema also missed `homeSlug`/`awaySlug`. Result: 13 rows render with empty photos.
- (Bug 5) Leaderboards row entrance was `opacity 0 → 1` only. The gate-observers `INNER_SEL` includes `.row` and forces inline `opacity: 1 !important` when `body.cade-visible` is set — clobbering even an opacity-only animation, never mind a transform-driven slide.
- (Deploy gotcha) `.vercelignore` was excluding ALL `headshot_03*.png` and `fullbody_03*.png` under `KNOWLEDGE/brand-assets/players/processed/`. The prebuild sync script could not copy them on Vercel because the source files were not in the deployment payload. Local dev fine; prod 404 on every kingnonex pose-3 image.
**Correction (commits `62c70580` + `f195ad5e`):**
- Bug 1: threaded `?slot=N` query via `LowerThirdControl` → `ControlCard.previewSlot` → `v2OverlayUrl(slot)` → `/overlay/v2/[key]/page.tsx` → `OverlayDataInjector.slot` → static HTML iframe URL. The HTML reads `slot`, tags `body.cade-only-slot-N`, hides the other 2 anchors via CSS, ignores postMessages with mismatched `slot` field. `OverlayDataInjector` also filters realtime + parent-relay messages by slot. Live (OBS) URLs leave slot null so all 3 anchors render simultaneously on stream.
- Bug 1 exit: added `transition: opacity 280ms ease-out` on `.lt` baseline.
- Bug 2/3: added `SLUG_ALIAS` (`king_nonex` → `kingnonex`) + `NAME_TO_SLUG` (display-name fallback) + `POSE_FOR_SLUG` (`kingnonex: 03`) maps to 09-secondary-score-bug + 10-up-next-bug HTMLs. Routed all photo lookups through `canonSlug()` + `photoUrl(slug)` with pose override.
- Bug 4: extended `MatchScoreRow` (server) + `matchScoresDaySchema` (Zod) with optional `home_slug`/`away_slug`/`homeSlug`/`awaySlug`. Server pickSlug() canonicalizes `gamer_tag` (with king_nonex alias) or falls back to NAME_TO_SLUG for the display name. HTML mirrors the same maps; `resolvePhotoUrl()` builds `/processed/<slug>/headshot_NN_nobg.png`. Retired the partRange filter (single-page brief). Replaced 4 part-buttons with a single Trigger + Hide footer pair; tests updated.
- Bug 5: replaced `row-fade-in` keyframe with `row-slide-in` (translateX -72px → 0 + opacity 0 → 1) at 80ms stagger across all 13 rows. Animation gated under `body.cade-visible .row` so it restarts on each show cycle. Removed `.row` from gate-observer `INNER_SEL` so the keyframe drives entrance unambiguously without inline-opacity contention.
- Deploy: tightened `.vercelignore` from `headshot_03*.png` to `headshot_03.png` (skip non-_nobg original only); same for `fullbody_03`. Pose 4 + 5 still blocked. Adds ~3MB to Vercel payload — acceptable.
**Rule for future:**
1. **Mini-preview iframes that share a realtime channel MUST scope their data flow.** When N cards render the same overlay key with different roles (slots, instances, partitions), thread a scope param via every layer (control component → URL → injector → static HTML). The realtime relay AND parent postMessage relay AND the static HTML message handler ALL need to filter by that scope — any single missing layer leaks events between cards.
2. **Pre-flight: when adding ANY animation that uses opacity, audit the gate observer for that overlay.** If the keyframe drives `opacity: 0 → 1` and the observers `INNER_SEL` includes the element, the inline-`!important` will clobber the keyframe. Either (a) drive only transforms in the keyframe and let the observer handle opacity, or (b) remove the element from `INNER_SEL` and ensure the keyframe `forwards` lands at opacity 1.
3. **Slug-name mismatch is a cross-layer bug.** When the TS `V2_PLAYER_SLUGS` const gets an aberrant value (`king_nonex` underscore) but the asset folder is `kingnonex` (no underscore), every overlay HTML that hardcodes `players/processed/${slug}/...` will 404 silently. Each new overlay HTML MUST: (a) normalize via SLUG_ALIAS, (b) fall back to NAME_TO_SLUG when slug is empty, (c) document POSE overrides for face-detected variants. Centralize in a shared `_canonical-slug.js` snippet for future overlays.
4. **`.vercelignore` exclusions for asset bulk are landmines for new asset paths.** Any pattern like `*.png` under `KNOWLEDGE/brand-assets/players/processed/*/` will silently break in production whenever an overlay starts referencing a new file path that matches the pattern. When introducing a new asset path, run `git check-ignore -v <path>` BEFORE pushing — if it matches a `.vercelignore` rule, narrow the rule. Pre-flight: `curl -sI prod-url/<path> | head -1` should always return 200, never 404.
5. **Server data shape changes break HTML render contracts silently.** If the static HTML expects `m.p1PhotoUrl` and the server returns only `m.home`, the row renders with empty `<img>` — no console error, just an invisible photo. When extending an overlay payload, update BOTH the Zod schema AND the server reader AND the HTML render path in the same slice. The 3-prong update is mandatory; partial updates fail silently.

**Date:** 2026-04-27
**Context:** User reported (a) home page header read "Elite eFootball" but league plays EAFC, and (b) on the public homepage all match-day fixtures were visible regardless of admin publish state, plus a match day on 26 May 2026 still rendered status "scheduled" after the day was already played, with no admin button to mark it complete.
**Mistake:** Three gaps shipped together. (i) Hero + layout meta hardcoded the wrong game name. (ii) `apps/web/src/server/homepage.ts` filtered next match day by `status='scheduled' AND match_date >= today` only — no `published_at IS NOT NULL` gate, so any draft match day with a future date leaked into the public "Upcoming" card before LOC released it. (Fixtures page itself already gated correctly, but the homepage card didn't.) (iii) `match_days.status` enum already had `('scheduled','in_progress','completed','cancelled')` and the public `FixtureList` already mapped `completed → "Final"`, but no UI surface let admin actually flip the state — only publish/unpublish buttons existed. Status was effectively immutable post-create.
**Correction:**
- `apps/web/src/components/public/home/Hero.tsx` + `apps/web/src/app/layout.tsx` (title + openGraph) + `apps/web/.env.example` — `eFootball` → `EAFC` everywhere user-visible. OCR system prompt at `parse.claude.ts:26` left untouched (flagged "verbatim from spec").
- `apps/web/src/server/homepage.ts` — added `.not("published_at", "is", null)` AND swapped `.eq("status", "scheduled")` for `.in("status", ["scheduled","in_progress"])` so live + upcoming render but `completed`/`cancelled` drop off. Also threaded `status` through `HomeMatchDay` type so UpcomingMatchDayCard can render the real label.
- `apps/web/src/components/public/home/UpcomingMatchDayCard.tsx` — `STATUS_LABEL` map (scheduled/in_progress/completed/cancelled → label+hint) replaces the hardcoded "Scheduled" Stat.
- `apps/web/src/server/matches/match-days.ts` — new `setMatchDayStatus(sb, actor, id, status)` server fn re-using the `match_days.publish` permission (admin + loc).
- `apps/web/src/app/admin/match-days/[id]/actions.ts` — `markMatchDayCompleteAction` + `reopenMatchDayAction`, both `revalidatePath`'ing `/`, `/fixtures`, `/admin/match-days`, `/admin/match-days/[id]`.
- `apps/web/src/app/admin/match-days/[id]/page.tsx` — toggle button: "Mark complete" when status≠completed, "Reopen match day" when completed.
**Rule for future:**
1. **Game name is brand.** Anywhere the league's game-of-record is named in user-visible copy (Hero, meta description, fixtures page, OG tags, terms doc, OCR error messages), it MUST match the actual title the league plays. Repo-wide grep for `eFootball|EAFC|EA Sports FC|FIFA` whenever the league's game changes — there is no single source of truth file for this constant yet, so a manual sweep is required.
2. **A "publish gate" is a multi-page contract.** When `published_at` gates visibility on `/fixtures`, audit EVERY other public render path that touches the same table — homepage cards, dashboards, RSS, OG previews, embed widgets. Adding the gate to one page leaves the rest leaking. Pattern to grep: `from("match_days")` AND not `.not("published_at",`.
3. **Status enums need WRITE paths from day one.** When migration ships an enum like `status IN ('scheduled','in_progress','completed','cancelled')`, the same slice MUST add admin-side mutations + UI buttons for each non-default value. Creating only the create/read paths and assuming admins will "edit JSON later" is how stale-status bugs ship. Pre-flight before merging a status migration: `grep -r "setMatchDayStatus\|update.*status" src/server/matches` should return at least one mutation per terminal state.
4. **"Where do I click to make X happen?" is a UX-completeness bug, not a docs gap.** When user asks that question, the answer is never "in psql" or "the API directly" — they're flagging that the workflow is incomplete. Treat it as P1 immediately + add the button.
5. **Always push to prod after a user-facing fix.** User corrected me on this same date: stopping at localhost is not "done." Every fix lands on https://cade-league.vercel.app via `git push origin main`. Verify on the prod URL, not localhost. Skip the push only when user explicitly says don't.

**Date:** 2026-04-27
**Context:** User asked why `git push origin main` wasn't producing a deploy on https://cade-league.vercel.app — pushed two commits (`b14ff94e`, `c0b87141`), prod still served the old build with "eFootball" instead of "Nigeria's EAFC". Investigation found: GitHub Actions `lint-and-test` workflow exited 1 within 45s of every push, and Vercel had zero deployments registered against the latest commit (`gh api .../commits/<sha>/check-runs` showed only the failing CI; `gh api .../commits/<sha>/statuses` returned `[]`).
**Mistake:** Three independent failure modes stacked. (i) GitHub Actions runner ran `npm ci` then `npm run test` and crashed because `apps/web/vitest.config.ts` imports `@vitejs/plugin-react` but the package was never declared in `apps/web/package.json` devDependencies — only resolved transitively on the dev workstation via the workspace's hoisted `node_modules`. CI's clean install never grafted the transitive, so the import 404'd at vitest startup. (ii) Even after pinning the devDep, `npm run build` failed in CI because the GH runner has no Supabase env (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Pages like `/punishments` that call `getServiceRoleSupabase()` at static-gen time hit a constructor that throws on missing env, and Next 15 promotes any prerender error to a hard build failure, exit 1. (iii) The Vercel project at `prj_TNIIsb6FOO18reZiI8qnJaR5FYhc` was created manually via `vercel deploy --prod` and never had its Git Source connected — `vercel project inspect cade-league` showed no Git section. So GitHub pushes literally never reached Vercel; every "deploy" up to this date had been a hand-run CLI command. Memory entry "Prod alias points at commit `3c2e03d2`" was the smoking gun for the manual-promote pattern, but I missed it on first pass.
**Correction:**
- `apps/web/package.json` — `npm install --save-dev @vitejs/plugin-react@^6.0.1` (commit `d12b4856`).
- `apps/web/src/server/overlays/schemas.test.ts` — drop the `standings_widget rows: [] should throw` assertion since the schema flipped to `min(0)` in `e2f377da`; replace with `>20 should throw`.
- `.github/workflows/ci.yml` — replace `npm run build` with `npx --workspace apps/web tsc --noEmit`. Type guarantees without static-gen so missing env doesn't poison the run. Vercel's build with project env in scope is the real prod-build guard (commit `dfaf89e9`).
- `apps/web/src/app/punishments/page.tsx` — `export const dynamic = "force-dynamic"` so any future build that DOES have env still skips static gen on this auth-aware route.
- Vercel link via `vercel git connect https://github.com/Layott/cade-league-platform`. Required the GitHub repo to be public OR the user's Vercel-GitHub auth to cover private orgs; we flipped the repo public after a `git log -p --all -S` audit confirmed zero secrets ever committed (437 commits, every plausible token pattern + every plausible env-file name searched, all 0).
**Rule for future:**
1. **Workspace-hoisted devDeps lie about what CI will see.** Anything imported by a workspace package's config file (vitest.config, vite.config, next.config) MUST be declared in THAT workspace's package.json devDependencies, even if `npm ls` shows it resolves via the parent. CI does a clean install against ONE workspace at a time and won't graft. Pre-flight: `cd apps/<pkg> && rm -rf node_modules && npm ci --workspaces=false && npm test` will surface this before push.
2. **CI `next build` requires runtime env, or it dies on prerender.** Don't run `next build` in CI for any app whose pages touch Supabase / auth / cookies at module scope unless you also seed every required env var as a GH secret. Cheaper alternative: `tsc --noEmit` for type guarantees, let Vercel's build (which has project env) be the real prod-build oracle. The cost: type errors that ONLY surface during static analysis (`generateStaticParams`, route segment configs) will land on Vercel instead of CI — usually fine because Vercel blocks promotion on build failure.
3. **Vercel auto-deploy is not the default — it requires `vercel git connect`.** Just having `.vercel/project.json` linked + a deployed project doesn't mean GitHub pushes auto-build. Verify with `vercel project inspect <name>` — if there's no `Git` section, the project is in manual-promote mode. Connect with `vercel git connect <repo-url>`. Symptoms: `gh api .../commits/<sha>/statuses` returns `[]` and `gh api .../commits/<sha>/check-runs` shows only your own GH Actions, no `Vercel` checks. Memory cue: an entry like "Prod alias points at commit X" usually means manual-promote.
4. **Public-flip of a repo is reversible only at GitHub's mercy.** Run a full git-history secret audit BEFORE flipping (`git log --all -p -S<pattern>` for every JWT/AWS/PAT/Stripe pattern + scan every commit's `--diff-filter=A --name-only` for any `.env`-shaped path), even when you're sure `.gitignore` was clean from commit 1. Confirm with the user. After the flip, enable Push Protection + Secret Scanning (free for public repos) so future regressions are blocked at `git push` time. Never flip on speculation.
5. **A "Dynamic server usage" warning during prerender is not the bug — it's the bail-out.** Next.js logs `[UserBadge] falling back to SignInLink: Dynamic server usage: Route X used cookies` for every route that bails into dynamic mode; those are info-level. The actual hard error is `Error occurred prerendering page "Y"` followed by a stack trace pointing at the page module — find that line, not the dozens of dynamic-bail messages above it.

**Date:** 2026-04-27
**Context:** User reported the public `/fixtures` page showed two ADEFOLA-vs-GURU matches on the 2026-04-26 match day instead of one — fixture count 11 instead of 10. They also asked whether both were feeding standings.
**Mistake:** Supabase relation embeds do NOT inherit the parent query's `deleted_at IS NULL` filter. The fixtures page query was:
```
sb.from("match_days")
  .select("..., matches:matches ( ..., result:match_results (...) )")
  .is("deleted_at", null)            // applies to match_days only
```
The duplicate match `63968865-7c26-4c23-a2ed-6bc6c20a314f` had `deleted_at = 2026-04-26T16:23+00:00` set (admin had soft-deleted it days earlier via `/admin/match-days/[id]/Delete`). The match_day-level filter passed, the match-level filter never ran, the duplicate kept rendering. Standings were always correct because `recompute_standings()` reads `match_results` directly with its own `deleted_at IS NULL` filter — and the duplicate had no result row at all — but the public list looked broken.
**Correction:**
- `apps/web/src/app/fixtures/page.tsx` — added `deleted_at` to BOTH the `matches` and `result:match_results` embed selects, then in the `for (const md of data)` loop drop any `m.deleted_at != null` and treat any `result.deleted_at != null` as no-result. Type definitions `MatchJoin` + `ResultJoin` extended to carry `deleted_at: string | null` (commit `acb10d57`).
**Rule for future:**
1. **Supabase relation embeds need their own filters.** Any `select("parent.*, child:child(*)")` query embedding a soft-deletable child table MUST either (a) include `child.deleted_at` in the select and filter client-side, OR (b) use the `!inner` join form with an explicit `.is("child.deleted_at", null)` chain. The `is("deleted_at", null)` at the top level only filters the OUTERMOST table. Pre-flight grep before merging any new query: `grep -rE "from\\([\\"'][a-z_]+[\\"']\\).+\\(.+,\\s*[a-z_]+:[a-z_]+\\(" apps/web/src` — for every hit, verify each embedded relation has a `deleted_at` guard.
2. **Soft-delete invariant is global.** CLAUDE.md §7 says reads filter `WHERE deleted_at IS NULL`. Treat that as a row-level constraint that applies at every join depth. The bug here was an architectural drift — the rule existed but the embed didn't enforce it. Audit every public-render query (homepage, /fixtures, /standings, /announcements, /players, /punishments) for this pattern in any future schema-touch.
3. **"X is showing twice in the UI" is almost always either (a) a missing `deleted_at` filter on a soft-delete chain, or (b) a duplicate row created by a re-run admin script.** Always query the live DB to disambiguate before guessing — `select id, deleted_at, created_at` over the matching pair tells you instantly which class of bug it is. In this case query showed `deleted_at` set on one row + null on the other = class (a) confirmed, fix is the query, not the data.
4. **Standings ≠ public list.** A symptom in the public render path doesn't imply standings drift. Standings have their OWN read path (the recompute view) which has its OWN filters. Don't claim standings are "wrong" until you've checked the recompute output against the same row. Reassure the user separately on each.


---

**Date:** 2026-04-29
**Context:** 5-phase parallel-agent delivery of the overlay design system (spec → migrations → server modules / overlay HTML rewires → admin UI → E2E + smoke + docs). Phase 1 schema, Phase 2 server modules + 16 overlay HTML CSS-variable rewires (split across two agents 01-09 + 10-17), Phase 3 admin UI + SSR token injection, Phase 4 E2E + smoke + lessons + CLAUDE.md §15. Five clean commits on `main`: `6f16a110` → `09f0849c` + `c591fc0e` + `3ca069ac` (Phase 2 trio) → `ec26616e` → Phase 4. Token resolution merges DB rows over hard-coded `defaults.ts`; SSR injects `<style id="overlay-design-tokens">:root{ --overlay-X: value }</style>` so OBS browser sources reflect token changes within one Realtime tick — no redeploy.
**Mistake:** None this slice — the multi-agent execution was clean. Capturing the lessons that DID surface so the pattern is reusable:
1. **RegExp serialization** (already documented for Slice 4 segmentMatcher; reaffirmed here): when an agent prompt mentions test fixtures crossing a process boundary, never serialize a `RegExp` literal — pass the source string and rebuild on the receiver. Same applies to overlay-token preview encoding: the editor base64-encodes a JSON map (no regex), the server decodes + escapes via `escapeCssValue`. A `RegExp`-as-token would have broken between client and server.
2. **Phase 2 parallelism**: HTML rewires + server modules are independent file scopes — `apps/web/src/server/overlays/design/*` vs. `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html`. OK to run concurrently. Migration agent (Phase 1) MUST come first because the server module imports tables that don't exist until then.
3. **One-commit-per-phase pattern works well for safe rollback.** The 3 Phase-2 agents committed in interleaved order (`09f0849c` → `c591fc0e` → `3ca069ac`) without conflicts — file scopes were genuinely disjoint. If any one had blown up, the other two would still merge.
4. **Server-only token resolution avoids the "tokens must be in the static HTML" trap.** The HTML keeps `var(--overlay-X, fallback)` so it stays correct even when SSR injection isn't available (e.g. mirror-only OBS direct file load from `/overlays/v2/<key>/index.html`). The injected `<style id="overlay-design-tokens">` block on the SSR route layers DB tokens on top, the optional `<style id="preview-tokens">` block (admin live preview) layers `previewTokens` on top of that. Cascade resolves cleanly.
5. **Synchronous polling-loop brief in agent prompts beats the Monitor anti-pattern every time.** When an agent says "I'll set up a Monitor and exit," kill + relaunch with a synchronous brief that loops until done. The Monitor pattern caused 3 wasted agent runs earlier this session — silent stall, no completion notification, context-budget burn. CLAUDE.md §13 covers this for general agent ops; reiterating here because the design-system rollout almost hit it again on Phase 2.
**Rule for future:**
1. When delivering a multi-phase greenfield feature with file-scope-disjoint phases, dispatch each phase as one focused agent (or a parallel agent set when phases are independent), one commit per phase. Never let a single agent run all phases — context bloat + no rollback granularity.
2. Pre-flight check before launching parallel agents: do their file scopes intersect? Migrate-then-server-then-UI is mostly safe; "two agents both editing `OverlayDesignEditor.tsx`" is not.
3. Token catalogs (`defaults.ts` `TOKEN_CATALOG`) are seed docs + UI knob source. Adding a new token = update `defaults.ts` + add a `TokenRow` branch in `OverlayDesignEditor.tsx` + (if non-default) seed an override in `OVERLAY_OVERRIDES`. No migration needed.
4. CSS variables on the SSR route + fallbacks in static HTML = safest pattern for "operator can change colors without redeploy". Avoid postMessage-driven token updates — they require runtime listeners in every overlay HTML and break the static-mirror fallback.
5. Smoke scripts under `apps/web/scripts/_*.mjs` are one-shots. Run, capture output, `rm` immediately so git status stays clean. Never commit them; the lesson + the spec carry the institutional memory.

**Date:** 2026-04-28
**Context:** Phase A bug fix for overlay design system — user manually verified via Claude-in-Chrome that the persisted DB tokens + admin live-preview overrides on `/overlay/v2/<key>` were NOT reaching the actual rendered overlay HTML. The SSR route correctly injects `<style id="overlay-design-tokens">` and `<style id="preview-tokens">` on the OUTER document, but the actual overlay HTML lives in an `<iframe src="/overlays/v2/<key>/index.html">` (separate document). CSS custom properties scope to a document — they do NOT cross iframe boundaries. The iframe's `:root{}` always resolved to its own hard-coded fallbacks regardless of what the outer page injected.
**Mistake:** I assumed CSS variable inheritance worked across iframe boundaries because the SSR `<style>` blocks render correctly in the outer DOM. Two follow-on bugs:
1. **Cross-document propagation:** the bootstrap script that fixed the iframe path needed to be added to all 8 full-canvas overlay HTMLs. Inline `<script>` reading b64-encoded `?tokens=` and `?previewTokens=` from `location.search`, decoding to JSON, building a `:root{...}` rule, and appending a `<style id="cade-injected-tokens">` block to `document.head`.
2. **Cascade ordering inside the iframe:** my first iteration of the bootstrap ran SYNCHRONOUSLY during head parse (when `document.head` exists already). At that moment the subsequent author `<style>` blocks haven't been added yet, so the runtime `appendChild` lands BEFORE them in source order. Author `:root{...}` defaults then win the cascade and the override is invisible — `INJECTED=true` but `BG=#050505` (still default) instead of `#ff0000`.
**Correction:**
- New migration `supabase/migrations/20260612000001_overlay_design_tokens_bg_image.sql` extends `token_type` CHECK to allow `'image'` and seeds 8 default rows.
- New migration `supabase/migrations/20260612000002_overlay_bgs_bucket.sql` provisions the `overlay-bgs` storage bucket (5 MB cap, image/png|jpeg|webp).
- `apps/web/src/server/overlays/design/tokens.ts` — TokenType union + `escapeUrl` helper.
- `apps/web/src/server/overlays/design/defaults.ts` — `bg-image` token catalog entry + `BG_IMAGE_SUPPORTED_KEYS` + `supportsBgImage()` helper. Only the 8 full-canvas overlays expose the widget.
- `apps/web/src/components/admin/OverlayDesignEditor.tsx` — `ImageRow` widget with file input, 80×45 thumb, Upload (POST FormData → `uploadOverlayBgAction`), Clear (calls `onChange("")` for save-time pickup). Filters image-typed catalog entries via `supportsBgImage`.
- `apps/web/src/app/admin/broadcast/v2/design/actions.ts` — `uploadOverlayBgAction(FormData)` with MIME + size + key gates. Service-role storage upload + `setDesignToken` write.
- `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx` — `designTokens` + `previewTokens` props serialized into iframe URL as `?tokens=<b64>&previewTokens=<b64>`. Unicode-safe base64 via `btoa(unescape(encodeURIComponent(json)))`.
- `apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx` — pass through to `OverlayDataInjector`.
- 8 overlay HTMLs (source + public mirror): inline `<script id="cade-token-bootstrap">` between `</title>` and `<style>` that reads URL params, decodes, and ALWAYS defers `appendChild` to `DOMContentLoaded` so the injected style block lands at the END of `<head>` (AFTER all author `<style>` blocks → wins source-order cascade).
- 7 of 8 overlays got `background-image: var(--overlay-bg-image, url('...ELITE S2 BG.png'))`; 07-leaderboard's previous `.bg-fill` (green linear-gradient) was rewritten to use the ELITE S2 BG fallback + `.bg-halftone` set to `display:none` (S2 bg already has texture).
- E2E spec `apps/web/tests/e2e/overlay-design-tokens.spec.ts` extended with a `bg-image propagates through iframe` test that asserts the iframe's computed `--overlay-bg-image` after persisting + reverting.
- Unit test `defaults.test.ts` extended with `supportsBgImage` + `BG_IMAGE_SUPPORTED_KEYS` coverage (17 → 23+ tests).
**Rule for future:**
1. **CSS variables do NOT cross iframe boundaries.** Whenever a parent SSR route relies on `:root` custom properties to style content INSIDE an iframe, you MUST plumb those values through the iframe's URL (or postMessage) so the iframe's own document evaluates them. Same-origin doesn't help — the cascade is per-document.
2. **Inline bootstrap scripts that mutate `<head>` MUST defer to `DOMContentLoaded`** when their goal is to OVERRIDE author `<style>` blocks that appear later in source order. Running synchronously during head parse appends BEFORE the later blocks → cascade order is wrong → override is invisible. Pre-flight check: if you're injecting via `appendChild` and the page also has author `<style>` after your `<script>`, you're racing against the parser.
3. **When extending a CHECK constraint** (`overlay_design_tokens.token_type` adding `'image'`), use a DO-block to look up the constraint name via `information_schema.check_constraints` rather than relying on a deterministic name — Postgres assigns implicit names that aren't always reproducible across environments.
4. **Storage upload server actions** must validate ALL of: MIME (allowlist), byte size, overlayKey (capability gate via `supportsBgImage`). Plus a defence-in-depth check on the public URL before persisting (no CSS metacharacters) — the URL becomes a token value that lands in a `:root{}` rule.
5. **Multi-file HTML mutations across source + public mirror** must use a one-shot script under `apps/web/scripts/_*.mjs` to keep the change byte-identical and idempotent. Run, verify, `rm`. Never commit the script — the change is the artifact.

**Date:** 2026-04-29
**Context:** Phase B1 + B2 overlay polish. The brief instructed me to verify "byte-identical" between `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` and `apps/web/public/overlays/v2/<key>/index.html`. After running `node apps/web/scripts/sync-v2-overlays.mjs`, `diff` still showed differences — most lines around `../../../<bucket>/...` vs `/overlays/v2/_assets/<bucket>/...`.
**Mistake:** I almost rolled back the sync, thinking it had failed, before reading the script source. The sync script's `rewritePaths()` regex INTENTIONALLY rewrites source-relative paths (`../../../fonts/...`) to absolute web-served paths (`/overlays/v2/_assets/fonts/...`) during the mirror copy. So source and mirror are NEVER byte-identical for overlays that reference `../../../<bucket>/`. The brief's "byte-identical" instruction was based on a stale model.
**Correction:** The verification gate for sync should be: `diff source mirror` produces ONLY lines containing `../../../<bucket>/` on one side and `/overlays/v2/_assets/<bucket>/` on the other side. Any other diff = unmirrored source change OR a divergent edit landed only in one tree.
**Rule for future:**
- Read `apps/web/scripts/sync-v2-overlays.mjs` (specifically the `rewritePaths` function, currently regex `/\.\.\/\.\.\/\.\.\/(fonts|logos|players|Orgs|designsample)\//g` → `/overlays/v2/_assets/$1/`) before claiming source/mirror parity.
- The sync script also handles `chokidar` watch mode + asset bucket copying; running the script is the safest way to ensure both copies are aligned. Manual `cp` invites missed path rewrites.

**Date:** 2026-04-29
**Context:** Phase B1 + B2 commit. When I ran `git stash --include-untracked --keep-index` to test the build state without my changes, on `git stash pop` I unexpectedly got modifications to `KNOWLEDGE/brand-assets/elements/v2/04-h2h-2/index.html` and `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx` — files I had NOT edited. There was a pre-existing stash `pre-slice3-wip` (stash@{1}) on the workspace from another agent's session.
**Mistake:** Used `git add` against specific files (so the commit stayed clean), but if I had done `git add -A` the commit would have swept in B4-B5 work-in-flight from another agent. That would have created a Frankenstein commit + likely broken main due to the untracked `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts` shipping a TypeScript error.
**Correction:** Always stage explicitly by file path when other agents may have churn in the workspace. Pre-commit pre-flight: `git status --short | grep "^M "` to see only what's already staged; `git diff --staged --stat` to see what will land in the commit.
**Rule for future:**
- NEVER use `git add -A` or `git add .` when the workspace contains modifications you didn't make. Always pass explicit file paths.
- Before `git stash`, check `git stash list` — an existing stash `pre-<something>` from another agent means popping or applying stashes is risky. Prefer NOT to stash; instead use `git status` snapshot + verify changes manually.
- After ANY stash operation that touched untracked files, re-run `git status` to see if files appeared that weren't there before. Cross-reference against your own edit log.

**Date:** 2026-04-28
**Context:** Phase B6 — `/overlay/v2/14-top-scorers`. User reported "random goal numbers in OBS, only top 3 with no pictures". The `__cadeRunDigitRoll` JS had `parseInt(p1.dataset.target || p1.textContent, 10) || 22` (and similar `|| 19`, `|| 17`). The static HTML's `data-target="22"` was a designer-time placeholder so the file looks correct when opened directly. But in production, when the live broadcast control panel pushed `show` without `data` (or before the first `update` arrived), the digit-roll re-read those static seeds and rolled to 22 / 19 / 17 — phantom goal counts.
**Mistake:** Treated the demo seeds as harmless. Static HTML "designer-time" placeholders are NOT inert in OBS — they live until JS overwrites them. If a user can hit the deployed URL directly (without `?demo=1`), they see whatever lives in the static markup.
**Correction (commit TBD this session):**
- `__cadeRunDigitRoll` no longer fallbacks to hardcoded goal counts. `parseInt` returning NaN now branches to render `—`.
- New `cade-clear-static-seeds` IIFE runs on load when `?demo=1` is absent. It strips `data-target` + replaces text + clears photo `src` for all 3 podium pods + 7 tail-strip cells.
- `update()` for the empty-payload branch now also strips `dataset.target` so the digit-roll skips that pod.
**Rule for future:**
1. Any "designer-time placeholder" string / number / image src that lives in static HTML and is later overwritten by JS MUST be cleared on load when the overlay is opened in production mode (no `?demo=1`). The clear runs BEFORE any animation triggers, so the producer never sees the seed flash through.
2. Demo guards must be CONSISTENT: if you guard the visibility loop on `?demo=1`, also guard the data seeds. Otherwise an OBS load (no `?demo=1`) shows the seed data even though the demo loop never fires.
3. When a `__cadeRunDigitRoll` (or similar) reads from `dataset.X`, it MUST handle NaN as a deliberate output, not a fallback to a hardcoded value. Hardcoded fallbacks become permanent placeholders the moment live data is empty.

**Date:** 2026-04-28
**Context:** Phase B3 — `/overlay/v2/09-secondary-score-bug`. User said the entry animation "cracks". The `@keyframes entry` had 4 stops with overshoot at 35% (`opacity 0.7`) + 72% (`scale 1.02`) + a bouncy cubic-bezier (`y2 = 1.18`). Combined with a concurrent `glowPulse 3.2s infinite` running on the inner `.bar` (which paints box-shadow continuously), the GPU was juggling two animation timelines with overlapping repaints during the transform-heavy entry.
**Mistake:** Multi-stop "anticipation + overshoot" keyframe sequences look great in design tools but stutter on Chromium when (a) any non-trivial concurrent animation also paints, OR (b) the overshoot triggers >3 layout passes in 0.3s. The crack the user perceived was the GPU dropping a frame at the 35%/72% intermediate stops.
**Correction (commit TBD this session):**
- Replaced 4-stop `@keyframes entry` with smooth 2-keyframe ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`, 0.65s, no scale overshoot, no opacity hold).
- Deferred `.bar` `glowPulse` until entry completes via `.bug-mount.entered .bar { animation: glowPulse ... }`. JS adds `.entered` on `animationend` of the `entry` keyframe (named-event filter so other animations don't trigger it).
**Rule for future:**
1. For "enter from off-screen" reveals on small UI elements, a single ease-out curve (0.5-0.7s) almost always beats multi-stop overshoot. Save anticipation/overshoot for HERO transitions, not chrome bug-bars.
2. If a target element has an INFINITE animation (glowPulse, breathe, etc.) AND an entry animation, gate the infinite one on a post-entry class. Don't rely on `animation-delay` — it doesn't pause the GPU's anticipated paint cycle, just delays the visible start.
3. `animationend` listeners MUST filter on `event.animationName` — otherwise `pulseRing`, `scorePop`, and other transient animations on the same element will all fire the listener and cause class-add/remove churn.

**Date:** 2026-04-28
**Context:** Phase B4-B5 + C — H2H 2/3/5-player overlays. User reported the player columns' entry animation felt muted, the stat-row cells were stuck on hardcoded `0` / `—` placeholders even with live data flowing, and there was no live-data feed wiring to the standings recompute. Three failure modes:
1. The `cade-visible-gate-observer-v2` script was forcing inline `opacity: 1 !important` on `.player-col` / `.player-card` / `.card` the moment `cade-visible` landed. The CSS keyframe entry animation (`player-a-in { 0% { opacity: 0 } 100% { opacity: 1 } }`) lost the cascade fight because inline-`!important` beats stylesheet-`!important`. The slide ran but the from-step never painted, so it looked like a dim teleport instead of a slide.
2. The HTML's `update(data)` function only set `name / photoUrl / orgLogoUrl`. It never read `data.players[i].stats` or any of the H2HCard top-level fields (`pos`, `played`, `wins`, `gd`, etc), so the stat cells stayed on whatever the static HTML had hardcoded. There was also no `data-stat="<key>"` attribute machinery to drive a generic update — every stat would have needed a bespoke selector.
3. None of the three H2H keys were registered in `OverlayDataInjector` `INITIAL_FETCH_PATH` or `REALTIME_KEY_EVENTS`. So even if the HTML's update() had handled stats, no data was reaching it from the server. The existing `/api/tournament/h2h` endpoint was perm-gated (`tournament.read`) which is admin-only — wrong for unauthenticated OBS browser sources.
**Mistake:** Three separate root causes that compound:
- Gate observer scope was set to "everything that gets entry-animated" without distinguishing CSS-keyframe-managed vs JS-managed visibility. Anything with a from-opacity:0 keyframe MUST be excluded from the observer's force-opacity:1 list.
- `update(data)` was written assuming the postMessage payload from the broadcast control panel was the only data shape. The new server endpoint returns `{cards: H2HCard[]}` (different field names: `pts` not `points`, `pos` not `position`, etc.) — the handler needs to normalize both into a unified `info.stats` bag.
- New auto-update overlays were added without registering their data feed wiring. This is a 3-file ship: endpoint + injector entry + dual-shape handler. Skipping any one means the overlay is a frozen placeholder forever.
**Correction (commit TBD this session):**
- New endpoint at `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts` — view-token gated (NOT perm gated), accepts `?ids=A,B[,C][,D][,E]` OR `?key=04-h2h-2|05-h2h-3|06-h2h-5` (resolves pinned players from latest `overlay_events.payload.players[].displayName` → `users.gamer_tag` → `players.id`). Returns same `H2HCard` shape as `/api/tournament/h2h`.
- `OverlayDataInjector.tsx` `INITIAL_FETCH_PATH` extended to take `(sessionId, overlayKey)`; three new entries point H2H keys at the new endpoint. `REALTIME_KEY_EVENTS` adds `["standings.changed"]` for the same three keys.
- All three H2H overlay HTMLs (source + public mirror): added `data-stat="<key>"` attributes to every value cell, new `applyStatsToSide`/`applyStatsToCard` helper, `readPlayer()` extended to normalize H2HCard fields into `info.stats`. `update(data)` accepts both `{players: [...]}` (postMessage) AND `{cards: [...]}` (server). Strengthened entry slide-in keyframes (-300/0/+300 for h2h-2; -250/0/+250 100ms-stagger for h2h-3; -400/-200/0/+200/+400 50ms-stagger for h2h-5). Dropped exit slide → fade only via `body.cade-exiting .player-col { animation: none; opacity: 0; transition }`. Removed `.player-col` / `.player-card` / `.card` from the gate-observer SEL list.
- CLAUDE.md §14 — new HARD RULE table listing all 11 currently-registered auto-update overlays + their endpoint + Realtime events.
**Rule for future:**
1. **HARD RULE — auto-update overlay = 3-file ship.** Endpoint + injector wiring + dual-shape handler. Never ship one without the other two. The endpoint MUST be view-token gated (this is for OBS browser sources, NOT admin React UI). The injector wiring is in `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx`. The handler MUST normalize the postMessage shape AND the server response into a single internal stats-bag so a single update path works for both.
2. **Gate observer SEL list excludes anything CSS-keyframe-animated.** If an element has a `from-opacity: 0` keyframe step, it MUST NOT be in the `cade-visible-gate-observer-v2` SEL list — the observer's `style.setProperty('opacity', '1', 'important')` will clobber the keyframe's from-step. Visibility for those elements is still gated via the `body:not(.cade-visible) <selector> { opacity: 0 }` CSS rule (no `!important` needed since the keyframe wins via inline-style + animation cascade). Pre-flight check: grep the overlay HTML for `@keyframes <name> { 0% { opacity: 0` and ensure none of those targets are also in the SEL list.
3. **Stat-cell DOM contract: `data-stat="<key>"` always.** When a designer adds a static placeholder (`<span>0</span>`), it MUST carry a `data-stat="<key>"` attribute matching the key the JS reads. Forget the attribute and the placeholder is permanent. Pre-flight: any `<span class="stat-value">N</span>` or similar without a `data-stat=` attribute is a bug. The same rule applies to `data-stat-label="<key>"` for labels that need dynamic text (e.g. "Win Prob · GD <±N>").

**Date:** 2026-04-28
**Context:** Phase C — `apps/web/src/app/api/broadcast/sessions/[id]/h2h/route.ts`. The route had `let ids: string[]; if (...) { ids = parseIds(...); if (ids === null) ... }`. Vitest unit tests passed; eslint passed; only `npm run build`'s tsc pass caught the type error: `Type 'string[] | null' is not assignable to type 'string[]'.`
**Mistake:** TypeScript strict mode does NOT follow type narrowing across reassignment. `let foo: string[]; foo = maybeReturnsTOrNull(); if (foo === null) return;` does NOT narrow the original `let foo: string[]` declaration — the assignment-time type was already widened to `string[] | null`. The narrow only works if the variable is `const` (so its type at declaration site IS the rhs type), not `let`.
**Correction:** Use a temporary `const parsed = parseIds(...)`, narrow with `if (parsed === null) return`, then assign `ids = parsed`.
**Rule for future:**
1. When parsing function may return `T | null`, prefer `const parsed = fn(); if (parsed === null) return; const ids = parsed;` over `let ids: T; ids = fn(); if (ids === null) return;`. The const path narrows; the let path doesn't.
2. Don't rely on eslint to catch type-narrowing bugs. Eslint runs without the TS type-checker. Always run `npm run build` (which runs `tsc --noEmit`) before claiming a route done.
3. Vitest unit tests with mocked Supabase clients won't catch type widening either — the mock returns `unknown[]` typed as `T[]` via cast, so the test can't trigger the strict-mode narrow check.

**Date:** 2026-04-29
**Context:** Bug 4 — match-scores-day overlay showed "MATCH DAY 8" + the wrong match-day's fixtures on the live OBS browser source, while the admin live-preview iframe showed the correct match-day. User triggered for Sunday Apr 26 (MD 1) and Saturday May 2 (MD 2); both worked in admin preview but rendered MD 8 (May 30) on OBS. Investigation showed two `stream_sessions` rows with `ended_at IS NULL` simultaneously — a leftover session created today (`73c21280...` started 13:44 UTC, pinned to MD 8) and the operator's actual driving session (`8018f9e3...` started 2026-04-26, pinned to whichever MD they were broadcasting). The admin route receives an explicit `?session=<id>&preview=1` so it always shows the right one. The OBS bare URL falls into ambient resolution via `getActiveSession()` — which picked "latest started_at" → the leftover session.
**Mistake:** The ambient resolver in `apps/web/src/server/broadcast/active_session.ts` selected `stream_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`. This rule fails any time more than one session is "active" simultaneously — the resolver picks the freshest `started_at` regardless of whether the operator is actually using it. Stale leftover sessions (test runs, accidental opens, sessions a producer forgot to End) will outrank the real driving session whenever they're more recently started. The admin preview was unaffected because it always passes its explicit `?session=<id>` param, so the divergence was invisible until OBS was tested.
**Correction:** `apps/web/src/server/broadcast/active_session.ts` reworked. New selection rule: pick the live session whose most-recent overlay-trigger activity (`overlay_events.triggered_at` ∪ `overlay_active_instances.triggered_at`) is freshest. This naturally tracks "the session the operator is currently driving" because trigger events fire whenever an admin clicks a control card. Falls back to `started_at DESC` when no triggers exist for any live session (fresh session, never driven yet). Tests added: 11 specs in `active_session.test.ts` including a Bug-4 reproduction case asserting "operator-driven session over leftover fresher session".
**Rule for future:**
1. **Admin-preview ↔ OBS divergence is a CLASS of bug, not a one-off.** Any time admin uses `?session=<explicit>&preview=1` while OBS uses ambient resolution, the two paths can show different content. Whenever you write a feature that surfaces in both flows, write a regression case that asserts: "when the most-recently-started session is NOT the one being driven, the ambient resolver picks the driven one." Run it against the real cloud DB, not just mocks.
2. **Multiple-active-sessions is the norm, not an edge case.** `setSessionMatchDayAction` only auto-ends OTHER sessions on the SAME target match-day; nothing prevents a producer from leaving sessions for different match-days simultaneously open. Treat the set of `ended_at IS NULL` rows as ambiguous and disambiguate via "what's the operator actually doing right now?" signals (latest trigger, mouse activity proxy, etc).
3. **Trigger activity is the cleanest "live operator" signal.** It's already written to durable tables (`overlay_events`, `overlay_active_instances`) and timestamped. Don't invent a new "session.is_active" flag — use what's already there. Index lookup on `(stream_session_id, triggered_at desc)` is cheap.
4. **Pre-flight for any new live-broadcast feature:** trace BOTH paths end-to-end:
   - Admin preview: `/admin/broadcast/v2/<sessionId>` → iframe `?session=<id>&preview=1` → page.tsx `resolvedSession=<id>`.
   - OBS: bare `/overlay/v2/<key>` → page.tsx `resolvedSession = await getActiveSession(...)`.
   If they could diverge under "two active sessions", the feature has a bug.
5. **TS strict-mode narrowing trap (recurrent — see 2026-04-28 entry).** Do NOT write `let bestAt: string | null = null; ... if (bestAt === null || x > bestAt) {...}` — TS narrows `bestAt` to `never` after the null-equality check inside the `||`. Use an accumulator object (`const acc = { id: null as string | null, at: null as string | null }`) or factor the comparison into a `consider(row)` helper that re-reads `acc.at` from a fresh local `const cur: string | null = acc.at`. Vitest unit tests don't catch this; only `npm run build` does.

---

**Date:** 2026-04-29
**Context:** Building Plan 56 — the player-side `/player/squad` match-day picker. Added `getSubmissionForPlayerAndMatchDay` with two parallel `select(...)` calls (direct match_day_id lookup + legacy weekly fallback). Wrote both `select` strings in the same function; the second was indented one extra level because it's inside an `if (!sub) {...}` block. Earlier in the same file I had run a `replace_all` Edit on the `select(...)` clauses to add the new `match_day_id` column. The tool reported "All occurrences successfully replaced" but the indented duplicate inside the `if` block did NOT match the expected indentation pattern and was silently skipped.
**Mistake:** Trusted `replace_all` count > 0 as proof every occurrence had been updated. Vitest passed (Supabase mock returned a typed `null`, so the type discrepancy was invisible). The build caught it: `next build` ran the strict TS pass and reported `Type ... is not assignable: Property 'match_day_id' is missing`. The two `sub` values from the two queries had different inferred types, and the assignment `sub = fallback.data` failed.
**Correction:** Hand-fixed the missed clause. Re-ran `npm run build` to confirm.
**Rule for future:**
1. **`Edit replace_all` does NOT guarantee every occurrence is updated.** It updates every occurrence whose surrounding indentation EXACTLY matches the search pattern. When edits target a SQL/JSON/code fragment that may appear at multiple indentation levels in the same file, after running `replace_all` immediately run `Grep -n` for the OLD pattern to confirm zero remaining hits. If the search returns hits, hand-fix each.
2. **Supabase strict types catch the mismatch only at build time.** When you change a `select(...)` clause that feeds a typed return path, ALWAYS run `npm run build` (not just `vitest run`) before declaring done. Vitest mocks are typed as `unknown`/the static `Row` type; build runs the full Supabase typegen-aware narrowing.
3. **Pre-flight check:** after any `Edit` that touches `.from("squad_submissions").select(...)` (or any other table whose row shape is reused across multiple call sites in one file), grep for `.select(` in that file and eyeball every clause to confirm column-list parity. The same applies to `RETURNING` columns in raw SQL inserts.


---

**Date:** 2026-04-29
**Context:** Wave 2 Stage 1 of Overlay Design Page v2 — building 8 migrations + 6 server modules. The seed migrations 7+8 wanted `INSERT ... ON CONFLICT (...) DO NOTHING` to be idempotent across re-runs, but the unique constraints on `overlay_text_elements` and `overlay_partner_logos` are PARTIAL (`unique (...) where deleted_at is null`) — Postgres requires `ON CONFLICT (col,col) WHERE <predicate>` to match the partial-index predicate exactly when the conflict target is a partial unique index.
**Mistake:** Wrote the seeds as plain `ON CONFLICT (overlay_key, variant_id, element_id) DO NOTHING`. Postgres planner can't pick a partial unique index for an unqualified ON CONFLICT — would fail at apply-time with "there is no unique or exclusion constraint matching the ON CONFLICT specification." Caught it before push by re-reading the migration text against the existing `20260601000001_overlay_template_variants.sql` pattern (which has a NON-partial UNIQUE) and noticing the spec uses partial uniques.
**Correction:** `ON CONFLICT (col,col) WHERE deleted_at IS NULL DO NOTHING` — the predicate must match the index's predicate verbatim. Applied to both seed migrations (7 + 8).
**Rule for future:**
1. **Partial unique index → ON CONFLICT must include `WHERE <predicate>` matching exactly.** Soft-delete tables use `unique (...) where deleted_at is null` so re-creating with the same business key after a soft-delete is allowed. Any ON CONFLICT clause against such a table MUST include `WHERE deleted_at IS NULL` or Postgres rejects with "no unique or exclusion constraint matching the ON CONFLICT specification."
2. **Pre-flight for any new soft-delete table seed:** grep the table's CREATE migration for `where deleted_at is null` on the unique index; if present, the seed's ON CONFLICT clause MUST include the same predicate.
3. **Existing precedent**: `20260601000001_overlay_template_variants.sql` uses NON-partial `unique (overlay_key, variant_id)` so its `ON CONFLICT (overlay_key, variant_id) DO NOTHING` works. New tables introduced for soft-delete-with-key-reuse MUST use the partial form + the matching ON CONFLICT predicate.

---

**Date:** 2026-04-29
**Context:** Wave 2 Stage 1 — wrote a Vitest mock for `from('overlay_text_elements').update(...)` that handles both `update({deleted_at: <iso>}).eq().eq().eq().is(null)` (delete path) AND `update({deleted_at: null, updated_at: ...}).eq().eq().eq().not('deleted_at', 'is', null).select(...).single()` (restore path). Initial mock used a single `update` chain that didn't differentiate by payload. Test for `restoreTextElement` failed because the mock returned the bulk-update shape instead of the .select().single() shape.
**Mistake:** Single-shape `update` mock broke the moment two distinct chains coexisted in the SUT. Treated `.update(payload)` as a black-box "first arg is irrelevant" when the SUT actually keys behavior off the payload (deleted_at null vs non-null).
**Correction:** Extended the mock factory to inspect the `update` payload — if `deleted_at === null` it returns the restore-path chain (with `.not().select().single()`); otherwise it returns the soft-delete-path chain (with `.is().<await>`).
**Rule for future:**
1. **Vitest Supabase mocks must mirror call-shape, not just call-name.** When one server fn uses two distinct `.update()` chains (e.g. soft-delete vs restore), the mock MUST inspect the payload to pick which chain to return. Otherwise the test passes for one path and fails for the other and you debug a phantom bug.
2. **Pre-flight for any module using `.update()` more than once:** read the SUT for every `.update(...)` call; if any two have different chained-method tails (`.is()` vs `.select().single()`), the mock factory needs branch logic.
3. **Practical pattern**: `update: vi.fn((payload) => { if (payload.deleted_at === null) return restoreChain; return softDeleteChain; })` — branch off the most discriminating payload field.

---

**Date:** 2026-04-29
**Context:** Wave 2 Stage 2 — Stage 1 seeded 166 element_id rows in the catalog, but the Stage 2 expectation was that every row maps 1:1 to a `data-element-id` attr in the corresponding HTML file. The HTMLs use VERY different class structures across the 16 overlays (e.g. h2h overlays don't use `.eyebrow`, score-bug uses `.bug-mount` not `.score-bug-card`, lower-third uses dynamic anchor cards). After running the seeder script only 36 of 166 rows landed; the parity linter as initially written exit-1'd on EVERY mismatch and would have blocked prebuild → blocked deploy.
**Mistake:** Treated the seed catalog as if it described the EXISTING HTML structure. In reality the catalog describes the IDEAL targets — designers will add `data-element-id` attrs progressively. A strict parity linter that fails on missing-in-HTML breaks CI for elements that simply haven't been wired yet.
**Correction:** Made the linter directional: WARNS on missing-in-HTML (designers know what's still un-wired but build doesn't break), ERRORS on extra-in-HTML (an HTML attr without a server-side seed row is dangerous — admin save would target a row that doesn't exist + the UI can't display the row). Wire into prebuild: warnings surface in build logs, errors block deploy.
**Rule for future:**
1. **Parity linters between two evolving artifacts (DB seed ↔ HTML attrs ↔ admin UI catalog) need DIRECTIONAL strictness.** Decide which direction is dangerous and fail-fast on that one only. The other direction is informational — surface as warnings, not errors.
2. **For "future-state catalog" seeds**: the seed migration may describe the IDEAL target schema (every overlay has every named element). The HTML can still ship with a SUBSET of attrs as designers progressively wire each overlay. Don't conflate "seed exists" with "HTML has attr".
3. **CI / prebuild guardrails should always degrade gracefully**: warning-mode for things designers will fix at their own cadence, error-mode only for things that produce runtime bugs (e.g. orphaned attrs, security holes, missing required configs).
4. **Pre-flight for any new linter wired into prebuild**: explicitly classify each check as Warning vs Error based on "does this break a user flow?" — not on "is this a mismatch?".

---

**Date:** 2026-04-29
**Context:** Wave 2 Stage 2 — when extending the SSR overlay route to add `resolveTextElements` server-side, the existing `page.test.ts` started failing with `expected '...' to contain '--overlay-bg-color: #050505'`. The route's design-token resolution is wrapped in a try/catch that falls back to empty `{}` on error. The ADDED `resolveTextElements` call wasn't mocked in the test, so it threw on the (mocked) supabase client and the catch zeroed out `designTokens` too — silently breaking a different assertion.
**Mistake:** Added a new server-module call into a try/catch block that ALREADY had error-tolerant fallback semantics. The existing tests' mocks didn't cover the new call → the new call threw → the broad catch ate the error → the existing assertions failed because BOTH variables (`designTokens` AND `designTextTokens`) reset to empty.
**Correction:** Added a `vi.hoisted` mock for `@/server/overlays/text/elements::resolveTextElements` to the existing test file. Single line + reset in beforeEach.
**Rule for future:**
1. **When adding a new server call inside an existing try/catch fallback block, always grep the test file for ALL mock setups + extend them ATOMICALLY.** A single uncaught throw from an unmocked dependency cascades into "all the unrelated assertions in the file fail" — a debugging trap.
2. **For overlay route / SSR pages with shared try/catch fallbacks**: map every server-side fn called inside the try { ... } and ensure each has an explicit mock. The `getServiceRoleSupabase()` mock alone is NOT enough — each server module reads off it differently.
3. **Pre-flight for SSR test edits**: re-run the SUT's existing tests BEFORE adding new ones. If they fail, you know the new code path needs additional mock coverage.
