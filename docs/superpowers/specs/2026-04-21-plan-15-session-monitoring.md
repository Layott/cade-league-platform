# Plan 15 — Session monitoring + anomaly flagging

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Status:** Draft
**Depends on:** Plan 1 (sessions + auth_events tables, `recordLogin`, Resend transport), Plan 8 (admin brand chrome + `AdminSubnav`), Plan 9 (DB-backed perms + `requirePermAsync`)
**Supersedes:** nothing

---

## 1. Goal + success criteria

### 1.1 Goal

Detect suspicious authentication behaviour across already-recorded `sessions` and `auth_events` rows, surface it in a reviewable admin feed at `/admin/security/anomalies`, and alert admins by email on high-confidence events. The detector runs **behind a cron** on the existing data — **no new request-path instrumentation, no client-side code, no device fingerprinting**. The live `sessions` row stays the source of truth for "who is signed in"; `anomaly_events` is an audit feed for "is this login plausible?".

### 1.2 Success criteria (all must demo end-to-end before the plan is marked complete)

1. **Migration applied.** `20260506000002_anomaly_events.sql` creates the `anomaly_events` table with audit trigger, soft-delete, and the expected check constraints. `npm run audit:smoke` green with the new smoke-loop row.
2. **Cron runs clean.** `POST /api/cron/anomaly-scan` with the correct `X-Cron-Secret` returns `{ detected: <n>, skipped: <n> }` inside 5 s against a 30-day-warm dataset; no 500s; lag < 1 min after the trigger auth event.
3. **Concurrent-session detect.** Two simultaneous live sessions for the same user (distinct `sessions.id`, both `revoked_at IS NULL`, both `last_seen_at > now() - interval '10 min'`) emit exactly one `anomaly_type='concurrent_session'` row per (user_id, truncated-hour) bucket.
4. **Unusual-IP detect.** Login from a /16 CIDR the user has never used in the last 30 d emits an `unusual_ip` anomaly (severity=warning) with `context_json` carrying `{ new_cidr, known_cidrs }`.
5. **Unusual-hour detect.** Login outside the user's typical 4-hour activity band (WAT, derived from last-30-d auth_events) emits an `unusual_hour` anomaly (severity=info) with `context_json` carrying `{ login_hour_wat, typical_band }`.
6. **Admin feed renders.** `/admin/security/anomalies` lists open anomalies with actor + type + severity + timestamp; filters by `status` and `severity`; gated on `anomalies.read`.
7. **Resolve + dismiss.** Dismissing an anomaly flips `status='dismissed'`, persists the reason, writes an `audit_events` row, and removes the row from the default feed (filter `status=open`). Resolving with an attached "revoked session" fires Plan 1's session-revoke action in the same server action.
8. **Email alert.** A seeded critical severity anomaly (`rapid_ip_hops` test fixture) triggers exactly one Resend email per admin recipient, subject `CADE League — critical sign-in anomaly`. Reuses the Plan 1 `sendEmail` transport.
9. **Perm-gated.** A non-admin user (e.g. `design`) hitting `/admin/security/anomalies` or `POST /api/admin/anomalies/[id]/dismiss` gets a 403. Proved by E2E.
10. **Verification gate.** `npm run test` (≥ 15 new tests), `npm run lint`, `npm run build`, `npm --workspace apps/web run e2e` (≥ 1 new spec: `anomaly-flagging.spec.ts`), `npm run audit:smoke`, `npm run db:push` — all green.

---

## 2. Non-goals (explicit NO list)

The user has ruled these out. **Do not implement, do not propose, do not "add quickly".**

- **Device fingerprinting** — no hashing of browser/OS/GPU/canvas/font metadata. The existing Plan 1 `deviceFingerprint()` is an IP+UA coarse tag for "is this a new device?" *notification only*, and is not extended or copied into Plan 15.
- **MFA / 2FA / TOTP / WebAuthn** — no second factor.
- **Captcha** — not on login, not on reset, not anywhere.
- **IP blocklists / AbuseIPDB / Maxmind reputation feeds** — no third-party IP threat services.
- **Cross-session behavioural profiling** — no mouse-movement biometrics, no typing cadence, no session-replay.
- **Auto-revoke on detection** — admins decide; the cron emits anomalies and (at most) emails. It never flips `revoked_at` on its own.
- **Geo IP lookup as a hard dependency** — `new_country` is a *best-effort* severity lift. If no resolver library is installed, the detector skips the country dimension and documents it as a follow-up (see §11 Risks).
- **New columns on `sessions`** — every new signal is derivable from a query over `sessions` ∪ `auth_events`. Don't widen the existing table.
- **Live / websocket admin feed** — the feed is request-response. Browser refresh cycles it. No SSE, no pusher channel.

---

## 3. Data model

### 3.1 Migration `supabase/migrations/20260506000002_anomaly_events.sql`

```sql
create table public.anomaly_events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users (id) on delete cascade,
  anomaly_type         text not null check (anomaly_type in (
                          'concurrent_session',
                          'unusual_ip',
                          'unusual_hour',
                          'new_country',
                          'rapid_ip_hops'
                        )),
  severity             text not null check (severity in ('info','warning','critical')),
  detected_at          timestamptz not null default now(),
  context_json         jsonb not null default '{}'::jsonb,
  session_id           uuid references public.sessions (id) on delete set null,
  status               text not null default 'open'
                         check (status in ('open','dismissed','resolved')),
  resolved_by_user_id  uuid references public.users (id),
  resolved_at          timestamptz,
  resolution_notes     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index anomaly_events_user_idx
  on public.anomaly_events (user_id, detected_at desc)
  where deleted_at is null;

create index anomaly_events_open_idx
  on public.anomaly_events (status, detected_at desc)
  where status = 'open' and deleted_at is null;

create index anomaly_events_type_idx
  on public.anomaly_events (anomaly_type, detected_at desc)
  where deleted_at is null;

-- Prevent duplicate "same hour, same type, same user" floods from the cron.
-- Partial unique index keyed by user + type + floored hour of detected_at.
create unique index anomaly_events_dedupe_idx
  on public.anomaly_events
    (user_id, anomaly_type, date_trunc('hour', detected_at))
  where status = 'open' and deleted_at is null;

select public.attach_audit('public.anomaly_events');
```

### 3.2 Perm-seed migration `supabase/migrations/20260506000003_anomaly_perms_seed.sql`

```sql
insert into public.role_permissions (role, permission) values
  ('admin','anomalies.read'),
  ('admin','anomalies.resolve'),
  ('admin','anomalies.dismiss'),
  ('idc','anomalies.read'),
  ('idc','anomalies.resolve'),
  ('idc','anomalies.dismiss'),
  ('loc','anomalies.read')
on conflict do nothing;
```

### 3.3 Numbering check

- Plan 18 roster migration `20260506000001_real_roster_swap.sql` has already landed (confirmed in `supabase/migrations/` listing 2026-04-21).
- `20260506000002` + `20260506000003` are the next free slots.

---

## 4. Detection logic

### 4.1 Pure detection functions (`apps/web/src/server/anomalies/detect.ts`)

All return `AnomalyCandidate[]`. No side effects. Unit-testable with fixture arrays.

```ts
export type AnomalyCandidate = {
  user_id: string;
  anomaly_type: 'concurrent_session' | 'unusual_ip' | 'unusual_hour'
              | 'new_country' | 'rapid_ip_hops';
  severity: 'info' | 'warning' | 'critical';
  context_json: Record<string, unknown>;
  session_id?: string | null;
  detected_at: string; // ISO, floored to the minute
};

export function detectConcurrentSessions(
  liveSessions: LiveSession[], now: Date
): AnomalyCandidate[]; // 1+ per user with ≥2 live rows, severity=warning

export function detectUnusualIp(
  loginEvent: AuthEvent, historicalCidrs: Set<string>
): AnomalyCandidate | null; // severity=warning

export function detectUnusualHour(
  loginEvent: AuthEvent, typicalBand: { startHour: number; endHour: number }
): AnomalyCandidate | null; // severity=info

export function detectRapidIpHops(
  userLogins30min: AuthEvent[]
): AnomalyCandidate | null; // ≥5 distinct IPs in 60min → severity=critical

export function detectNewCountry(
  loginEvent: AuthEvent, knownCountries: Set<string>
): AnomalyCandidate | null; // best-effort; null if country resolver absent
```

### 4.2 Activity-window derivation

`typicalBand(userId, events30d)` returns the 4-hour window containing the densest cluster of historical logins in WAT. Pure helper in `detect.ts`, unit-tested.

- Bucket every login into a 0..23 hour in `Africa/Lagos`.
- Sliding 4-hour window (wraps midnight); pick argmax by count.
- Returns `{ startHour, endHour }` inclusive/exclusive.
- **Cold-start rule:** if fewer than 5 logins in 30 d, return `{ startHour: 0, endHour: 24 }` (all hours are typical) — prevents flagging brand-new accounts.

### 4.3 /16 CIDR derivation

`toCidr16(ip: string): string` — takes IPv4/IPv6 text, returns `a.b.0.0/16` for v4 and `a:b::/32` for v6. Pure, branded tests on RFC sample IPs.

### 4.4 Cron orchestrator (`scan.ts`)

```
scanAndEmit(sb):
  1. cutoff = last_run_at from `cron_state.anomaly_scan_last_run_at`
     (new row in existing cron_state table — one-line bootstrap).
  2. Fetch:
       - live sessions: `revoked_at IS NULL AND last_seen_at > now()-10min AND deleted_at IS NULL`
       - fresh login events: `auth_events WHERE event_type='login' AND created_at > cutoff`
       - 30-day login history per user touched by fresh logins
  3. Per user:
       - run detectConcurrentSessions
       - run detectUnusualIp, detectUnusualHour, detectRapidIpHops, detectNewCountry
         against each fresh login
  4. INSERT candidates into anomaly_events with ON CONFLICT DO NOTHING
     (the partial unique index handles dedupe).
  5. For each newly-inserted severity='critical' row → sendCriticalAlert(admins, row).
  6. UPDATE cron_state.anomaly_scan_last_run_at = now().
  7. Return { detected, skipped, emailed }.
```

The cron bootstrap row in `cron_state` is inserted by the detection-events migration (`insert into cron_state (...) on conflict do nothing`). If `cron_state` doesn't exist yet, the migration creates it.

### 4.5 Cron route

`apps/web/src/app/api/cron/anomaly-scan/route.ts` — guarded by the existing `X-Cron-Secret` header helper used by Plan 10's squad-deadline-check. Runs every 5 min via the existing Vercel `vercel.json` cron config (add one row).

---

## 5. Server modules layout

```
apps/web/src/server/anomalies/
  index.ts           — re-exports the public surface
  detect.ts          — pure functions per §4.1 + helpers (toCidr16, typicalBand)
  detect.test.ts     — ≥ 8 tests (concurrent, unusual-ip, unusual-hour, cold-start, CIDR edge, rapid-hops boundary, new-country, empty-input no-op)
  scan.ts            — scanAndEmit(sb) orchestrator
  scan.test.ts       — ≥ 4 tests (happy path, no-op when cutoff up-to-date, dedupe via unique index, critical → sendCriticalAlert called exactly once per row)
  read.ts            — listAnomalies({ status?, severity? }), getAnomalyById(id)
  read.test.ts       — 2 tests
  resolve.ts         — dismissAnomaly(id, reason, actor), resolveAnomaly(id, { notes, revokeSessionId? }, actor)
  resolve.test.ts    — ≥ 4 tests (dismiss idempotent, resolve fires revokeSession, perm bubble, reason required)
  email.ts           — sendCriticalAlert(user, anomaly) — reuses lib/email/resend.ts
```

Schemas in `schemas.ts` co-located — Zod for `dismissAnomaly` and `resolveAnomaly` inputs.

---

## 6. UI routes

### 6.1 `/admin/security/anomalies` (list)

- Server component, gated on `requirePermAsync(sb, actor, 'anomalies.read')`.
- Reuses `SectionHeader` + `DataTable` + `StatusPill` from `components/admin/`.
- Columns: **Detected** (WAT), **User** (id slice + display name link), **Type** (pill, colour-coded), **Severity** (`StatusPill` tones: info=sky, warning=amber, critical=rose), **Session** (short link to `/admin/security/sessions?userId=<id>` when `session_id` present), **Actions** (dismiss, resolve → pushes to detail).
- Filter chips along the top: status (open / dismissed / resolved / all) + severity (all / info / warning / critical). URL-driven via `searchParams`.
- Empty state: "No anomalies. The monitor last ran <relative WAT>."

### 6.2 `/admin/security/anomalies/[id]` (detail)

- `context_json` pretty-printed in a mono block.
- Related auth_events timeline (last 10 login / new_device / session_revoked rows for the same user).
- Dismiss form (reason required, ≤ 240 chars).
- Resolve form (notes + checkbox `also revoke attached session` when `session_id` present — reuses Plan 1 `revokeSession`).
- Audit trail component (`AuditTrail.tsx`) for this entity.

### 6.3 Navigation

- `AdminSubnav.tsx` — add **Anomalies** tab inside the Security cluster, next to the existing **Sessions** tab. Tone: rose when any open critical anomaly exists (computed in the server layout and passed down as a badge count).

---

## 7. Permissions + middleware

Permissions seeded in §3.2:

| permission              | roles                   |
|-------------------------|-------------------------|
| `anomalies.read`        | admin, idc, loc         |
| `anomalies.resolve`     | admin, idc              |
| `anomalies.dismiss`     | admin, idc              |

Middleware already funnels `/admin/**` through the admin gate. Page-level + server-action-level `requirePermAsync` calls enforce these perms. The cron endpoint is *not* perm-gated — it's `X-Cron-Secret`-gated, same pattern as Plan 10.

---

## 8. Tests

### 8.1 Unit (target ≥ 15, Vitest, Supabase client mocked)

- `detect.test.ts` (≥ 8):
  1. Two live sessions for same user → one `concurrent_session` candidate.
  2. One live session → no candidate.
  3. Different user sessions (not shared user_id) → no candidate.
  4. Unusual IP (new /16) → `unusual_ip` candidate.
  5. Known /16 → null.
  6. Unusual hour (outside 4-h band) → `unusual_hour` candidate.
  7. Cold-start rule (< 5 logins) → never flags `unusual_hour`.
  8. Rapid IP hops (6 distinct IPs in 45 min) → `rapid_ip_hops` critical.
  9. `toCidr16` — IPv4 edge, IPv6 edge.
- `scan.test.ts` (≥ 4):
  10. Happy path — mock inserts, assert row shape + cron_state bump.
  11. No-op when cutoff up-to-date and no live sessions.
  12. Dedupe — second pass in the same hour for the same user doesn't re-insert.
  13. Critical row → `sendCriticalAlert` called exactly once per admin.
- `resolve.test.ts` (≥ 4):
  14. `dismissAnomaly` — flips status, persists reason.
  15. `dismissAnomaly` is idempotent (re-dismiss no-ops).
  16. `resolveAnomaly` with `revokeSessionId` fires `revokeSession`.
  17. Perm denial bubbles as `PermissionDeniedError` from the API surface.
- `read.test.ts` (2):
  18. `listAnomalies({ status: 'open' })` filters correctly.
  19. `getAnomalyById` returns null on soft-deleted rows.

### 8.2 E2E `apps/web/tests/e2e/anomaly-flagging.spec.ts` (1 spec, 4 steps)

1. Seed two `sessions` rows for a throwaway `seed-monitor@cade.local` user (direct DB insert; both live, distinct IPs, `last_seen_at = now()`).
2. `POST /api/cron/anomaly-scan` with the right secret — assert `detected >= 1`.
3. Sign in as admin, visit `/admin/security/anomalies` — assert a row with `anomaly_type=concurrent_session` and `user_id=<throwaway>` is visible.
4. Click **Dismiss**, enter reason `"test — two browsers"`, submit — assert the row's `status='dismissed'` (verified via a second visit with `status=dismissed` filter), and an `audit_events` row of action `UPDATE` against `anomaly_events` is visible in the row's audit trail.

### 8.3 Audit smoke

Extend `supabase/tests/audit_smoke.sql` with an insert / update / soft-delete loop against `anomaly_events`. `npm run audit:smoke` must stay green.

---

## 9. Numbered tasks

### Migrations + seed

1. Write `supabase/migrations/20260506000002_anomaly_events.sql` per §3.1. Verify attach_audit via `supabase db query` (`select tgname from pg_trigger where tgrelid='public.anomaly_events'::regclass`).
2. Write `supabase/migrations/20260506000003_anomaly_perms_seed.sql` per §3.2. Verify row counts (`select count(*) from role_permissions where permission like 'anomalies.%'` = 7).
3. Bootstrap `cron_state` row for `anomaly_scan_last_run_at` (idempotent DO $$ ... $$).
4. Extend `supabase/tests/audit_smoke.sql` with an `anomaly_events` loop.

### Server modules

5. TDD `server/anomalies/detect.ts` + `detect.test.ts` — 9 tests per §8.1.
6. TDD `server/anomalies/scan.ts` + `scan.test.ts` — 4 tests. Mock Supabase + `sendCriticalAlert`.
7. TDD `server/anomalies/resolve.ts` + `resolve.test.ts` — 4 tests. Mock `revokeSession`.
8. TDD `server/anomalies/read.ts` + `read.test.ts` — 2 tests.
9. Write `server/anomalies/email.ts` (`sendCriticalAlert`) — reuse `lib/email/resend.ts` transport; subject fixed: `CADE League — critical sign-in anomaly`.
10. Write `server/anomalies/schemas.ts` — Zod for dismiss + resolve inputs. 1 smoke test.
11. Export surface in `server/anomalies/index.ts`.

### API + cron

12. Write `app/api/cron/anomaly-scan/route.ts` — POST, `X-Cron-Secret` gate, calls `scanAndEmit(sb)`. Add cron entry in `vercel.json` (`/api/cron/anomaly-scan` every 5 min).

### UI

13. Build `app/admin/security/anomalies/page.tsx` — list + filter chips + tone-mapped severity. Gate `anomalies.read`.
14. Build `app/admin/security/anomalies/[id]/page.tsx` + `actions.ts` — detail + dismiss + resolve (optional session revoke).
15. Extend `components/admin/AdminSubnav.tsx` — add Anomalies tab; badge count for open critical.
16. Extend `StatusPill` tone map with anomaly-specific tones (info=sky, warning=amber, critical=rose) — re-use existing tones where they match.

### Tests + verification

17. Write E2E `apps/web/tests/e2e/anomaly-flagging.spec.ts` per §8.2.
18. Run full verification gate — `npm run test`, `lint`, `build`, `e2e`, `audit:smoke`, `db:push`.
19. Demo success-criteria §1.2 items 1-10 manually; capture evidence in the Review section of `tasks/todo.md`.
20. Commit in slices: migrations → server → API/cron → UI → tests. No squash.

---

## 10. Acceptance criteria + verification gate

A reviewer can mark Plan 15 complete only after **all** of:

- Every §1.2 success criterion demonstrated end-to-end (screenshot or CLI transcript).
- `npm run test` — suite total ≥ prior + 15 passing, 0 failing.
- `npm run lint` — clean.
- `npm run build` — clean.
- `npm --workspace apps/web run e2e` — `anomaly-flagging.spec.ts` green plus every prior spec still green.
- `npm run audit:smoke` — green, with `anomaly_events` loop present.
- `npm run db:push` — `20260506000002` + `20260506000003` applied to the linked Supabase project.
- `tasks/todo.md` — Plan 15 review section written, lessons appended to `tasks/lessons.md` if any corrections landed.

If any of these is red, the plan is *not* complete. Fix the root cause; do not paper over with TODOs.

---

## 11. Risks + mitigations

1. **False-positive flood drowns admins.** Every user juggling a phone + a laptop will create a `concurrent_session`. *Mitigation:* severity=warning only (no email), plus the hourly dedupe index. Daily review from the admin feed; we can later tune per-user tolerances.
2. **IP-to-country resolution uncertainty.** `new_country` requires a resolver. *Mitigation:* detector is best-effort; if no library is bundled, the branch is a no-op and the plan review logs a follow-up. Do not ship a half-working vendor integration.
3. **Cron lag or skip.** Vercel cron isn't realtime. *Mitigation:* design is idempotent; a skipped run is caught on the next tick via the `cron_state.anomaly_scan_last_run_at` cursor. Unit test covers the catch-up path.
4. **IPv6 addressing noise.** A mobile carrier can rotate IPv6 /64s frequently. *Mitigation:* bucket v6 at /32 (see §4.3), which is the LIR allocation; carriers don't hop /32s per request.
5. **Admin email fatigue on the critical channel.** *Mitigation:* only `severity='critical'` emails, and only one per (user, hour) via the dedupe index. Email body links directly to the anomaly detail page.
6. **Empty 30-d history.** New accounts have no baseline. *Mitigation:* `typicalBand` cold-start returns full 24-h band; `unusual_ip` detector requires at least one known CIDR or skips.
7. **Cron-secret leakage.** *Mitigation:* reuse the existing `CRON_SECRET` env; cron endpoint rejects with 401 when missing; do not log the secret.

---

## 12. Out of scope

Repeats and extends §2 for the final-scope reviewer:

- No device fingerprinting (any variant).
- No 2FA / WebAuthn / TOTP.
- No captcha.
- No IP reputation feeds (AbuseIPDB, Maxmind, etc.).
- No auto-revoke on detection.
- No live / push admin feed.
- No cross-site behavioural profiling.
- No schema changes to `sessions` or `auth_events`.
- No player-facing anomaly UI (the /player/** surface is untouched).
- No retroactive backfill of anomalies against historical auth_events. The cron only processes rows newer than `cron_state.anomaly_scan_last_run_at`.

---

## 13. Critical files

- `supabase/migrations/20260506000002_anomaly_events.sql` (new)
- `supabase/migrations/20260506000003_anomaly_perms_seed.sql` (new)
- `supabase/tests/audit_smoke.sql` (extended)
- `apps/web/src/server/anomalies/*` (new module tree per §5)
- `apps/web/src/app/api/cron/anomaly-scan/route.ts` (new)
- `apps/web/src/app/admin/security/anomalies/page.tsx` (new)
- `apps/web/src/app/admin/security/anomalies/[id]/page.tsx` (new)
- `apps/web/src/app/admin/security/anomalies/[id]/actions.ts` (new)
- `apps/web/src/components/admin/AdminSubnav.tsx` (edited — add Anomalies tab)
- `apps/web/src/components/admin/StatusPill.tsx` (edited — severity tones, if not already present)
- `apps/web/tests/e2e/anomaly-flagging.spec.ts` (new)
- `vercel.json` (edited — cron entry)
- `tasks/todo.md` (extended — Plan 15 Tasks section)

---

## 14. Review log

_(To be filled as tasks complete.)_
