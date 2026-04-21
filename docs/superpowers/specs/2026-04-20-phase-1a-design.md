# Phase 1A Design Spec — CADE League Platform

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-20
**Supersedes:** Phase 1A bullets in `ESOCCER LEAGUE/PRODUCT_STRUCTURE.md` §3
**Target deployment:** local-first development; push to Vercel + Supabase when ready

---

## 1. Goals

Ship the minimum viable platform to run **Division 1 Elite 2025-2026 (13 players)** end-to-end:

- Admins enter match results → standings update
- Refs track attendance → late/absent auto-trigger penalties
- Every write is audit-logged
- Players, fans read standings/fixtures/announcements publicly
- Roles gate who can do what

**Non-goals for Phase 1A:** vMix overlays, QR check-in, payment gateway integration (Paystack dropped entirely 2026-04-21), multi-season abstraction, Futbin scraper, social graphics, full 12-role matrix, WhatsApp/SMS, mobile app.

**Success criteria:**
1. Run a full simulated match day locally: admin creates fixture → ref marks attendance → admin enters result → standings recompute → audit log captures everything → announcement sent → public page reflects it.
2. Edit an existing match result → standings recompute correctly (no drift).
3. Issue a point-deduction punishment → standings reflect it → public page shows punishment.
4. Soft-delete a player → they disappear from public pages → admin can restore from Trash.
5. Admin login from new device triggers email alert.

---

## 2. Architecture Overview

### 2.1 Stack

| Layer | Choice |
|-------|--------|
| Frontend + API | Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui |
| Database | Postgres (Supabase local stack for dev) |
| Auth | Supabase Auth (email + password) |
| Storage | Supabase Storage (local dev uses local bucket) |
| Email | Resend (API key env var — stubbed in dev unless tested) |
| Hosting (later) | Vercel (frontend + API), Supabase Cloud (DB + auth) |
| Timezone | Hard-coded `Africa/Lagos` (WAT) across app |

### 2.2 Repo Layout

```
ESOCCER/
├── apps/
│   └── web/                    # Next.js monolith
│       ├── src/
│       │   ├── app/
│       │   │   ├── (public)/   # Public route group — fixtures, standings, announcements, player cards
│       │   │   ├── (admin)/    # Admin route group — match entry, attendance, punishments, announcements, trash
│       │   │   ├── (auth)/     # Login, session management
│       │   │   └── api/        # Route handlers (server-side)
│       │   ├── server/         # Business logic modules (pure functions + DB access)
│       │   │   ├── auth/
│       │   │   ├── attendance/
│       │   │   ├── matches/
│       │   │   ├── standings/
│       │   │   ├── punishments/
│       │   │   ├── announcements/
│       │   │   └── audit/
│       │   ├── lib/            # Shared utilities (db client, perm helper, date, email)
│       │   ├── perms.ts        # Hard-coded permission map (Phase 1A)
│       │   └── middleware.ts   # Auth gate for /(admin)/** routes
│       └── package.json
├── supabase/
│   ├── migrations/             # Timestamped SQL migrations
│   ├── seed.sql                # 13-player seed, 1 season, sample fixtures
│   └── config.toml
├── docs/
│   └── superpowers/
│       └── specs/              # This file lives here
├── tasks/
│   ├── todo.md                 # Per CLAUDE.md workflow
│   └── lessons.md              # Per CLAUDE.md workflow
├── ESOCCER LEAGUE/
│   └── PRODUCT_STRUCTURE.md    # Broader product doc
└── package.json                # Root (workspace if needed; single app now)
```

One app now; monorepo structure keeps room for a future second app (e.g., overlay renderer) without reshuffling.

### 2.3 Module Boundaries

Each `src/server/<module>/` exposes a small API:

- `matches`: `createMatch`, `enterResult`, `editResult`, `confirmResult`, `listByMatchDay`, `getById`
- `standings`: `recomputeForSeason(seasonId)` — idempotent, called by match + punishment mutations
- `attendance`: `markPresent`, `markLate`, `markAbsent`, `editMark` (with reason), `listByMatchDay`
- `punishments`: `issue`, `edit`, `revoke`, `listPublic`, `listForPlayer`
- `announcements`: `create`, `schedulePublish`, `publish` (cron or admin-triggered), `listForUser`
- `audit`: read-only query helpers; writes happen in DB trigger
- `auth`: `getSession`, `requirePerm`, `startSession`, `endSession`, session listing

Rule: route handlers are thin. All business logic lives in `src/server/<module>/`. This makes unit testing possible without spinning up Next.js.

---

## 3. Data Model (Phase 1A)

All tables get: `id UUID PRIMARY KEY`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `deleted_at TIMESTAMPTZ NULL`.

### 3.1 Auth & People

```
users
  id, email UNIQUE, phone NULL, display_name,
  supabase_auth_id UNIQUE,   -- links to Supabase Auth user
  last_login_at, failed_login_count

user_roles
  user_id → users.id, role TEXT CHECK (role IN ('admin','moderator','viewer','player'))
  UNIQUE (user_id, role)

players
  id, user_id → users.id,
  gamer_tag, psn_id, jersey_number, photo_url,
  bio TEXT NULL

sessions
  id, user_id → users.id,
  ip_address INET, user_agent TEXT, device_fingerprint TEXT,
  started_at, last_seen_at, revoked_at NULL, revoke_reason NULL

auth_events
  id, user_id NULL, event_type TEXT ('login','login_failed','logout','password_reset','new_device'),
  ip_address INET, user_agent, metadata JSONB, created_at
```

**Roles in Phase 1A:** four role values in `user_roles.role`:
- `admin` — full access to all admin UI + data
- `moderator` — issue punishments, mark attendance, publish announcements, read-only on config
- `player` — authenticated participant, reads own dashboard + public data
- `viewer` is the implicit unauthenticated public (no row in `user_roles`; default when no session)

One user can hold multiple rows in `user_roles` (e.g., someone who is both admin and player).

**Permissions** are not a DB table in Phase 1A — see §6.

### 3.2 Season (hard-coded constants, single row each)

```
seasons
  id, year_range TEXT ('2025-2026'), start_date, end_date, status TEXT
  -- Phase 1A inserts exactly one row

season_participants
  id, season_id → seasons.id, player_id → players.id,
  entry_status TEXT, registered_at
```

### 3.3 Fixtures & Matches

```
match_days
  id, season_id, match_date DATE, arrival_cutoff_time TIME, match_start_time TIME,
  venue_name TEXT, status TEXT ('scheduled','in_progress','completed','cancelled')

matches
  id, season_id, match_day_id → match_days.id,
  home_player_id → players.id, away_player_id → players.id,
  scheduled_time TIME,
  status TEXT ('scheduled','in_progress','completed','forfeited','voided'),
  notes TEXT NULL

match_results
  id, match_id → matches.id UNIQUE,   -- one result per match
  home_score INT NOT NULL, away_score INT NOT NULL,
  home_possession_pct INT NULL, away_possession_pct INT NULL,
  result_type TEXT ('normal','forfeit','void') DEFAULT 'normal',
  entered_by → users.id, entered_at,
  confirmed_by → users.id NULL, confirmed_at NULL,
  notes TEXT NULL

player_match_stats
  id, match_id, player_id,
  goals INT, assists INT, clean_sheet BOOLEAN,
  custom_metrics JSONB   -- flexible slot for future metrics
```

### 3.4 Attendance

```
attendance_marks
  id, match_day_id, player_id,
  status TEXT ('present','late','absent'),
  marked_at TIMESTAMPTZ, marked_by → users.id,
  scheduled_call_time TIMESTAMPTZ,   -- computed from match_day, stored for history
  delta_seconds INT,                  -- marked_at − scheduled_call_time
  override_reason TEXT NULL           -- set when a mark is edited
  UNIQUE (match_day_id, player_id)
```

One row per player per match day. Mutations are upserts.

### 3.5 Punishments

```
disciplinary_cases
  id, player_id, match_id NULL,
  incident_type TEXT ('late_arrival','forfeit','equipment','social_media','other'),
  reported_by → users.id, opened_at,
  status TEXT ('open','resolved')

disciplinary_actions
  id, case_id → disciplinary_cases.id,
  sanction_type TEXT ('warning','point_deduction','gd_deduction','forfeit','ban'),
  magnitude INT,                     -- e.g., 3 points, 5 GD; 0 for warning/ban
  effective_from DATE, effective_until DATE NULL,
  imposed_by → users.id, imposed_at,
  revoked_at NULL, revoke_reason NULL,
  public_visible BOOLEAN DEFAULT TRUE
```

### 3.6 Standings (materialized)

```
standings
  id, season_id, player_id,
  matches_played INT, wins INT, draws INT, losses INT,
  goals_for INT, goals_against INT, goal_difference INT,
  points INT,
  punishment_points_deducted INT, punishment_gd_deducted INT,
  updated_at
  UNIQUE (season_id, player_id)
```

Computed from `match_results` + `disciplinary_actions`. See §5.

### 3.7 Announcements

```
announcements
  id, title, body_md TEXT, priority TEXT ('info','important','urgent'),
  audience_type TEXT ('all','role','users','players_in_season'),
  audience_role TEXT NULL,           -- if audience_type = 'role'
  audience_user_ids UUID[] NULL,     -- if audience_type = 'users'
  channels TEXT[] DEFAULT '{in_app,email}',
  scheduled_publish_at TIMESTAMPTZ NULL,
  published_at TIMESTAMPTZ NULL,
  published_by → users.id,
  is_public BOOLEAN DEFAULT FALSE    -- if true, shows on /(public)/announcements

notifications
  id, announcement_id, user_id,
  delivered_channels TEXT[],         -- subset of announcement.channels actually delivered
  read_at NULL
  UNIQUE (announcement_id, user_id)
```

### 3.8 Audit

```
audit_events
  id, actor_user_id → users.id NULL,
  actor_role TEXT,
  action TEXT ('insert','update','delete','soft_delete','restore'),
  entity_type TEXT, entity_id TEXT,
  before_json JSONB NULL, after_json JSONB NULL,
  ip_address INET NULL, user_agent TEXT NULL,
  request_id TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
```

Append-only. A trigger on `audit_events` blocks UPDATE and DELETE. See §4.

---

## 4. Audit Log Mechanism

**Goal:** every mutation across the app ends up in `audit_events` without hand-coded audit calls in API routes.

**Implementation:**

1. Create generic trigger function `audit_row_change()` that reads `current_setting('app.current_user_id', true)` and `current_setting('app.request_id', true)` (set per-request by API route).
2. Trigger function inserts into `audit_events` on `AFTER INSERT OR UPDATE OR DELETE` with `TG_OP`, `OLD`/`NEW` serialized to JSONB, table name, row id.
3. Attach trigger to every mutable table via migration (`ATTACH AUDIT TO tablename` pattern — can be a `DO` block iterating table names).
4. API route middleware runs `SET LOCAL app.current_user_id = $1; SET LOCAL app.request_id = $2;` at start of each request (after auth).
5. Block updates/deletes on `audit_events` itself with trigger that raises exception.

**Edge case:** transactions that fail still shouldn't leave audit rows (inserts roll back with the tx) — this is desired and automatic since trigger inserts happen in the same tx.

**Trade-off accepted:** "soft_delete" and "restore" aren't native Postgres operations. API writes them as explicit `UPDATE ... SET deleted_at = now()`, captured by trigger as `update`. Server-side module derives soft_delete/restore action semantics from diff (if `deleted_at` went NULL → not-NULL, it's a soft_delete).

---

## 5. Standings Recompute

**Trigger:** Any insert/update/delete on `match_results` or any insert/update on `disciplinary_actions` with sanction affecting standings enqueues a recompute for the affected `season_id`.

**Mechanism (Phase 1A — simple):**

- Synchronous recompute inside the same transaction via `recomputeStandings(seasonId)` server-side function.
- Deletes all rows in `standings` for that season and re-inserts from scratch by aggregating `match_results` + subtracting `disciplinary_actions` deductions.
- Idempotent by construction: running twice yields the same output.

**Later optimization (not Phase 1A):** background job queue if recompute gets slow at scale.

**Algorithm:**

```
for each player in season_participants(seasonId):
  for each match result where home=player or away=player and result_type IN ('normal','forfeit'):
    update wins/draws/losses/gf/ga/points
  apply disciplinary_actions where player=player and sanction_type='point_deduction' → points -= magnitude
  apply disciplinary_actions where player=player and sanction_type='gd_deduction' → gd -= magnitude
  upsert standings row
```

Tiebreakers (points → GD → goals_for → head-to-head) computed at read time (query order by, not stored).

---

## 6. Permissions (Phase 1A)

`src/perms.ts`:

```ts
export const PERMS = {
  admin: [
    'matches.*', 'attendance.*', 'punishments.*', 'announcements.*',
    'players.*', 'users.*', 'audit.read', 'trash.*', 'seasons.*'
  ],
  moderator: [
    'announcements.create', 'announcements.publish',
    'punishments.issue', 'punishments.edit',
    'attendance.mark', 'attendance.edit',
    'matches.read', 'standings.read', 'audit.read'
  ],
  player: [
    'matches.read', 'standings.read', 'announcements.read.own',
    'profile.edit.own'
  ],
  viewer: [
    'matches.read.public', 'standings.read.public', 'announcements.read.public'
  ]
} as const;

export function hasPerm(user: User, action: string): boolean { /* glob match */ }
```

API routes call `requirePerm(user, 'matches.enter_score')` — throws 403 on fail.

**Migration path (Phase 1B):** replace the constant with a table read cached per-request. Same `hasPerm` signature.

---

## 7. Attendance Flow

**Ref UI** `(admin)/match-days/[id]/attendance`:

- Table: player roster for match day. Each row: `Present` | `Late` | `Absent` buttons + Edit.
- Clicking a status button posts `{player_id, status}`. Server computes `marked_at = now()`, `scheduled_call_time` from `match_days.arrival_cutoff_time` on that match date (in WAT), `delta_seconds = marked_at − scheduled_call_time`.
- If status ∈ {`late`, `absent`}, server opens a `disciplinary_case` with `incident_type='late_arrival'` and applies the default `disciplinary_action` per the late-arrival ladder (Phase 1A: flat 3-point deduction per absence, 1-point per late — refine with Rule 5.4 ladder in Phase 1B).
- Edit flow: clicking Edit on existing row requires `override_reason` text → updates `attendance_marks.status` + stores reason. If the edit flips a late/absent to present, server revokes the auto-created `disciplinary_action` (sets `revoked_at` + `revoke_reason` = "attendance edit").

**Admin override:** any admin can edit any mark. All edits audit-logged.

---

## 8. Announcements Flow

- Admin/moderator writes announcement → selects audience (all / role / specific users / all players in season) + channels (in_app default, email optional) + `is_public` flag + optional `scheduled_publish_at`.
- If scheduled: row created with `published_at = NULL`. Cron job (Phase 1A: Next.js scheduled route called by GitHub Actions cron or Vercel Cron) runs every 5 min, publishes overdue announcements.
- On publish: expand audience to recipient list → insert `notifications` rows → for `email` channel, send via Resend.
- Public announcements additionally appear at `/(public)/announcements`.

**In-app read:** `(public)` + `(admin)` layouts include a notification bell fetching unread `notifications` for current user.

---

## 9. Punishments Flow

- Admin or moderator (permission: `punishments.issue`) opens `(admin)/punishments/new` → selects player, sanction type, magnitude, optional linked match.
- On save: creates `disciplinary_case` + `disciplinary_action` → triggers `recomputeStandings` for affected season.
- Edit: update `disciplinary_action` → recompute.
- Revoke: set `revoked_at` + `revoke_reason` → recompute (recompute function excludes revoked actions).
- `public_visible=true` (default): shown on `/(public)/punishments` feed + player card.

---

## 10. Soft Delete + Restore

- All tables have `deleted_at TIMESTAMPTZ NULL`.
- All read queries filter `WHERE deleted_at IS NULL`.
- Delete action = `UPDATE ... SET deleted_at = now()`.
- Restore = `UPDATE ... SET deleted_at = NULL`.
- Admin-only UI at `/(admin)/trash` queries `WHERE deleted_at IS NOT NULL`, grouped by entity type, shows Restore button.
- No hard-delete UI in Phase 1A. 30-day purge job deferred.

---

## 11. Session Tracking + New-Device Alert

- On successful login: insert `sessions` row with IP, UA, `device_fingerprint` (hash of UA + IP + Accept-Language).
- Query: `SELECT 1 FROM sessions WHERE user_id = $1 AND device_fingerprint = $2 AND created_at < now() - interval '1 minute'`.
- If zero rows → new device. If user has `admin` role → send email via Resend to their registered email.
- Admin UI: `/(admin)/security/sessions` — lists own sessions, global session list (admin-only), revoke button.

Phase 1A: device fingerprint is crude (UA+IP hash). Phase 3 can add browser fingerprint library.

---

## 12. Public Read-Only Pages

`/(public)/` routes (no auth required):

- `/` — hero + upcoming match day + top of standings
- `/standings` — full table with tiebreaker order
- `/fixtures` — all matches grouped by match day, status badges
- `/players` — grid of player cards
- `/players/[id]` — player profile + season stats + match history + public punishments
- `/announcements` — public announcements feed

All generated server-side (Next.js RSC) + cached for 60s (ISR) — stale-while-revalidate makes public pages fast without real-time realism.

Internal pages at `/(admin)/**` gated by middleware calling `requireRole(['admin','moderator'])`.

---

## 13. Testing Approach

**Unit:** every `src/server/<module>/` function has a test spinning up an in-memory or throwaway Postgres (via `supabase start` in CI / `pg-mem` for pure logic). Target ≥80% coverage on server modules.

**Integration:** one end-to-end playwright test per Success Criterion in §1.

**Seed data:** `supabase/seed.sql` inserts 13 players (names supplied by user), 1 season, sample match days + fixtures. Enables dev loop from clean DB in <10s.

**Test users:** seeded with known email/password:
- `admin@cade.local` / dev-only password → role=admin
- `moderator@cade.local` → role=moderator
- `player1..13@cade.local` → role=player

Never ship dev seed to prod (check `NODE_ENV`).

---

## 14. Error Handling

- API routes return `{ error: { code, message } }` JSON with appropriate HTTP status.
- Server modules throw typed errors (`PermissionError`, `NotFoundError`, `ValidationError`, `ConflictError`). Route handler maps to status.
- No silent catches. Unexpected errors bubble to Next.js error boundary + logged server-side.
- UI forms show field-level errors from Zod schema validation mirrored server+client.

---

## 15. Backup Strategy (dev + prod)

- **Local dev:** nightly `supabase db dump --file backups/$(date +%F).sql` via a scripted npm task. Gitignored. Rotate 14 days.
- **Prod (Vercel + Supabase Cloud):** GitHub Actions cron daily → `pg_dump` → upload to Backblaze B2 bucket (S3-compatible SDK). 30 daily + 12 monthly retention.
- **Quarterly restore drill:** manually download latest backup, restore to staging DB, run integrity check script (row counts per table).

---

## 16. Out of Scope (Phase 1A explicit non-goals)

- vMix overlay rendering + websocket bridge
- QR code check-in
- Payment gateway integration of any kind (Paystack dropped entirely 2026-04-21; caution fee ledger, when built in Phase 2, will be manual bank-transfer tracking only)
- Multi-season / multi-division abstraction (hard-coded single season)
- Futbin scraper
- Social media / weekly graphic generation
- WhatsApp / SMS notifications
- MFA (email+password only for Phase 1A)
- Full 12-role matrix (Phase 1A ships only: admin, moderator, player + implicit public viewer)
- Squad submission + Friday change window
- Disputes + appeals workflow
- Mobile app (PWA covers basics)

---

## 17. Open Items Before Coding

1. **Player roster.** User to supply 13 names + gamer tags + PSN IDs for seed.
2. **GitHub repo.** Create repo (CADE org or personal) with initial scaffold. Not required for local-first dev but needed before first push.
3. **Domain.** Not needed for Phase 1A dev. Decision can wait until first deploy.
4. **Late-arrival penalty ladder.** Phase 1A uses flat: 1-point deduction for late, 3-point for absent. Phase 1B replaces with Rule 5.4 ladder once confirmed.
5. **Resend API key.** Needed to test email flow. Local dev can stub via `console.log` when key absent.

---

## 18. Next Step

After user reviews this spec:
- Invoke `superpowers:writing-plans` skill to produce implementation plan mapping each module to ordered tasks with test gates.
- Scaffold repo per §2.2.
- Begin implementation following plan.
