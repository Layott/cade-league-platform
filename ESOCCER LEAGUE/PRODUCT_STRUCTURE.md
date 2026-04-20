# CADE League Platform — Product Structure

**Primary target:** Division 1 (Elite League), Season 2025-2026
**Extensibility target:** Division 2 (Pro), Division 3 (Challenger), Onile (Grassroots), future seasons
**Document owner:** Spektakula
**Version:** 0.2 (scope-locked, 2026-04-20)

---

## 1. Product Vision (One Paragraph)

A single in-house platform that runs every operational surface of CADE Esports leagues — competition (fixtures, scores, standings, squad validation), people (players, coaches, officials, orgs), compliance (warnings, punishments, audit trails), broadcast (live-data stream graphics), and communication (announcements, notifications). Built as reusable infrastructure across all four divisions and future seasons, not a one-off Division 1 site.

## 2. Product Principles (Non-Negotiable)

1. **Every destructive action is logged.** Score edits, punishments, role changes, profile updates — all captured with actor, timestamp, IP, before/after. Audit log exists from Day 1 via Postgres trigger (not hand-coded in API routes).
2. **Permissions enforced in the API layer as single source of truth.** RLS only on PII tables (users, players w/ NIN/bank, payments) for defense-in-depth. Business logic does not rely on RLS.
3. **Phase 1A hard-codes Elite 2025-2026.** Multi-season/multi-division abstraction comes when a second season actually needs it — not speculatively.
4. **Manual overrides exist for everything.** Automation fails. A referee must always be able to correct any value with an audit trail.
5. **Soft delete + restore from Day 1.** Every row gets `deleted_at`. Admin "Trash" UI lists soft-deleted items with Restore. 30-day purge job later.
6. **Latency matters on matchday.** Ref inputs a score → leaderboard updates for stream in < 2 seconds.
7. **Idempotent standings recompute.** Edits re-derive full standings from match results, never incremental patch.

---

## 2.5 Decisions Log (v0.2, 2026-04-20)

Post-brainstorm scope cuts and confirmations. Supersedes any conflicting guidance in earlier sections.

**Confirmed:**
- Single Next.js monolith repo with route groups `(public)` and `(admin)`. No separate admin codebase.
- Timezone hard-coded to `Africa/Lagos` (WAT) in all date/time handling.
- 12-role matrix retained (user confirmed 12 distinct humans exist).
- Possession stat is match-level total only (no per-player — FUT/eFootball does not expose it).
- Ref-driven attendance: `Present` / `Late` / `Absent` button per player. Server timestamps. Late/absent auto-triggers penalty; editable with reason.
- vMix overlays are interactive: admin UI → websocket bridge → overlay page (browser source). Ref clicks score, overlay updates live.
- Permissions hard-coded per role in code for Phase 1A. Migrate to `RolePermission` DB table when perm editing without deploy is actually needed.
- Production target: Vercel + Supabase. Local-first dev before pushing.

**Dropped entirely (not deferred, not building):**
- GPS geofence + `VenueGeofence` entity.
- Prize disbursement automation + withholding tax (`PrizeDisbursement` entity).
- Under-18 parental consent tracking (no minors in Elite).
- Auto promotion/relegation (only Div 1 exists).
- Mobile app / React Native (PWA covers it).
- Anonymous whistleblower flow (revisit if incident occurs).

**Deferred to later phases (not Phase 1A):**
- QR check-in (revisit if scale grows beyond one studio).
- Multi-season + multi-division configuration layer.
- Futbin scraper — attempted in Phase 3 to see what data accessible; manual fallback remains canonical.
- Auto-generated social / weekly graphics.
- Paystack integration + caution fee ledger.
- Full 12-role permission matrix UI (Phase 1B).

---

## 3. Phase Plan

### Phase 1A — Core Shippable (locked scope, 2026-04-20)
- Monolith Next.js app, single repo, route groups `(public)` + `(admin)`
- Email + password auth, 3 roles (Admin, Moderator, Viewer/Player)
- Hard-coded permission map per role in code
- Ref attendance flow: `Present` / `Late` / `Absent` button per player per match day; server timestamps vs scheduled call time; auto penalty on late/absent, editable with reason
- Admin post-match result entry + confirmation step
- Stats engine: goals, assists, clean sheets, possession (match-level), custom metrics
- Idempotent standings recompute on any match-result insert/update/delete
- Punishments: point deduction (total + GD), match forfeit (auto-set 3-0), ban; auto-apply, editable, publicly visible
- Audit log via Postgres trigger (append-only, captures actor + before/after JSON + IP + UA)
- Soft delete with `deleted_at` column on all tables + admin Trash/Restore UI
- Announcements in-app + email (role-based audience, player-specific, scheduled publish)
- Session tracking: IP, device/UA, login time; new-device login alert for admin accounts; admin-visible login history
- Public read-only pages: fixtures, standings, player cards, announcements flagged public
- Hard-coded Elite 2025-2026 season (13 players)

### Phase 1B — Operational Completeness (Weeks 2-3)
- Full 12-role permissions matrix (Admin, LOC, IDC, Referee, Technical, Production, Design, Moderator, Coach, Team Manager, Player, Viewer)
- Migration from hard-coded perms to `RolePermission` DB table + admin editor
- Extended discipline actions (warnings ladder, suspensions, void-match propagation per Rule 3.4.4.2)
- Manual squad validation interface (ref-facing, against `SquadValidationRule`)
- Session monitoring + anomaly flagging

### Phase 2 — Revenue + Broadcast + Governance (Weeks 4-8)
- vMix-integrated stream graphics (data-wired overlays)
- Paystack entry fee collection + caution fee tracking + prize disbursement tracking
- Content obligations tracker (manual URL submission)
- Disputes & appeals workflow
- Organization (CAC) entity + player-org contract storage
- Pre-season photo/video shoot attendance tracking

### Phase 3 — Automation + Multi-Season (Weeks 9+)
- Automated FUT squad validation (Futbin scraper or community player DB)
- IG/TikTok API integration for content obligation auto-verification
- Advanced security (device fingerprinting, anomaly detection, MFA)
- Multi-season archive + cross-season stats + ELO/coefficient system
- Mobile app (React Native) if needed

---

## 4. Core Entities (Data Model)

Below is the entity inventory. Every feature in the product maps to one of these. Detailed schema (columns, relationships, indexes) will be in a separate `DATA_MODEL.md` document.

### 4.1 People & Access
- **User** — authentication identity (email, phone, hashed password, MFA state)
- **Role** — Admin, LOC, IDC, Referee, Technical, Production, Design, Moderator, Coach, TeamManager, Player, Viewer
- **Permission** — granular capabilities (e.g., `matches.enter_score`, `players.warn`, `announcements.publish`)
- **RolePermission** — which permissions each role grants (configurable)
- **UserRole** — assignment of role(s) to a user, scoped by season/division if relevant
- **Session** — active login sessions (device, IP, user agent, last_seen_at, is_revoked)
- **AuthEvent** — every login, logout, failed attempt, password reset, MFA challenge

### 4.2 Organizations & Players
- **Organization** — CAC-registered esports org (name, CAC number, CAC cert URL, contact rep, caution fee balance, status)
- **OrganizationContract** — signed player-org contract document per season
- **Player** — extends User (gamer tag, PSN ID, EA account, CADE App account, bio, jersey number, photo, NIN, bank details encrypted, home LGA, under-18 flag, parental consent URL)
- **Coach** — extends User (linked to an Organization; represents up to 3 players)
- **TeamManager** — extends User (linked to an Organization; courtside rep)

### 4.3 Competition Structure
- **Season** — year-range, start_date, end_date, status (upcoming, active, completed, archived)
- **Division** — Elite (1), Pro (2), Challenger (3), Onile; each with its own rule config
- **DivisionRuleConfig** — budget cap, required nationality items, banned items, number of participants, tiebreaker order, match format, match day arrival cutoffs
- **SeasonDivision** — instance of a division in a season (e.g., Elite League 2025-2026)
- **Participant** — a Player registered into a SeasonDivision, with an Organization link, entry route (relegated/promoted/open bid/grassroots), entry fee status, registration status

### 4.4 Fixtures & Matches
- **MatchDay** — date, arrival_cutoff_time, match_start_time, venue, status
- **Fixture** — the full round-robin fixture list for a SeasonDivision; computed programmatically
- **Match** — Fixture × MatchDay × time slot, home_player, away_player, status (scheduled, called_to_stage, in_progress, completed, forfeited, voided)
- **MatchResult** — home_score, away_score, entered_by, verified_by, result_type (normal, forfeit, void), notes
- **MatchEvent** — timestamped events during a match (call_to_stage, setup_started, kickoff, half_time, full_time, disconnect, restart, dispute_raised)

### 4.5 Roster & Squad
- **SquadSubmission** — player, season_week, futbin_screenshot_url, submitted_at, validated_by, validation_status (pending, approved, rejected), rejection_reason
- **SquadPlayerItem** — individual player items in a squad submission (name, rating, position, value, type: gold/hero/icon/etc.)
- **SquadChangeRequest** — Friday 9-10pm change window record (player_out, player_in, authorized_by_ref, authorized_at)
- **SquadValidationRule** — per-division (max budget, min Nigerian items, banned item types, etc.)

### 4.6 Compliance & Discipline
- **DisciplinaryCase** — incident_type (forfeit, equipment, social_media, late_arrival, dress_code, betting, match_fixing, unauthorized_access, other), player, match (optional), reported_by, opened_at, status (open, under_review, resolved, appealed), severity
- **DisciplinaryAction** — case_id, sanction_type (warning, goal_difference_penalty, point_deduction, fine, suspension, disqualification, permanent_ban), amount, effective_from, effective_until, imposed_by (must be IDC role for certain types)
- **DisciplinaryPrecedent** — offense history counter per player per category (tracks 1st/2nd/3rd offense progression for automatic sanction scaling)
- **Warning** — convenience view over DisciplinaryAction where type = warning
- **CautionFeeLedger** — org_id, transaction (deposit, fine_deduction, top_up), amount, balance_after, reference

### 4.7 Attendance & Check-in
- **AttendanceMark** — player, match_day, status (present, late, absent), marked_at, marked_by (ref user_id), scheduled_call_time, delta_seconds, override_reason (nullable, for edits)
- **LateArrivalOffense** — player, season, offense_count, auto-computed from AttendanceMark with status ∈ {late, absent}
- ~~VenueGeofence~~ — **dropped** (no GPS, no QR in Phase 1A)

### 4.8 Communication
- **Announcement** — title, body, audience (all, players, staff, specific_roles[], specific_users[]), priority (info, important, urgent), published_at, published_by, channels[] (in_app, email, whatsapp)
- **Notification** — per-user delivery of an announcement, read_at, delivered_channels

### 4.9 Content Obligations
- **ContentPost** — player, week_start, platform (twitter, instagram, tiktok), post_url, submitted_at, verified_by, verification_status
- **ContentObligationStatus** — per-player per-week tally vs minimum (≥1 post/week on ≥2 platforms)
- **ContentSession** — match-day content slot, player, scheduled_time, attended_bool, makeup_session_scheduled_at, makeup_attended_bool

### 4.10 Broadcast
- **OverlayTemplate** — template_name, template_type (lower_third, scorebar, standings_widget, player_card, punishment_ticker, etc.), html_url, default_payload_schema
- **OverlayEvent** — triggered_by, template_id, payload_snapshot, trigger_time, stream_session_id (for audit/replay of broadcast actions)
- **StreamSession** — match_day, vmix_session_id, active_overlays, started_at, ended_at

### 4.11 Payments (Phase 2)
- **Payment** — payer (player or org), type (entry_fee, caution_fee, fine_topup, reschedule_fee), amount, status, paystack_reference, paid_at
- ~~PrizeDisbursement~~ — **dropped**. Prize payouts tracked manually (bank transfer + ledger row). No payroll system.

### 4.12 Disputes & Appeals
- **Dispute** — raised_by, subject_type (match, sanction, registration), subject_id, description, evidence_urls[], status (submitted, under_review, resolved, withdrawn), assigned_to (IDC member), ruling
- **Appeal** — disciplinary_case_id, submitted_by, submitted_at, grounds, evidence, appeal_panel_members[], ruling, ruled_at

### 4.13 Audit
- **AuditEvent** — actor_user_id, actor_role, action, entity_type, entity_id, before_json, after_json, ip_address, user_agent, request_id, created_at

---

## 5. Role × Permission Matrix (Initial Draft)

**You listed 7 roles. I'm proposing 12 based on the rulebook.** Every role in the rulebook exists for a structural reason — collapsing them means those people share accounts, which defeats your audit log requirement.

| Role | Primary Function | Create/Edit Data | Read Data | Special Powers |
|------|------------------|------------------|-----------|----------------|
| **Admin** (Owner) | Platform super-admin | Everything | Everything | Manage roles, delete accounts, restore soft-deletes |
| **LOC** (League Operations) | Day-to-day ops | Fixtures, match days, schedules, announcements | Everything | Authorize Friday squad changes; approve reschedule exceptions |
| **IDC** (Integrity & Discipline) | Sanctions & appeals | Disciplinary cases, actions, appeals | Everything including audit log | Impose suspensions, permanent bans; access investigation data |
| **Referee** | Matchday officiating | Match results, check-in overrides, in-match events, squad validations | Current match day data | Forfeit declarations, on-site dispute resolution |
| **Technical Committee** | Equipment & settings | Equipment inspection records | Current match day data | Approve third-party pads; rule on technical disputes |
| **Production** | Stream & content | Stream sessions, overlay triggers, content session scheduling | Match schedule, player data (public fields) | Trigger overlays; restricted area access records |
| **Design** | Visual assets | Overlay templates, player photos, org logos | Assets, players, orgs | Manage asset library |
| **Moderator** | Comms & community | Announcement drafts, content obligation verifications | Players, match schedule | Verify IG/TikTok posts |
| **Coach** | Player support | Own players' squad submissions (view-only unless authorized) | Own players' data, schedule | View opponents (public info only) |
| **Team Manager** | Org courtside rep | Own org's contracts, player registrations | Own org's data, schedule | Authorize on-behalf actions for org's players |
| **Player** | Competitor | Own profile, own squad submissions, own content posts, own check-ins | Own data, public standings, announcements | Submit appeals for own sanctions |
| **Viewer** (Public) | Fans | Nothing | Public-facing: standings, fixtures, player cards, announcements marked public | — |

**Role control flexibility (your requirement):** Admin can edit the RolePermission table to add/remove permissions from any role without code changes. New custom roles can be created (e.g., "Sponsor Liaison") with specific permission sets.

---

## 6. Architecture (Recommended)

### 6.1 Stack
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui components
- **Backend:** Next.js API routes + Supabase (Postgres + Auth + Row-Level Security + Storage + Realtime)
- **Database:** Postgres (via Supabase). All business logic enforced with RLS policies + triggers.
- **Auth:** Supabase Auth (email + phone + MFA). JWT sessions.
- **Storage:** Supabase Storage for photos, CAC certificates, squad screenshots, ID documents (encrypted bucket).
- **Payments:** Paystack (Phase 2)
- **Email:** Resend (free tier — 3k/month)
- **SMS/WhatsApp:** Termii or WhatsApp Business API (Phase 2)
- **Hosting:** Vercel (frontend + API routes)
- **Source control:** GitHub (private repo)
- **Stream integration:** vMix browser sources + vMix Web Controller API for triggered overlays

### 6.2 Deployment Model
- `main` branch → auto-deploys to production
- `staging` branch → auto-deploys to staging.cadeesports.com
- PR previews → auto-generated URLs for review
- Database migrations via Supabase CLI + SQL files checked into repo

### 6.3 Security Posture
- All passwords hashed (Argon2id, handled by Supabase Auth)
- All PII (bank details, ID document URLs) encrypted at rest with separate key
- Every API route checks permissions against JWT claims via single `hasPerm(user, action)` helper (Phase 1A: hard-coded perm map; Phase 1B: DB-backed)
- RLS policies only on PII-holding tables (users, players, payments) — defense in depth
- Audit log is append-only (triggers on every mutable table capture before/after JSONB; update/delete on `audit_events` blocked)
- Rate limiting on auth endpoints (5 login attempts / 15min / IP)
- Session tracking: IP, UA, login time. Admin-only: new-device login email alert + full login history view.
- Suspicious activity flags: new device, multiple concurrent sessions, unusual API volume

### 6.4 Backup Strategy
- **Local dev:** daily `pg_dump` of Supabase local stack (or `supabase db dump`) checked into gitignored `backups/` folder; rotate 14 days.
- **Production (Vercel + Supabase):** daily `pg_dump` via GitHub Actions cron → Backblaze B2 (S3-compatible, ~$6/TB/mo, pennies for <10GB). Retain 30 daily + 12 monthly archives.
- **Alternative:** Supabase Pro tier ($25/mo) includes PITR; evaluate once league revenue supports it.
- **Restore test:** quarterly — download last backup, restore to staging, verify row counts.

### 6.5 Phase 1A Simplifications (to revisit later)
- Hard-coded `Africa/Lagos` timezone in application layer.
- Elite 2025-2026 season is hard-coded; no `SeasonDivision` configuration layer yet.
- Division-agnostic data model (`Season`, `Division`, `SeasonDivision`) documented in Section 4 but implemented as fixed constants until second season begins.
- Permissions are a TypeScript constant map in Phase 1A; Phase 1B migrates to DB + admin editor.

---

## 7. Your 8 Requirements — Mapped to This Structure

| # | Your Requirement | Covered By | Phase |
|---|-----------------|------------|-------|
| 1 | Match input → leaderboard, stats | MatchResult entity + computed Standings + stats views | 1A |
| 2 | Stream graphics with live data | OverlayTemplate + OverlayEvent + vMix browser sources | 2 |
| 3 | Role assignment + role option control | Role, Permission, RolePermission, UserRole tables | 1A (core), 1B (full matrix) |
| 4 | QR check-in with late/early tracking | CheckIn + VenueGeofence + LateArrivalOffense | 1B |
| 5 | Punishments with auto-propagation | DisciplinaryCase + DisciplinaryAction + triggers recalc Standings | 1B |
| 6 | Announcements with user updates | Announcement + Notification + channel delivery | 1A (in-app), 2 (WhatsApp) |
| 7 | User auth + role-based visibility | Supabase Auth + RLS policies + UserRole | 1A |
| 8 | Prevent/detect account takeover | Session + AuthEvent + anomaly flagging | 1A (basic), 3 (advanced) |

---

## 8. Gaps from the Rulebook (Features You Didn't List But Need)

Flagged now so we don't retrofit:

1. **Weekly squad submission (Thursday 10 AM)** — with automated late-submission counters triggering warnings/forfeits. *(Phase 1B)*
2. **Friday change window (9-10 PM, 1 swap)** — time-boxed UI that opens and closes automatically. *(Phase 1B)*
3. **Squad validation against budget + Nigerian item + banned items** — manual at first, Futbin-scraper attempted in Phase 3.
4. **Late arrival scaling sanctions** — automatic application of the 5.4 scale based on `AttendanceMark` status. *(Phase 1A)*
5. **Forfeit 3-0 propagation** — forfeit declared → match result auto-set to 3-0 + standings recompute. *(Phase 1A)*
6. **Voided matches when a player is suspended mid-season** — their remaining matches are voided per Rule 3.4.4.2 and must not count in GD/points. *(Phase 1B)*
7. **Caution fee ledger** — org caution is a live balance that gets debited for fines; org must top back up within 7 days or players ineligible. *(Phase 2)*
8. **Pre-season photo/video shoot attendance** — tracked; non-attendance generates warning per 2.5. *(Phase 1B)*
9. ~~Under-18 parental consent tracking~~ — **dropped** (no minors in Elite).
10. **Appeal panel management** — 3-independent-member panel per appeal, 5 business day window enforced. *(Phase 2)*
11. ~~Anonymous whistleblower dispute reporting~~ — **dropped for now** (revisit if incident occurs).
12. ~~Prize withholding during investigation~~ — **dropped** (no prize automation at all; manual disbursement).

---

## 9. Open Questions (Must Be Answered Before Phase 1A Code)

Tagged by urgency:

### BLOCKING (needed this week)
- ~~Hosting decision.~~ **Resolved 2026-04-20:** Vercel + Supabase. Local-first dev, push to prod later.
- **Domain.** Do you have a domain registered? Preferred subdomain structure (e.g., league.cadeesports.com, admin.cadeesports.com)?
- **GitHub organization.** Existing CADE org or new? Who gets commit access?
- **Season 2025-2026 scope.** You already agreed Division 1 starts April 25 and runs on spreadsheets. Confirm we are NOT trying to ship anything before April 25.
- **Player list.** User to send 13-player roster for seed data.

### HIGH PRIORITY (needed in first 2 weeks)
- **Venue details.** Exact address, latitude/longitude for geofence, wifi SSID (for optional on-network validation).
- **vMix production setup.** What's the version? Who's the production operator I'll coordinate with? Is there a vMix Web Controller license?
- **Paystack business account.** Does CADE Entertainment have it already? What's the settlement account?
- **Visual design assets.** Who designs the overlay visuals? Are there existing brand guidelines / colors / fonts?
- **Brand voice docs.** I noticed there's a `brand-voice` skill available and this project mentions design. Are there existing brand guidelines I should be using for all site copy?

### MEDIUM PRIORITY (needed before Phase 2)
- **Who's on the IDC right now?** We need real user accounts for them.
- **Org list.** All CAC-registered orgs with Elite players, their CAC numbers, their reps.
- **Player list.** All 16 Elite players, their orgs, their PSN IDs.
- **Referee list.** Who calls matches, who handles the stage, who handles tech.
- **Dev friend's identity and contact.** I need to know who's on call so we can co-design the emergency playbook.

### NICE TO KNOW
- **Sponsors.** Are there sponsor logos/integrations that need to show in stream overlays?
- **Anthem/intro sequences.** Does the stream have branded intro animations we need to trigger?
- **Historical data.** Any prior-season data that needs to migrate in?

---

## 10. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Build takes longer than 9-11 weeks | High | Medium | Ruthless Phase 1A scope. Ship weekly. |
| Solo dev / AI-on-demand fails at 10 AM Saturday | Medium | High | Dev friend pre-briefed. Runbook written. Managed services = fewer things to fix. |
| Paystack approval delay | Medium | Medium (blocks Phase 2) | Start Paystack registration NOW, in parallel. |
| EA patches break squad scraper | High (Phase 3) | Low | Start with manual validation. Automation is Phase 3 nice-to-have. |
| vMix production team unavailable / uncooperative | Medium | Medium | Confirm production contact before Phase 2 kickoff. |
| Real PII in the database (NIN, bank, ID docs) | Certain | High if breached | Encrypted bucket + RLS + audit log + rate limits + MFA on admin accounts |
| Player under-18 content — data/consent complexity | Medium | High | Parental consent upload required before any participation data collected |
| Scope drift from LOC/IDC mid-build | High | High | This document is the contract. Changes require explicit scope review. |

---

## 11. What I Need From You Next

1. **Review this document.** Mark up anything wrong, missing, or objectionable.
2. **Answer the BLOCKING open questions in Section 9.**
3. **Approve the 12-role permissions matrix** (or tell me which roles to collapse or add).
4. **Commit to the 3-phase sequence** (or propose a different cut).
5. **Loop in your dev friend** so they see this before we write code.

Once 1-5 are done, I move to `DATA_MODEL.md` (detailed schema + ERD) and then Phase 1A implementation.

---

## 12. Document Log

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 0.1 | 2026-04-20 | Claude (via Spektakula) | Initial draft based on rulebook + conversation |
| 0.2 | 2026-04-20 | Claude (via Spektakula) | Phase 1A scope-locked after brainstorm. Added Decisions Log (§2.5). Dropped: geofence, prize disbursement, under-18 consent, auto promo/relegation, mobile app, anonymous whistleblower. Confirmed monolith, hard-coded perms Phase 1A, RLS only on PII, DB-trigger audit, idempotent recompute, ref-driven attendance, backup strategy (§6.4). |
