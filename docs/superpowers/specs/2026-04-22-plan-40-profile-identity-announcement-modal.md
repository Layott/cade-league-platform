# Plan 40 — Profile, Identity visibility, and Announcement modal

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Approved, ready for implementation plan
**Origin HEAD:** `24bf61f`
**Depends on:** Plan 9 (roles), Plan 2 (players), Plan 7 (announcements), Plan 13B (notifications)

---

## 1. Goals

1. Every signed-in user can instantly see **who they are logged in as** (display name + role chip) from every page via a header badge.
2. Every signed-in user can view + edit their own profile at `/profile`. Only admins can view a different user's profile at `/profile/<userId>`.
3. The bell / announcement icon opens a **modal** — list → detail → mark-read — not a new page. Unread announcements show a badge dot on the bell.

**Non-goals (Plan 41 scope):** player-specific stat panels, sanctions list, appeal button, squad status widget, squad due banner, admin squad reopen.

---

## 2. Success criteria

1. Logged-in user lands anywhere; top-right shows `<avatar> <display_name> <role-chip>` — always visible, always correct.
2. Click badge → dropdown with `Profile`, `Sign out`. Click `Profile` → `/profile`.
3. `/profile` renders: avatar, display_name, email, gamer_tag (players only), jersey_number (players only), bio, organization (if any), **full list of active roles** as chips, editable photo + bio + display_name. Save triggers a server action; page revalidates.
4. `/profile/<userId>` where `<userId>` ≠ self is only reachable by admins; others get 403.
5. Click bell icon → modal opens. Shows list of all non-archived announcements the user is entitled to see (audience + deleted_at filter); unread rows have dot. Click row → second pane in same modal shows title + date + rendered `body_md` + "Mark as read". ESC / backdrop / X close.
6. Bell icon shows red dot when at least one unread announcement exists; dot clears after all visible rows marked read OR via "Mark all read" button.

---

## 3. Architecture

### 3.1 Header: `<UserBadge />`

- Server component embedded in `SiteChrome` for every route except `/overlay/*` (existing chrome-skip list).
- Reads actor via `getActorFromSession()`. If unauthenticated: render "Sign in" link instead (existing behaviour preserved).
- If authenticated: pulls `users.display_name`, `players.photo_url` (if user has a player row), and **all** `user_roles.role` rows via one server-side query.
- Role chip: shows the highest-precedence role by this ordering — `admin > loc > idc > referee > technical > production > moderator > design > coach > team_manager > player > viewer`. Badge dropdown shows *all* roles as a list, not just the chip.
- Dropdown (client island — small `<UserBadgeMenu />` child) uses native `<details>` for no-deps popover; items: "Profile" (link to `/profile`), "Sign out" (form POST → `/logout`).

### 3.2 `/profile` route

- `apps/web/src/app/(auth)/profile/page.tsx` — self view.
- `apps/web/src/app/(auth)/profile/[userId]/page.tsx` — admin view of another user.
- Shared server module `apps/web/src/server/profile/read.ts` → `getProfileView(sb, actor, targetUserId)`:
  - If `targetUserId === actor.userId` → return full profile.
  - Else require `users.edit.any` permission OR throw PermissionDenied (403 via Next.js `notFound()` shim).
- Shared component `<ProfilePanel profile={…} editable={boolean} />`.
- Editable fields (self OR admin): `display_name`, `bio`, `photo_url`. All other fields (email, roles, gamer_tag, jersey_number, organization) read-only; admin changes those through existing `/admin/users/[id]` path.
- Photo upload via existing `player-photos` bucket helper (signed upload), for users without a player row it lands in a new `user-avatars` bucket (added in Plan 41 migration — for Plan 40, non-player users fall back to initials or a default avatar).

### 3.3 Announcement modal

- Replace the existing `<Link href="/announcements">` in the bell with a client `<AnnouncementBell />` component.
- `<AnnouncementBell />`:
  - Fetches unread count on mount + every 60 s via `/api/notifications/unread-count`.
  - Renders bell icon with red dot when count > 0.
  - On click: opens `<AnnouncementsModal />`.
- `<AnnouncementsModal />`:
  - Radix `@radix-ui/react-dialog` primitive OR hand-rolled focus-trap; prefer hand-rolled to avoid a new dep. Behaviour: ESC, click backdrop, click X → close. Focus trap within modal. `aria-modal="true"`, `role="dialog"`.
  - Two panes, stacked: header (title + close X), list (scrollable), footer (`Mark all read` + `Close`).
  - On row click: swap to detail view in same modal (list stays in state); back arrow returns.
  - List fetched from `/api/notifications/announcements?scope=visible` on mount; detail body is already in payload (cheap inline).
  - Mark-read: POST to `/api/notifications/[id]/read` (exists). Optimistic UI: dot clears immediately.
- Visibility: `announcements.audience` filter respects Plan 7 rules + `deleted_at IS NULL`.

### 3.4 Permission + role model

No new permissions for Plan 40. Reuses:
- `announcements.read` (public)
- `users.edit.any` (admin)
- Self-access enforced in `server/profile/read.ts` — not via DB RLS (row is already gated by `users_self_select` + `users_public_safe_select` policies).

---

## 4. Data model changes

None required for Plan 40. All fields already exist on `users` / `players` / `user_roles` / `announcements` / `notifications`.

One future-looking scaffold: plan for a `user_avatars` storage bucket in Plan 41 to replace the initials fallback for non-player users.

---

## 5. API surfaces

| Method | Route                                 | Purpose                                                    |
|--------|---------------------------------------|------------------------------------------------------------|
| GET    | `/api/notifications/unread-count`     | Existing. Returns `{ count: number }`.                     |
| GET    | `/api/notifications/announcements`    | **New.** Returns `{ rows: Announcement[] }` scoped to user. |
| POST   | `/api/notifications/[id]/read`        | Existing. Marks single notification read.                   |
| POST   | `/api/notifications/read-all`         | **New.** Marks all visible announcements read.              |

Server actions:
- `updateOwnProfileAction(formData)` — updates display_name, bio, photo_url for caller.
- `updateOtherProfileAction(userId, formData)` — same, gated on `users.edit.any`.

---

## 6. UI details

- UserBadge styles match existing `admin/AdminSubnav` chip idiom (pill with role name).
- Role-chip colours: admin `--signal-green`, loc/idc `--pink`, referee `--amber`, player `--chalk-2`, viewer `--chalk-4`. Fallback: `--chalk-3`.
- Modal max-width: 640 px; on mobile: full-screen sheet.
- `body_md` rendering: reuse existing `marked` + `DOMPurify` pipeline from `announcements/[id]/page.tsx`.

---

## 7. Accessibility

- UserBadge dropdown: native `<details>` gives free keyboard.
- Modal: focus trap + restore focus to bell on close + labelled by `<h2 id="announcements-title">`.
- Unread dot: `aria-label="{count} unread announcements"`.

---

## 8. Testing

### Unit (vitest)
- `server/profile/read.test.ts` — self-view, admin-cross-view, non-admin-stranger → PermissionDenied.
- `components/public/UserBadge.test.tsx` — RTL: authenticated renders name + chip; unauthenticated renders "Sign in".
- `server/notifications/announcements.test.ts` (if not already present) — audience filter, soft-delete filter.

### E2E (Playwright)
- `profile-and-identity.spec.ts`:
  1. Login as `admin@cade.local` → see badge with "Admin" chip.
  2. Click badge → see dropdown → click Profile → URL `/profile`.
  3. Edit bio, save → page revalidates with new bio.
  4. Login as `faruk@cade.local` → visit `/profile/<adminUserId>` → expect 403.
- `announcement-modal.spec.ts`:
  1. Login as admin → create announcement via admin UI.
  2. Login as player → bell shows dot.
  3. Click bell → modal opens with list.
  4. Click announcement → detail renders.
  5. Click "Mark as read" → dot disappears.
  6. Press ESC → modal closes.

---

## 9. Rollout + risks

- `SiteChrome` is loaded on every non-overlay route, so any UserBadge error takes the whole app down. Wrap the server-side fetch in `try/catch` returning the unauthenticated fallback on error.
- Bell polling every 60 s is fine on current traffic; revisit when >100 concurrent users.
- Photo upload via existing helper keeps RLS posture intact.

---

## 10. Acceptance gate

Plan 40 is done when:
- `npm run test` + `npm run lint` + `npm run build` clean.
- 2 new E2E specs pass.
- Manual smoke: login as admin + player + loc, see correct chip each time.
- Bell modal ships: click → open → list → detail → mark-read → close. ESC works.
- No regression to Plan 7 announcement detail page (it remains accessible for direct-linked admin use, just no longer the primary surface).
