# Stub-page + nav-link audit — 2026-04-24

## Scope

Follow-up to commit `34ac6ed7` (fixed the `/player/profile` stub by
redirecting to the rich `/profile`). User asked whether the same class of
bug exists elsewhere — a nav link that lands on a thin placeholder
while a richer page with the same purpose lives under a different route
group.

## Pages audited

96 `page.tsx` files under `apps/web/src/app/**`. Split by route group:

| Group | Count |
| :--- | ---: |
| `(auth)` | 3 |
| `(overlay)` | 40 |
| `admin/**` | 34 |
| `player/**` | 7 |
| `referee/**` | 2 |
| Top-level public | 10 |

## Findings

Every short candidate was read in full. Every candidate with <80 lines
was confirmed rich or intentional.

| Route | Class | Action | Notes |
| :--- | :--- | :--- | :--- |
| `/player/profile` | STUB (already redirect) | none — shipped in `34ac6ed7` | 15 lines, redirects to `/profile` |
| `/admin/trash` | INTENTIONAL redirect | none | 7 lines, redirects to `/admin/trash/[first-entity]` — normal "index → first tab" pattern |
| `(overlay)/overlay/*` using `PreviewStub` | DISTINCT | none | These ARE production browser sources for OBS/vMix. `PreviewStub` is the harness wrapper the broadcast operator loads; not a user-nav target. Plan 48 phase 2 is scheduled design parity, not a placeholder — leaving as-is. |
| `/admin/precedents` (no index) | DISTINCT | none | Only the `[playerId]` detail exists. Deep-linked from `/admin/punishments/[id]` + `/admin/match-days/[id]/attendance`. No listing needed. |
| `(auth)/profile/[userId]` (91 lines) | DISTINCT | none | Thin admin cross-view of someone else's profile. Intentionally narrower than `/players/[id]` (public roster profile, 525 lines) — former is for staff editing display_name/bio, latter is for public stats + history. |
| `/admin/match-days` (55 lines) | RICH | none | Thin-looking because heavy lifting is in `<MatchDaysSearchTable>`. |
| `/` (67 lines) | RICH | none | Thin because `<Hero>`, `<UpcomingMatchDayCard>`, `<TopOfTable>`, `<LatestAnnouncements>` do the work. |
| `/standings` (70 lines) | RICH | none | Server → `<StandingsTable>`. |
| `/admin/orgs/new` (60 lines) | RICH | none | Form component mounts `<CreateOrgForm>`. |
| `/admin/broadcast/stingers` (242 lines) | RICH | none | Plan 47 broadcast panel. |
| `/admin/branding` (447 lines) | RICH | none | Full branding surface. |
| Every other page | RICH | none | Substantial server-resolved data + real components. |

**Verdict:** only ONE bug-class instance remained and it was a nav-link
pointer, not a second stub page.

## Nav links audited

Every nav component's hardcoded href set:

| Nav component | href | Target state | Action |
| :--- | :--- | :--- | :--- |
| `SiteChromeClient` — primary nav | `/`, `/fixtures`, `/standings`, `/players`, `/announcements`, `/punishments`, `/admin` | all rich | none |
| `NavDrawer` — PUBLIC_LINKS | `/`, `/fixtures`, `/standings`, `/players`, `/announcements`, `/punishments` | all rich | none |
| `NavDrawer` — PLAYER_LINKS | `/player/squad`, `/player/profile`, `/player/appeals`, `/player/disputes` | `/player/profile` was a redirect hop to `/profile` | **updated** to `/profile` directly |
| `NavDrawer` — STAFF_LINKS | 18 admin routes | all rich | none |
| `NavDrawer` — REFEREE_LINKS | `/referee/attendance` | rich | none |
| `PlayerSubnav` TABS | `/player/squad`, `/player/disputes`, `/player/appeals`, `/player/profile` | `/player/profile` was the redirect hop | **updated** to `/profile` directly |
| `AdminSubnav` TABS | 16 admin routes | all rich | none |
| `UserBadgeShell` user-menu | `/profile`, `/logout` | rich | none |
| `AdminShell` "Back to site" | `/` | rich | none |
| `TrashTabs` entity tabs | `/admin/trash/[entity]` for every `TRASH_ENTITY_KEYS` | all rich | none |
| `NotificationsDropdown` | `/notifications` + dynamic `row.href` values | rich | none |
| `SquadStatusWidget` | `/player/squad` | rich | none |

Count: **58 hardcoded nav hrefs**, 2 were pointing at the `/player/profile`
redirect stub.

## Fixed this pass

2 nav-href updates — both now point directly at the rich `/profile`:

1. `apps/web/src/components/public/NavDrawer.tsx` — `PLAYER_LINKS`
   "Profile" href.
2. `apps/web/src/app/player/PlayerSubnav.tsx` — `TABS` "Profile" href.

`apps/web/src/app/player/profile/page.tsx` (the redirect stub from
`34ac6ed7`) is kept in place so stale deep links / bookmarks still
land on the rich page.

0 new page files. 0 migrations. 0 redirect pages added. 0 broken links
found that would 404.

## Left intentional

- `/admin/trash` → `/admin/trash/[first-entity]` redirect. Canonical
  "index routes to first tab" pattern; the entity pages are the rich
  surfaces.
- All `(overlay)/overlay/*` routes that import `PreviewStub`. These are
  the live browser-source templates for OBS/vMix/Streamlabs; the
  TODO-Plan-48 comment refers to future motion-design parity, not to
  the template being a placeholder. User nav never points at these.
- `(auth)/profile/[userId]` vs `/players/[id]`. Former is admin
  cross-view (display_name/bio edit); latter is the public roster
  profile (sanctions, stats, attendance, squad). Different audiences,
  different data. Not a stub.
- `/admin/precedents/[playerId]` with no index page. Deep-linked only.

## Left for decision

None. Every finding either fixed, already fixed in `34ac6ed7`, or
explicitly classified DISTINCT with rationale.

## Verification

- `npm run test` — 1178/1178 passing (136 files).
- `npm run lint` — 0 errors (12 pre-existing warnings, all unrelated).
- `npx vitest run src/components/public/NavDrawer.test.tsx` — 12/12
  passing; no test asserted on the old `/player/profile` drawer href.

## Files touched

- `apps/web/src/components/public/NavDrawer.tsx`
- `apps/web/src/app/player/PlayerSubnav.tsx`
- `docs/superpowers/specs/2026-04-24-stub-page-audit.md` (this file)
- `tasks/lessons.md` (lesson appended — see Error-log rule)
