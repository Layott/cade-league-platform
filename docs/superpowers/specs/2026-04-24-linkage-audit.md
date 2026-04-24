# Data linkage audit — 2026-04-24

A plain-English tour of what connects and what doesn't across the CADE platform.

## What this report is for

The platform has a lot of pages. When an admin, a referee, or a player does something on one page, the result should show up automatically everywhere else it matters — match scores on the fixtures page, punishments on the player profile, new disputes on the admin queue, and so on. This audit walks through every "thing that happens" on the platform and asks: does the rest of the platform notice? In a handful of places the answer is no, and those gaps are what this document is about.

This is an observation-only report. No code was changed. Where a behaviour is ambiguous — could be intentional or could be a bug — the question is flagged with "Is this meant to happen?"

## How to read it

- OK — working as expected
- GAP — something that should link but doesn't
- CONCERN — connects, but in a way that might surprise you (too much access, stale for too long, etc.)

Each section covers one subject area. Paths like `/admin/punishments` are website pages; paths like `apps/web/src/app/.../actions.ts` are where the server-side logic lives if you want to find the file later.

---

## 1. Punishments (warnings, bans, point deductions)

**Where admins write:** `/admin/punishments/new`, `/admin/punishments/[id]` (edit / revoke / soft-delete)
**Who's supposed to see the change, and do they?**

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/punishments` list | OK | Refreshes right after create / edit / revoke / delete |
| `/admin/punishments/[id]` detail | OK | Refreshes on edit / revoke |
| `/punishments` (public register) | OK | Refreshes immediately — hides revoked and non-public rows |
| `/profile` (player's own view) | OK | Refreshes on all four actions |
| `/players/[id]` (public player profile) | OK | Fixed earlier today — all four actions now refresh this page |
| League standings (`/standings`) | OK | Point- and goal-difference deductions flow into standings via a database trigger, and the standings page live-refreshes without a reload |
| Broadcast score bug / leaderboard overlays | OK | Standings overlays listen on a live channel; a deduction shows up within seconds |

There is one question worth flagging:

- **Void propagation for bans.** When a ban is issued with `effectiveFrom` + `effectiveUntil`, a database trigger is supposed to mark any matches during that window as void, and the void feeds the standings recompute. The implementation exists in migration `20260502000004_propagate_suspension_voids.sql`, so the link is present. **Is this meant to happen?** If a match that was already played before a ban is issued falls inside the ban window, it will be retroactively voided — this is correct per Rule 3.4.4.2 but might surprise a casual admin.

Verdict: Punishments are the best-linked subject area. The recent phantom-column fix plus the standings trigger mean the whole chain is solid.

---

## 2. Squad submissions

**Where players write:** `/player/squad` (full submission), `/player/squad/change` (Friday change window)
**Where admins write:** `/admin/squads/[id]` (approve / reject / reopen / accept Futbin candidate), `/admin/squads` (league-wide window override + per-player override)

| Surface | Status | Note |
| --- | --- | --- |
| `/player/squad` after player submits | OK | Page refreshes and shows the read-only "existing" card |
| `/admin/squads` (admin queue) after player submits | GAP | **The player-submit action does not refresh `/admin/squads`.** Admin sees the new submission only after the page's own 60-second cache expires or a manual reload. Admin also does not get any in-app notification. |
| `/player/squad` after admin approves / rejects | GAP | **Admin actions refresh `/admin/squads/[id]` and the admin list, but not `/player/squad`.** The player continues to see the old "pending" pill until their page's cache expires. |
| `/player/squad` after admin reopens a locked submission | OK | The reopen code fires an in-app notification to the player, and the admin action does NOT revalidate `/player/squad` — so the player sees the notification, then has to reload to see the form. **Is this meant to happen?** A revalidation here would remove the reload step. |
| `/players/[id]` "This week's squad" after admin approve | GAP | The admin approve action revalidates only the admin pages. The public player profile continues to show whatever `approvedSquad` it last fetched until the 60-second cache expires. |
| Friday change window on `/player/squad/change` after submit | OK | Page refreshes |
| Admin-side view of a Friday change | CONCERN | The player action revalidates `/player/squad/change` and `/player/squad`, but NOT any admin surface. If admins look at `/admin/squads/[id]` right after a Friday change, they'd see the pre-change layout until their cache expires. |
| Broadcast overlays showing lineups | CONCERN | The overlay data routes read live from the DB on every fetch, so approved squads do flow into lineups — but only if the overlay is using `force_open` windows, since a public `/players/[id]` squad view is always the "approved" current-week submission. Sanity-check this against your actual broadcast playbook. |
| Player ban on squad submission (admin action at `/admin/squads`) | OK | Admin action revalidates `/admin/squads`, `/admin`, `/player/squad` — the banned player sees the updated state |

Verdict: squads are the LEAST-linked of the major subject areas. Every admin ↔ player round trip has at least one stale surface.

---

## 3. Disputes

**Where players write:** `/player/disputes/new`
**Where admins write:** `/admin/disputes/[id]` (assign panel, rule)

| Surface | Status | Note |
| --- | --- | --- |
| `/player/disputes` (my disputes) after player submits | OK | Refreshes |
| `/admin/disputes` list after player submits | GAP | **Player submit does NOT refresh the admin queue.** Admins see new disputes only when the page's own cache expires or they reload. |
| Admin dashboard "open disputes" count | GAP | The dashboard reads `disputes.status = 'open'`, but the database only knows `'submitted' | 'under_review' | 'resolved' | 'withdrawn'` — **'open' isn't a real status.** The count is always zero. This is a phantom-column / phantom-value bug. Separately, even once fixed, the dashboard isn't revalidated on dispute changes. |
| `/profile` (player view) | GAP | The player's profile has dedicated sanction and squad widgets, but no "My disputes" widget. The dispute surface only exists under `/player/disputes`. **Is this meant to happen?** |
| `/admin/disputes/[id]` after admin rule / assign | OK | Both actions revalidate the detail + list |
| Player's `/player/disputes` after admin rules | GAP | **Admin ruling does not refresh the player's list.** The player sees the ruling only on reload. |
| Any notification / email to the player when admin rules | GAP | No in-app notification, no email — the player has to notice the status change themselves. The only automatic notification anywhere in the dispute/appeal system is "squad reopened". **Is this meant to happen?** |

---

## 4. Appeals

**Where players write:** `/player/appeals/new`
**Where admins write:** `/admin/appeals/[id]` (assign panel, rule)

| Surface | Status | Note |
| --- | --- | --- |
| `/player/appeals` after player submits | OK | Refreshes |
| `/admin/appeals` list after player submits | GAP | Same problem as disputes — the player's submit action refreshes only `/player/appeals`, not the admin queue |
| Associated punishment / disciplinary case | CONCERN | When an appeal is ruled, the ruling is written onto the `appeals` row. **The linked `disciplinary_actions` row is NOT touched** — no `revoked_at`, no magnitude change, no "appeal overturned" flag. If the panel upholds an appeal, an admin has to go to `/admin/punishments/[id]` and manually revoke the punishment. **Is this meant to happen?** If the business rule is "the panel rules in words, the admin implements in actions," the current behaviour is correct. If the rule is "a successful appeal automatically voids the sanction," this is a gap. |
| Player's `/profile` sanctions widget | CONCERN | The widget shows `isAppealWindowOpen` and `alreadyAppealed` flags. It does NOT show the appeal's status (submitted / ruled / withdrawn) or the ruling text. A player who appealed a month ago cannot tell from `/profile` whether the appeal has been decided. |
| `/player/appeals` after admin rules | GAP | Same as disputes — no revalidation of the player list, no notification |
| `/admin/appeals` after admin rules | OK | Refreshes the detail + list |

---

## 5. Match results (the main competitive flow)

**Where the referee writes:** `/admin/match-days/[id]` (enter result, edit result, confirm result) — technically an admin page used by the ref
**What happens automatically:** database triggers recompute the standings whenever a result changes, and a real-time event fires on the standings channel

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/match-days/[id]` after result entered | OK | Refreshes |
| `/standings` public page | OK | Page has a live-refresh hook that listens on the standings channel and re-renders within seconds |
| `/fixtures` public page | CONCERN | Revalidated by the admin action, but has no live-refresh subscriber — the result shows up when the page's 60-second cache expires. A viewer sitting on `/fixtures` during a match won't see scores roll in live; they'd have to reload. **Is this meant to happen?** Standings does it live; fixtures could too. |
| `/players/[id]` "Season stats" | OK | Reads from the standings table, so it gets the recomputed totals |
| `/players/[id]` "Recent match stats" | GAP | **Match result entry does NOT revalidate `/players/[id]`.** The season stats come from standings (which is recomputed), but the recent-matches section reads from the `matches` + `match_results` tables directly and is cached for 60 seconds. Opponents and dates can be stale. |
| `/profile` match history + H2H + form strip | GAP | Same story — the `/profile` page is `force-dynamic`, but the `recentStats` / `getMatchHistory` / `getH2HGrid` queries aren't pushed by any event. The player has to reload. |
| Broadcast score bug | OK | The score-entry action calls `syncScoreToLiveSessions` which rewires the live overlay via a real-time trigger if the match is pinned to a session |
| Leaderboard / up-next / match-scores-day overlays | OK | Subscribe to the standings channel and refetch on every broadcast — so the leaderboard and day-of-match scores update live |
| `/admin/match-days` list (grid of days) after publish/unpublish | OK | Revalidated |

---

## 6. Attendance

**Where the referee writes:** `/referee/attendance/[matchDayId]` (calls actions defined at `/admin/match-days/[id]/attendance`)

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/match-days/[id]/attendance` (the mark page itself) | OK | Refreshes on mark / edit / undo |
| `/standings` | OK | Revalidated — attendance marks can cascade into disciplinary actions which then cascade into standings |
| `/admin/match-days/[id]` detail | GAP | **The attendance action only revalidates the attendance subpage, not the match-day detail that shows the arrival status summary.** If the match-day detail page shows attendance rollups, they'll be stale. |
| `/players/[id]` | GAP | **Not revalidated by any attendance action.** If late arrival / absence cascades into a warning or ban, the sanction eventually lands on the player profile (via the punishment path), but the raw attendance mark itself isn't visible anywhere public. **Is this meant to happen?** |
| `/profile` | GAP | Same — no revalidation. The player cannot see their own attendance marks in `/profile` today. |

---

## 7. Match day lifecycle

**Where admins write:** `/admin/match-days/new` (create), `/admin/match-days/[id]` (add / edit / remove fixtures, publish, unpublish, reorder)

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/match-days` list after create | CONCERN | The create flow lives at `/admin/match-days/new` — need to verify in that file whether it revalidates `/admin/match-days`. The edit / publish flows at `/admin/match-days/[id]` do revalidate correctly. |
| `/fixtures` public page on publish / unpublish / reorder / add / remove | OK | Every fixture-mutating action revalidates `/fixtures` |
| `/players/[id]` upcoming matches | GAP | A `/players/[id]` page could show upcoming fixtures, but today it doesn't — and if a future version adds them, none of the fixture actions revalidate `/players/[id]`. Low priority until the feature exists. |
| `/profile` upcoming matches | GAP | Same as above. |

---

## 8. Stats screenshots (Plan 14)

**Where admins write:** `/admin/match-days/[id]/stats-upload` (upload, rerun OCR, confirm review, reject review)

| Surface | Status | Note |
| --- | --- | --- |
| Stats-upload page itself | OK | Refreshes on every action |
| `/players/[id]` recent match stats (both competitors) | OK | The confirm-review action explicitly revalidates both player IDs |
| `/profile` recent stats | GAP | **The confirm-review action does NOT revalidate `/profile`.** A player who uploaded a screenshot and got it approved won't see the new stats on their own profile until the cache expires. |
| `/admin/stats-review` admin queue | GAP | The confirm / reject / rerun actions revalidate the match-day upload page but not the standalone `/admin/stats-review` queue. The queue stays stale. |
| Broadcast overlays referencing per-player goals / shots | UNCLEAR | The top-scorers overlay is fed by a live data endpoint that reads goals from `player_match_stats`. Whether the live channel re-fires on confirm-review is worth checking. |

---

## 9. Orgs + caution ledger (Plan 13A)

**Where admins write:** `/admin/orgs/[id]` (update, link/unlink player, link coach, link manager), `/admin/orgs/[id]/contracts/new`, `/admin/orgs/[id]/ledger/new`

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/orgs/[id]` detail | OK | Revalidated on every mutation |
| `/admin/orgs` list | CONCERN | Revalidated on some actions (update, soft-delete) but not on link-player / link-coach / link-manager / contract create / ledger entry. The list view probably doesn't show those fields, so this might be fine — but worth a glance. |
| `/players/[id]` org badge | GAP | **The player profile loads `organization_id` but never renders it.** When you link a player to an org from `/admin/orgs/[id]`, there is no public surface where anyone can see that link. **Is this meant to happen?** The data is there; the UI isn't. |
| `/players/[id]` contract tag / manager / coach | GAP | Same — `team_manager_id` and `coach_id` are loaded and unused. |
| Admin dashboard / caution totals | GAP | Ledger entries live on `/admin/orgs/[id]` only. The admin dashboard has no "balance across all orgs" tile. |
| Public visibility | OK | Intentional — orgs + caution ledger are admin-only, no public page |

---

## 10. Roles and permissions

**Where admins write:** `/admin/users/[id]` (assign / remove role), `/admin/roles` (permission matrix editor)

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/users` list | OK | Revalidated |
| `/admin/users/[id]` detail | OK | Revalidated |
| Menu visibility, action buttons across every surface | CONCERN | Permission checks are backed by a 30-second in-process cache (`hasPermAsync`). When an admin grants a role, the affected user may need to wait up to 30 seconds for the new menu items to appear. **Is this meant to happen?** It's an explicit design decision — the cache was introduced to avoid hammering the permissions table — but the UX is a quiet lag rather than instant. |
| `/admin/roles` matrix editor | OK | Revalidates itself |
| Any other surface gated by perms | GAP | Changing the permission matrix only revalidates `/admin/roles`. Every other surface waits up to 30 seconds for the cached check to expire. |

---

## 11. Branding

**Where admins write:** `/admin/branding` (colors, logos, partner marks)

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/branding` itself | OK | Revalidates after every action |
| Public header logo | GAP | **No branding action revalidates the public pages (`/`, `/standings`, `/players`, `/fixtures`, `/punishments`).** If the header reads the brand logo from `brand_settings`, it stays stale until every page's own cache expires. |
| Overlays that reference partner marks | GAP | Same — overlay routes aren't revalidated. |
| Admin dashboard | GAP | Same. |

This is the biggest single gap in the platform: when you rebrand, nothing outside `/admin/branding` notices for up to 60 seconds (or longer for overlays).

---

## 12. YouTube chat / broadcast sessions

Broadcast session flow is out of scope for this audit (owned by a separate agent). At a glance:

- **YouTube channels** (`/admin/youtube-channels`) — admin actions revalidate `/admin/youtube-channels` only. If a channel is added / edited / removed, the broadcast session picker will see it on the next revalidation but no external refresh fires.
- **Active broadcast sessions, overlay triggers** — uses a dedicated live channel system. Overlays subscribe to `overlay:<sessionId>` and re-fetch on every event, so this is well-linked.

---

## 13. Announcements (noticed during the audit)

**Where admins write:** `/admin/announcements/new`, `/admin/announcements/[id]`

| Surface | Status | Note |
| --- | --- | --- |
| `/admin/announcements` list after create | GAP | **The create action does NOT revalidate anything.** It redirects to the detail page but leaves the list view stale. |
| `/announcements` public page after publish | GAP | Same — `publishNowFromDetail` revalidates only the detail page, not the public list. |
| Admin dashboard "open cases" tile | GAP | Reads `published_at IS NULL` to count drafts — that part is correct — but the dashboard itself isn't revalidated. |
| Target audience inbox | OK | Announcements fan out into `notifications` rows via the server module; the player's notification bell will show the new entry |

---

## Over-coupling we noticed

These are places where a surface sees MORE data than it probably should — either too much detail or too many rows.

1. **`/profile` sanction widget and `/players/[id]` sanction list both read through service-role.** This is by design (Plan 39 C3 locked down `disciplinary_actions` with deny-all RLS for authenticated reads, so the server has to use service-role to get anything back). The filters in `listForPlayer` correctly hide revoked / deleted / non-public rows. But this is "trust the function" rather than "trust the database" — a future refactor that bypasses `listForPlayer` and hits the table directly will accidentally leak every private sanction on the player. **Is this meant to happen?** Yes per the migration comments, but the risk is real.

2. **`/admin/appeals/[id]` exposes every candidate panel member's raw `email`.** The page queries `users` for `display_name, email` and the email is fed to the `<option>` fallback label when `display_name` is null. In practice every seeded user has a display name, so emails rarely surface — but if a role ever gets added without a display name, the admin dropdown will show their email. **Is this meant to happen?** Minor, but notable.

3. **`/admin/disputes` shows raiser email as fallback.** Same pattern — `display_name ?? email`. Same note.

4. **Admin dashboard hero card counts are computed via service-role.** Fine in itself, but one query reads the non-existent `disputes.status = 'open'` (phantom value — see §3), which should be fixed regardless of linkage.

5. **`/players/[id]` loads `organization_id`, `team_manager_id`, `coach_id` but renders none of them.** This is a "data flowing out of the query but not displayed" case — no privacy concern, but it's either incomplete UI or the query is wider than it needs to be.

6. **Standings `revalidate = 60` + live-refresh subscriber.** Technically fine — the live-refresh does the real work and the 60s cache is insurance. But it means a viewer who loaded the page then lost their Realtime connection will see stale data for up to a minute. **Is this meant to happen?** Probably yes; worth flagging.

---

## Things we recommend fixing next

Ranked by how much "it's broken, I did the thing and nothing happened" frustration they cause.

1. **`/admin/squads` not refreshing when a player submits a squad.** Admins get no notification and no updated row until they reload. Ranks #1 because squads are the most frequent admin ↔ player interaction and the lag is noticeable every single week.

2. **`/player/squad` not refreshing after admin approves / rejects.** Mirror of #1 on the player side. Player sees "pending" long after the admin has acted.

3. **Admin dashboard "open disputes" count reads a status value that doesn't exist.** Always shows zero. Either change the query to `status IN ('submitted', 'under_review')` or add an `'open'` alias. Small fix, visible impact — the badge is a lie today.

4. **Match result entry doesn't refresh `/players/[id]` recent matches or `/profile` match history.** The standings update, but a viewer going to their own profile or a competitor's profile right after a match sees stale per-match detail for up to 60 seconds. Would benefit from the same live-refresh pattern standings uses.

5. **Branding changes don't refresh public / overlay surfaces.** When a new logo drops, the whole platform ignores it until caches expire. Revalidate `/`, `/standings`, `/fixtures`, `/players`, `/punishments`, plus a handful of overlay template paths when brand settings change.

6. **Dispute and appeal rulings send no notification to the player.** The player discovers the ruling by reloading. Even a single in-app notification row (same pattern as `squad_reopened`) would close this.

7. **`/player/disputes` and `/player/appeals` not refreshing after admin rules.** Independent of #6 — even without notifications, a revalidation call would let the player see the ruling on their next navigation.

8. **`/admin/announcements` list and `/announcements` public page not refreshing on create / publish.** Admins see stale drafts; public viewers see outdated news.

9. **`/players/[id]` has org / team-manager / coach IDs loaded but never shown.** Either render the tag or remove them from the query. Currently sitting between "unused" and "almost-shipped".

10. **Role/permission edits take up to 30 seconds to propagate to every surface.** Documented design decision, but a surprise to first-time admins. Either bust the cache on role change (emit an event the process listens for) or surface the lag in the admin UI ("new role may take up to 30 seconds to appear in the menu").

---

## Questions for the product owner

These are places where the behaviour could be a bug or could be intentional — they need a decision rather than an engineering fix.

- **Should a successful appeal automatically void the linked punishment?** Today the ruling is text-only; an admin has to manually revoke.
- **Should `/profile` show the player's own disputes + appeals lists?** Today they live under `/player/disputes` and `/player/appeals` but are absent from `/profile`.
- **Should `/profile` show attendance history?** Today referees mark attendance and nothing on the player's view reflects it (except downstream punishments).
- **Should `/fixtures` live-refresh like `/standings` does?** Both pages have similar audiences; only standings updates instantly.
- **Should the public player profile show the org badge / manager / coach?** The data is loaded; the UI is missing.
- **Should broadcast overlays that show Friday change windows update in real time, or is the current 60-second cache acceptable?**

Answering these six questions turns this audit into an actionable punch list.
