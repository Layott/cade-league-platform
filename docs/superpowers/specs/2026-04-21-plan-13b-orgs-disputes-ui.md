# Plan 13B — Phase 2: UI + E2E for orgs + contracts + disputes + appeals + content + preseason

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Parent spec:** `docs/superpowers/specs/2026-04-21-plan-13-orgs-disputes-content.md`
**Status:** Draft. Plan 13A (tasks 1–16 of parent) SHIPPED — server modules + migrations live in cloud. This plan covers parent tasks 17–28: every admin page, every player page, the four private storage buckets, the three required E2E specs. No gateway integration. Manual ledger only.

> **Rule of engagement.** Everything here consumes the shipped server modules in `apps/web/src/server/{orgs,disputes,appeals,content,preseason}/`. UI never touches the DB directly; server actions delegate to those modules. `requirePermAsync` double-gates every page + every action. Admin primitives (`AdminShell`, `AdminSubnav`, `SectionHeader`, `DataTable`, `StatusPill`, `FormField`, `inputClass`, `selectClass`, `textareaClass`, `PrimaryButton`, `SecondaryButton`, `DangerButton`) are the ONLY way we render admin surface.

---

## 1. Goal + Success Criteria

Ship the UI + E2E layer so the four Plan 13 acceptance scenarios are demoable end-to-end from a browser.

### Demoable scenarios (inherited from parent §1)

| # | Scenario | UI demo path |
|---|----------|----|
| A | Admin creates `Lagos Crown Esports` + CAC cert + 2 linked players + 50,000-coin deposit + 5,000-coin fine → balance=45,000, ledger append-only, no Edit/Delete UI | `/admin/orgs/new` → `/admin/orgs/[id]` → `/admin/orgs/[id]/ledger/new` (×2) |
| B | Player submits appeal against case issued Fri 2026-05-01 → admin sees deadline Fri 2026-05-08 23:59 WAT with red badge within 24 h, amber within 72 h → admin assigns panel → rules → status flips to `ruled` | `/player/appeals/new?caseId=…` → `/admin/appeals` → `/admin/appeals/[id]` |
| C | Player submits 2 IG posts + 1 Twitter post for week 2026-05-04. Obligation card on `/player/content` flips `Met` once moderator verifies 2 platforms; flips `Unmet` after 1 rejection | `/player/content` → `/admin/content` |
| D | Admin schedules 2026-04-28 preseason shoot, marks 11/13 attended → 2 absent rows auto-warn via Rule 2.5 | `/admin/preseason/new` → `/admin/preseason/[id]` (attendance grid) |

A–C run as Playwright E2E specs. D is covered by the existing Plan 13A unit suite plus a scripted UI smoke; promoting D to E2E is out of scope here (the server module already has idempotent coverage in `preseason/attendance.test.ts`).

### Acceptance gate (definition of "Plan 13B done")

1. `npm run test` — green; ≥15 new unit tests land.
2. `npm run lint` — clean.
3. `npm run build` — clean. All new routes register in the Next.js route manifest.
4. `npm --workspace apps/web run e2e` — green incl. the 3 new specs.
5. `npm run audit:smoke` — green (no change needed; Plan 13A already covers tables).
6. Manual walk-through of A–D against dev Supabase with seed data from Plan 13A.

---

## 2. Architectural constraints recap

Inherited from parent CLAUDE.md + Plan 13 spec:

- **Monolith.** Admin routes live under `apps/web/src/app/admin/*` (existing convention — not a `(admin)` route group; see §4.1). Player routes under `apps/web/src/app/player/*` (introduced in Plan 10).
- **Server actions only.** No client `fetch` to our own API. Every mutation is an RSC/server-action call that delegates to the shipped server module.
- **Permissions.** Double-gate: page reads call `requirePermAsync(sb, actor, '<perm>')` in the page-level Server Component; every server action re-calls `requirePermAsync` before doing work. No page-only gates. No action-only gates. Both.
- **PII storage.** Four new private buckets. Uploads use the signed-upload-URL pattern mirrored from `apps/web/src/app/player/squad/actions.ts` (Plan 10). Reads use short-lived signed URLs (TTL 300 s for admin detail views).
- **Timezone.** Every date/time in WAT via `formatWat()` in `apps/web/src/lib/time.ts`. Input fields accept local date strings; server actions construct `Date` with explicit WAT offset via helpers.
- **Soft-delete.** Every list server module already filters `deleted_at is null`. UI never adds its own filter — we consume whatever the module returns.
- **Audit.** Triggers already attached in Plan 13A. Detail pages display a collapsed audit-trail panel at the bottom by querying `audit_events` via service-role client (same pattern as `/admin/page.tsx` dashboard).
- **No direct SQL.** Pages go through `@/server/...` modules. Zero raw `.from()` calls outside server modules, except for two narrow reads already present in other admin pages (season lookup, user display_name join) — mirror that pattern.

---

## 3. Storage buckets — migration SQL

Create all four buckets in one migration. Buckets are private; read is signed-URL-only; write is service-role. We never set bucket-level RLS on the `storage.objects` table — enforcement lives in the server-action gate (`requirePermAsync`) before minting a signed URL.

```sql
-- 20260505000001_plan13b_storage_buckets.sql
insert into storage.buckets (id, name, public)
values
  ('org-cac-certs',    'org-cac-certs',    false),
  ('org-contracts',    'org-contracts',    false),
  ('dispute-evidence', 'dispute-evidence', false),
  ('appeal-evidence',  'appeal-evidence',  false)
on conflict (id) do nothing;

-- Lock down: no anon read/write; service role only.
-- (Supabase default is deny-all once `public=false`; no explicit policies needed.)
```

Verification:

```bash
npm run db:push
npx supabase db query --execute "select id, public from storage.buckets where id in
  ('org-cac-certs','org-contracts','dispute-evidence','appeal-evidence');"
# expected: 4 rows, public=false
```

### 3.1 File path conventions

| Bucket | Path format |
|---|---|
| `org-cac-certs` | `orgs/{orgId}/cac-cert.{ext}` (one per org; replace overwrites via service role) |
| `org-contracts` | `orgs/{orgId}/contracts/{contractId}.{ext}` |
| `dispute-evidence` | `disputes/{disputeId}/{fileId}.{ext}` |
| `appeal-evidence` | `appeals/{appealId}/{fileId}.{ext}` |

Helpers live in a new `apps/web/src/server/storage/paths.ts`:

```ts
export const buildOrgCacPath = (orgId: string, ext: string) => `orgs/${orgId}/cac-cert.${ext}`;
export const buildOrgContractPath = (orgId: string, contractId: string, ext: string) =>
  `orgs/${orgId}/contracts/${contractId}.${ext}`;
export const buildDisputeEvidencePath = (disputeId: string, fileId: string, ext: string) =>
  `disputes/${disputeId}/${fileId}.${ext}`;
export const buildAppealEvidencePath = (appealId: string, fileId: string, ext: string) =>
  `appeals/${appealId}/${fileId}.${ext}`;
```

### 3.2 Signed URL helpers

A single lib module `apps/web/src/server/storage/signed.ts` exposes:

```ts
export async function createSignedUpload(
  svc: SupabaseClient,
  bucket: 'org-cac-certs' | 'org-contracts' | 'dispute-evidence' | 'appeal-evidence',
  path: string,
): Promise<{ path: string; signedUrl: string; token?: string }>;

export async function createSignedRead(
  svc: SupabaseClient,
  bucket: '...', path: string, ttlSeconds = 300,
): Promise<string>;
```

Both mirror `apps/web/src/server/squads/storage.ts` verbatim — only the bucket union changes. Add `signed.test.ts` with 2 tests (happy path + error surface).

---

## 4. Route tree (absolute paths)

### 4.1 Admin

```
apps/web/src/app/admin/
  layout.tsx                         (existing)
  page.tsx                           (existing)
  orgs/
    page.tsx                         LIST
    new/
      page.tsx                       CREATE FORM
      actions.ts
    [id]/
      page.tsx                       DETAIL (tabbed: Info / Players / Contracts / Ledger)
      actions.ts                     linkPlayer, unlinkPlayer, updateInfo
      ledger/
        page.tsx                     LEDGER LIST (embedded in detail; also stand-alone)
        new/
          page.tsx                   RECORD ENTRY FORM
          actions.ts
      contracts/
        page.tsx                     CONTRACT LIST
        new/
          page.tsx                   UPLOAD + LINK FORM
          actions.ts
  disputes/
    page.tsx                         LIST (status filter)
    [id]/
      page.tsx                       DETAIL + assign + rule
      actions.ts
  appeals/
    page.tsx                         LIST (deadline badge)
    [id]/
      page.tsx                       DETAIL + panel editor + rule
      actions.ts
  content/
    page.tsx                         VERIFICATION QUEUE
    actions.ts                       verify / reject
    sessions/
      [matchDayId]/
        page.tsx                     SESSION ATTENDANCE GRID
        actions.ts
  preseason/
    page.tsx                         SHOOT LIST
    new/
      page.tsx                       SCHEDULE FORM
      actions.ts
    [id]/
      page.tsx                       ATTENDANCE GRID
      actions.ts
```

### 4.2 Player

```
apps/web/src/app/player/
  layout.tsx                         (existing Plan 10 — minimal eyebrow)
  PlayerSubnav.tsx                   NEW — see §6
  squad/                             (existing Plan 10)
  disputes/
    page.tsx                         MY DISPUTES
    new/
      page.tsx                       SUBMIT FORM
      actions.ts
  appeals/
    page.tsx                         MY APPEALS (deadline countdown)
    new/
      page.tsx                       SUBMIT FORM — requires ?caseId
      actions.ts
  content/
    page.tsx                         SUBMIT POST + WEEK STATUS CARD
    actions.ts
  profile/
    page.tsx                         LIGHT PROFILE READ-ONLY (stub; new — scope is just to make subnav land somewhere)
```

`player/layout.tsx` renders `<PlayerSubnav />` between the eyebrow and the children.

### 4.3 Admin subnav extension

Edit `apps/web/src/components/admin/AdminSubnav.tsx`. Insert five tabs after `Squads`, in this order, preserving the existing order:

```ts
{ href: "/admin/orgs",       label: "Orgs" },
{ href: "/admin/disputes",   label: "Disputes" },
{ href: "/admin/appeals",    label: "Appeals" },
{ href: "/admin/content",    label: "Content" },
{ href: "/admin/preseason",  label: "Preseason" },
```

Per-tab visibility is gated by the viewer's perms. Because `AdminSubnav` is a Client Component and can't call `requirePermAsync`, we pre-resolve visibility in the parent layout and pass a `visibleTabs: string[]` prop. Touch `AdminLayout` (`apps/web/src/app/admin/layout.tsx`) to compute visibility once per request:

```ts
const canSee = await Promise.all([
  hasPermAsync(sb, actor, 'orgs.read'),
  hasPermAsync(sb, actor, 'disputes.read'),
  hasPermAsync(sb, actor, 'appeals.read'),
  hasPermAsync(sb, actor, 'content.verify'),
  hasPermAsync(sb, actor, 'preseason.manage'),
]);
```

Inject into `<AdminSubnav visibleTabs={[...]} />`. Default admin sees everything via wildcard.

---

## 5. Per-page layout spec

Every page follows the same skeleton: `SectionHeader` at top, body content in `DataTable`/form cards, optional audit-trail panel at the bottom for detail pages. Inputs use `FormField` + `inputClass`/`selectClass`/`textareaClass`. Buttons use `PrimaryButton`/`SecondaryButton`/`DangerButton`. Status chips use `StatusPill`.

### 5.1 Organizations (admin)

#### `/admin/orgs` — list

Gate: `orgs.read`.
Data: `listOrgs(sb)` → enrich each row with linked-player count via one batched query (`select organization_id, count(*) from players where organization_id in (…) group by organization_id`).
Columns: Name (link to detail) · CAC# (mono) · Status (`StatusPill`) · Balance (`tabular` + `fmtCoins(balance)`) · Linked players (count) · Updated (WAT).
Action: header `PrimaryButton` → `/admin/orgs/new`.

#### `/admin/orgs/new` — create

Gate: `orgs.edit`.
Fields: Name (text, required) · CAC number (text, optional, unique) · Contact rep (select of users) · CAC cert upload (file: pdf/png/jpg). Upload happens client-side to signed URL BEFORE form submit (mirror `/player/squad/SubmitForm.tsx`). Server action receives the already-uploaded `cacCertPath`.
Server action: `createOrgAction(formData)`:

```ts
"use server";
export async function createOrgAction(formData: FormData) {
  const sb = await getServerSupabase();
  const actor = await getActorFromSession(sb);
  await requirePermAsync(sb, actor, 'orgs.edit');
  const parsed = createOrgSchema.parse({
    name: formData.get('name'),
    cacNumber: formData.get('cacNumber') || undefined,
    cacCertUrl: formData.get('cacCertPath') || undefined,
    contactRepUserId: formData.get('contactRepUserId') || undefined,
  });
  const row = await createOrg(sb, parsed);
  redirect(`/admin/orgs/${row.id}`);
}
```

#### `/admin/orgs/[id]` — detail (tabbed)

Gate: `orgs.read`.
Layout: `SectionHeader` with org name + status pill + action bar (Edit / Suspend / Dissolve as `SecondaryButton`/`DangerButton`). Four panels stacked as sections (no client tabs — we use anchor sections for simplicity and E2E stability):

1. **Info** — name, CAC number, CAC cert download (signed URL button), contact rep, status, created_at.
2. **Players** — `DataTable` of players with `organization_id = id`; row actions: `Unlink` (server action). Footer: "Link a player" form (select from unlinked roster + submit → `linkPlayerAction`).
3. **Contracts** — `DataTable` of `listContractsForOrg(sb, id)`. Columns: Player · Season · Status · Valid window · Download. Header link → `/admin/orgs/[id]/contracts/new`.
4. **Ledger** — `DataTable` of `listEntries(sb, id, { limit: 50 })`. Columns: Entered at (WAT) · Type (`StatusPill`) · Direction · Amount · Balance after · Reference · Entered by. Header link → `/admin/orgs/[id]/ledger/new`. Append-only copy in card footer: "Ledger entries are permanent. Use an `adjustment` entry to correct a mistake."

Below the four panels: collapsed `<details>` with last 20 `audit_events` rows for this org (service-role read).

#### `/admin/orgs/[id]/ledger/new` — record entry

Gate: `orgs.ledger.write`.
Layout: SectionHeader `Record ledger entry`. Prominent "Previous balance" card at top — big mono number, chalk-1 on ink-2. Form:

| Field | Widget |
|---|---|
| Entry type | `select`: deposit, topup, fine_deduction, adjustment |
| Direction | auto-derived: deposit/topup=credit, fine_deduction=debit; adjustment exposes explicit `direction` select |
| Amount (coins) | `input type="number" min="1"` |
| Reference | `textarea` rows=2 |

Server action: `recordLedgerEntryAction` → `recordEntry(sb, {...})`. Redirects back to `/admin/orgs/[id]#ledger`.

#### `/admin/orgs/[id]/contracts/new` — upload + link

Gate: `orgs.edit`.
Fields: Player (select of org-linked players) · Season (select of active/available seasons) · Valid from / until (date) · Status (select: draft/active) · Contract file (pdf/png/jpg; signed-upload).
Submit → `createContractAction` calling `createContract(sb, {...})` then `activateContract` if status=active. Redirect to `/admin/orgs/[id]#contracts`.

### 5.2 Disputes (admin + player)

#### `/admin/disputes` — list

Gate: `disputes.read`.
Data: `list(sb, { status: sp.status })`.
Filter form: status select (`all`, `submitted`, `under_review`, `resolved`, `withdrawn`) + submit button — mirrors `/admin/squads/page.tsx` filter form.
Columns: Opened (WAT) · Raiser (display_name) · Subject type · Status · Assigned to · Actions (Review).

#### `/admin/disputes/[id]` — detail

Gate: `disputes.read`.
Layout:
- SectionHeader: title = `Dispute <short id>`, eyebrow = subject type.
- Info card: raiser, subject reference (link if `subject_id` resolves), opened_at, description (whitespace-preserved), evidence URLs (each → signed read through service-role).
- Assign card: user picker (admin users) + `PrimaryButton` — `assignDisputeAction`.
- Rule card: ruling textarea + `PrimaryButton Rule` + status-pill preview — `ruleDisputeAction`. Disabled when `status === 'resolved'`.
- Timeline: opened / assigned / resolved audit trail from `audit_events`.

#### `/player/disputes/new` — submit

Gate: `disputes.submit`.
Fields: Subject type (select: match/sanction/registration/other) · Subject ID (optional text — shown only when subject type ≠ other; help text: "Match ID or sanction action ID") · Description (textarea, min 20 chars) · Evidence uploads (up to 3 files → `dispute-evidence` bucket, signed upload, paths collected in hidden `evidenceUrls[]`).
Server action: `submitDisputeAction(formData)` → `disputes.submit(...)` with `raisedByUserId = actor.userId`. Redirect to `/player/disputes`.

#### `/player/disputes` — list own

Gate: `disputes.read.own`.
Data: `listForUser(sb, actor.userId)`.
Columns: Opened · Subject type · Status · Ruling preview (`truncate-2`).

### 5.3 Appeals (admin + player)

#### `/admin/appeals` — list

Gate: `appeals.read`.
Data: `list(sb, { status })` joined with `disciplinary_cases` via one `in(…)` call to fetch case summaries.
Columns: Submitted · Case # (link) · Submitter · Deadline (WAT) · Deadline badge · Status · Panel size · Actions.

**Deadline badge rules** (render in a `DeadlineBadge` client component inside `apps/web/src/components/admin/DeadlineBadge.tsx`):

- `now >= deadline` or `status === 'expired'` → red pill `EXPIRED`.
- `deadline - now < 24h` → red pill `<24h`.
- `deadline - now < 72h` → amber pill `<72h`.
- else → chalk-2 mono text countdown (`NdHh`).

Countdown text is computed on the server for the initial render; the component re-ticks every 30 s client-side (`useEffect setInterval`). Match Plan 12's `formatWat` convention.

#### `/admin/appeals/[id]` — detail + panel

Gate: `appeals.read`; `appeals.rule` required for panel editor + ruling actions.
Layout:
- Header: appeal id, deadline badge, status pill.
- Case card: links to linked `disciplinary_case` + its actions. Read-only summary of case facts.
- Appellant card: submitter display_name, grounds (pre-wrapped), evidence URLs (signed reads).
- Panel editor (server action `assignPanelAction`): 3 stacked user-picker selects (values filtered to users with `admin` or `idc` role — fetch via `listUsersWithRoles()` in `server/roles/users.ts`). Save button disabled unless all 3 selected + no duplicates. Soft-deleted panel members render `[unknown user]` (spec §11 Risk 6) — do not break the UI.
- Ruling card: ruling textarea + `Rule` `PrimaryButton`. Disabled if `status in ('ruled','withdrawn','expired')`. Show "Deadline has passed — ruling will be tagged [LATE RULING]" warning when `now > deadline`.
- Audit trail at bottom.

#### `/player/appeals/new?caseId=…` — submit

Gate: `appeals.submit`.
Requires query param `caseId`. Lookup `disciplinary_case` server-side; if missing or not linked to this player → 404.
Fields: Grounds (textarea, min 40 chars) · Evidence uploads (→ `appeal-evidence`).
Server action: `submitAppealAction` → `appeals.submit({ disciplinaryCaseId, submittedByUserId, grounds, evidenceUrls })`.

#### `/player/appeals` — list own

Gate: `appeals.read.own`.
Columns: Submitted · Case # · Status · Deadline countdown (uses same `DeadlineBadge` component).

### 5.4 Content (player + moderator)

#### `/player/content` — submit + own status

Gate: `content.submit` + `content.read.own`.
Layout:
- "This week's obligation" card at top: week anchor (Monday), platforms submitted, platforms verified, big `met=true/false` chip.
- Submit form: week picker (defaults to `currentWeekStart()`; locked to current week + previous 2 weeks) · platform (select twitter/instagram/tiktok/youtube) · post URL (text, required, validated to start with `https://`) · submit.
- "My posts this week" `DataTable`: URL · Platform · Verification status · Rejection reason.

Data: `getStatusForPlayerWeek(sb, playerId, weekStart)` + `listForPlayerWeek(sb, playerId, weekStart)`.

#### `/admin/content` — verification queue

Gate: `content.verify`.
Data: `listPending(sb, { limit: 100 })`.
Columns: Submitted · Player · Week · Platform · URL (link, new tab) · Actions (Verify as `PrimaryButton`, Reject as `DangerButton`). Reject expands a modal-less inline form with `reason` textarea (min 10 chars).

#### `/admin/content/sessions/[matchDayId]` — session grid

Gate: `content.verify`.
Data: `content.listByMatchDay(sb, matchDayId)` returns one row per player seeded by match-day lineup.
Grid: one row per player; columns: Attended (checkbox) · Makeup scheduled_at (datetime-local, optional) · Makeup attended (checkbox, disabled until makeup scheduled) · Notes.
Save button → `markAttendanceAction` + `scheduleMakeupAction` + `markMakeupAttendanceAction`. Batch-iterated in one server action to reduce round-trips; on any per-row failure, surface per-row error above the grid without rolling back other saves (makes it partially-idempotent, acceptable for admin-only).

### 5.5 Preseason (admin)

#### `/admin/preseason` — list

Gate: `preseason.manage`.
Data: `listShoots(sb, seasonId)` (pass the active season).
Columns: Date · Type (`StatusPill`) · Location · Status · Attendance (rendered as "11/13") · Actions.
Header `PrimaryButton` → `/admin/preseason/new`.

#### `/admin/preseason/new`

Fields: shoot_date (date) · type (select) · location (text) · status (default `scheduled`).
Server action → `createShoot(sb, …)` then redirect to `/admin/preseason/[id]`.

#### `/admin/preseason/[id]` — attendance grid

Gate: `preseason.manage`.
Data: `getShootById` + roster from `players` where season matches. Pre-seed `preseason_shoot_attendance` rows via `listAttendanceForShoot`; if a player has no row yet, render a shim row and create it on save.
Grid: player · checkbox `Attended` · notes (text) · warning badge (if `warning_issued_bool=true`, show amber pill `Auto-warned`). Save button → server action iterates `markAttendance(sb, { shootId, playerId, attended, notes })` for each row. Warning issuance is idempotent in the server module (already asserted in `preseason/attendance.test.ts`), so re-saves don't double-warn. Display a summary toast-equivalent (inline banner): `N attended, M absent, K new warnings issued`.

---

## 6. Player subnav design

New file `apps/web/src/app/player/PlayerSubnav.tsx`. Client component. Mirrors `AdminSubnav` structure and tokens but lighter: no `ink-1/80` background — lives on the shell's default background, hairline top border, hairline bottom border, 10 px uppercase tracking.

```ts
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/player/squad", label: "Squad" },
  { href: "/player/disputes", label: "Disputes" },
  { href: "/player/appeals", label: "Appeals" },
  { href: "/player/content", label: "Content" },
  { href: "/player/profile", label: "Profile" },
];

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function PlayerSubnav() {
  const pathname = usePathname() ?? "/player/squad";
  return (
    <nav
      aria-label="Player sections"
      className="mb-6 flex flex-wrap items-center gap-1 border-b border-[var(--ink-4)] pt-1"
      data-testid="player-subnav"
    >
      {TABS.map((tab) => {
        const active = matches(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              "relative px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
              (active
                ? "text-[var(--chalk-0)]"
                : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
            }
          >
            {tab.label}
            <span
              aria-hidden
              className={
                "pointer-events-none absolute inset-x-3 -bottom-[1px] h-[2px] transition-all " +
                (active ? "bg-[var(--signal)]" : "bg-transparent")
              }
            />
          </Link>
        );
      })}
    </nav>
  );
}
```

Edit `apps/web/src/app/player/layout.tsx` to render `<PlayerSubnav />` below the eyebrow and above `{children}`.

No per-tab permission gating on the player subnav — all five tabs are reachable by every `player` role holder (Plan 13A seeded `disputes.*`, `appeals.*`, `content.*` on the `player` role). If a player clicks into a page for a feature they lack perm for, the page-level `requirePermAsync` denies with 403.

---

## 7. Storage signed-URL flow

### 7.1 Write (upload)

Mirror `/player/squad` flow exactly. Client component renders a `<input type="file">`. On change:

1. Client calls server action `requestUploadUrlAction({ bucket, extension })`.
2. Server action: validates perm, constructs path via helper, calls `createSignedUpload(svc, bucket, path)` (service-role client), returns `{ path, signedUrl, token? }`.
3. Client uploads via `fetch(signedUrl, { method: 'PUT', body: file })`.
4. On success, client stores `path` in a hidden input and submits the surrounding form. Server action reads `path` from `formData` and passes to the server module.

Helper component `apps/web/src/components/shared/SignedFileInput.tsx`:

```tsx
"use client";
// Props: bucket, fieldName (hidden input), accept, onUploaded.
// Emits: hidden <input name={fieldName} value={uploadedPath}>.
// Renders disabled state during upload. Error state for network failures.
```

Used by:
- `/admin/orgs/new` (bucket=`org-cac-certs`, fieldName=`cacCertPath`)
- `/admin/orgs/[id]/contracts/new` (bucket=`org-contracts`, fieldName=`contractPath`)
- `/player/disputes/new` (bucket=`dispute-evidence`, allows ≤3 files)
- `/player/appeals/new` (bucket=`appeal-evidence`, allows ≤3 files)

### 7.2 Read (signed URL)

Detail pages that need to render a private asset:

1. Server component fetches row.
2. Calls `createSignedRead(svc, bucket, path, 300)` using service-role client (sidesteps RLS; safe because we already `requirePermAsync` on the page).
3. Renders `<a href={signedUrl} target="_blank" rel="noopener">Download</a>` or `<img src={signedUrl}>` for image files.

Fallback: when signing fails, render `Asset unavailable` chalk-3 message. Never 500 the whole page on asset lookup failure.

### 7.3 Permission matrix

| Bucket | Writes | Reads |
|---|---|---|
| `org-cac-certs` | `orgs.edit` | admins only via `/admin/orgs/[id]` |
| `org-contracts` | `orgs.edit` | admins + the linked player's team manager (check `contracts.team_manager_id` in future; Phase 1 just admin) |
| `dispute-evidence` | `disputes.submit` (raiser only) | raiser + `disputes.read` holders |
| `appeal-evidence` | `appeals.submit` (submitter only) | submitter + `appeals.read` holders + panel members (check `panel_member_user_ids` contains actor.userId) |

Panel-member read check is a page-level guard in `/player/appeals/[id]` (no page spec'd above — defer to Plan 13C if this becomes a real need; in Plan 13B, panel members view the appeal from `/admin/appeals/[id]` since every IDC user also holds `appeals.read`).

---

## 8. Server-action contracts

One `actions.ts` file per admin route folder. Naming: `<verb><Noun>Action`. Every action:

1. `"use server"` header.
2. `const sb = await getServerSupabase()`.
3. `const actor = await getActorFromSession(sb)`.
4. `await requirePermAsync(sb, actor, '<perm>')`.
5. Parse inputs with the action's local Zod schema (NOT the server module's schema — the action coerces `FormData` → shape).
6. Call the server module function.
7. `revalidatePath('...')` for every surface that displays the mutated row.
8. `redirect('...')` when appropriate.

### 8.1 Action registry (full list, 24 actions)

| Route | Action | Perm |
|---|---|---|
| admin/orgs/new | `createOrgAction` | `orgs.edit` |
| admin/orgs/[id] | `updateOrgAction` | `orgs.edit` |
| admin/orgs/[id] | `softDeleteOrgAction` | `orgs.edit` |
| admin/orgs/[id] | `linkPlayerAction` | `orgs.edit` |
| admin/orgs/[id] | `unlinkPlayerAction` | `orgs.edit` |
| admin/orgs/[id]/ledger/new | `recordLedgerEntryAction` | `orgs.ledger.write` |
| admin/orgs/[id]/contracts/new | `createContractAction` | `orgs.edit` |
| admin/orgs/[id]/contracts | `activateContractAction` | `orgs.edit` |
| admin/orgs/[id]/contracts | `terminateContractAction` | `orgs.edit` |
| admin/disputes/[id] | `assignDisputeAction` | `disputes.rule` |
| admin/disputes/[id] | `ruleDisputeAction` | `disputes.rule` |
| player/disputes/new | `submitDisputeAction` | `disputes.submit` |
| player/disputes/[id] (future) | `withdrawDisputeAction` | `disputes.submit` |
| admin/appeals/[id] | `assignPanelAction` | `appeals.rule` |
| admin/appeals/[id] | `ruleAppealAction` | `appeals.rule` |
| player/appeals/new | `submitAppealAction` | `appeals.submit` |
| admin/content | `verifyPostAction` | `content.verify` |
| admin/content | `rejectPostAction` | `content.verify` |
| admin/content/sessions/[id] | `saveSessionsAction` | `content.verify` |
| player/content | `submitPostAction` | `content.submit` |
| admin/preseason/new | `createShootAction` | `preseason.manage` |
| admin/preseason/[id] | `saveAttendanceAction` | `preseason.manage` |
| admin/preseason/[id] | `cancelShootAction` | `preseason.manage` |
| admin/preseason/[id] | `completeShootAction` | `preseason.manage` |

Every action file colocates a Zod schema for the `FormData` shape (→ spec §10 tests).

---

## 9. Audit-trail rendering

Every detail page (`/admin/orgs/[id]`, `/admin/disputes/[id]`, `/admin/appeals/[id]`) appends a `<AuditTrail entityType="..." entityId="..." limit={20} />` component at the bottom. Component source lives at `apps/web/src/components/admin/AuditTrail.tsx` (new):

```tsx
export async function AuditTrail({ entityType, entityId, limit = 20 }: Props) {
  const svc = getServiceRoleSupabase();
  const { data } = await svc.from("audit_events")
    .select("id, action, created_at, actor_user_id, diff")
    .eq("entity_type", entityType).eq("entity_id", entityId)
    .order("created_at", { ascending: false }).limit(limit);
  // Render as <details><summary>Audit trail (N)</summary><DataTable .../></details>
}
```

Uses the existing dashboard pattern (see `/admin/page.tsx` for the service-role audit read). Collapsed by default.

---

## 10. Tests

### 10.1 Unit — ≥15 new

Each server action has a local Zod schema that coerces `FormData` → typed input. Unit tests cover schema rejection + happy path, NOT the underlying server module (already covered in Plan 13A).

| # | File | Test |
|---|---|---|
| 1 | `app/admin/orgs/new/actions.test.ts` | `createOrgSchema` rejects empty name |
| 2 | `app/admin/orgs/new/actions.test.ts` | accepts valid FormData + optional fields |
| 3 | `app/admin/orgs/[id]/ledger/new/actions.test.ts` | `recordLedgerEntrySchema` rejects amount=0 |
| 4 | `app/admin/orgs/[id]/ledger/new/actions.test.ts` | rejects `adjustment` without explicit direction |
| 5 | `app/admin/orgs/[id]/contracts/new/actions.test.ts` | validates date range (valid_until >= valid_from) |
| 6 | `app/admin/disputes/[id]/actions.test.ts` | `ruleDisputeSchema` requires non-empty ruling text |
| 7 | `app/admin/appeals/[id]/actions.test.ts` | `assignPanelSchema` rejects duplicate user IDs |
| 8 | `app/admin/appeals/[id]/actions.test.ts` | rejects panel with fewer than 3 members |
| 9 | `app/player/appeals/new/actions.test.ts` | requires `caseId` query param |
| 10 | `app/player/appeals/new/actions.test.ts` | grounds <40 chars rejected |
| 11 | `app/player/disputes/new/actions.test.ts` | description <20 chars rejected |
| 12 | `app/player/content/actions.test.ts` | URL must start with `https://` |
| 13 | `app/admin/content/actions.test.ts` | `rejectPostSchema` requires reason ≥10 chars |
| 14 | `app/admin/preseason/[id]/actions.test.ts` | `saveAttendanceSchema` validates uuid array |
| 15 | `components/admin/DeadlineBadge.test.tsx` | badge tone: expired / <24h / <72h / far |
| 16 | `components/admin/DeadlineBadge.test.tsx` | countdown string format `NdHh` |
| 17 | `server/storage/signed.test.ts` | `createSignedUpload` happy path |
| 18 | `server/storage/signed.test.ts` | surfaces Supabase error |

All action tests mock `getServerSupabase`, `requirePermAsync`, and the underlying server module via `vi.mock`. Use `vi.hoisted` per the lessons.md entry on mock hoisting. Round-trip the Zod parse; assert the server module mock is called with the right shape.

### 10.2 E2E — 3 specs

`apps/web/tests/e2e/orgs-manual-ledger.spec.ts` (scenario A):

1. Admin login.
2. Navigate to `/admin/orgs/new`. Fill name=`Lagos Crown Esports E2E`, CAC=random 7 digits. Upload tiny PDF fixture (`tests/fixtures/tiny-cac.pdf` base64-decoded) via signed URL.
3. Submit → lands on `/admin/orgs/[id]`.
4. Assert info panel shows name + CAC + status pill.
5. Link two existing seeded players via the Players panel's link form.
6. Click "Record ledger entry". Record `deposit 50000` with reference "initial caution fee".
7. Back on detail page, assert Ledger panel first row: `50,000 · balance=50000`.
8. Record second entry `fine_deduction 5000 reference "forfeit sanction"`.
9. Assert balance now `45,000`, two rows present, both `data-testid="ledger-row-*"`.
10. Assert no `Edit`/`Delete` button appears on any ledger row (query `role=button` name=Edit inside the Ledger panel should time out).
11. Clean up: admin clicks Suspend on info card (soft-delete via `softDeleteOrgAction`) — leaves the row hidden from lists.

`apps/web/tests/e2e/appeal-submit-and-rule.spec.ts` (scenario B):

1. Seed a disciplinary_case via server fixture (or test helper hitting `/api/test/seed-case`) dated 2026-05-01 for a known player.
2. Player login (use `e2e-player@cade.local`).
3. Navigate `/player/appeals/new?caseId=<id>`. Fill grounds (60+ chars). Submit.
4. Land on `/player/appeals`. Assert the appeal appears with deadline "Fri 2026-05-08 23:59 WAT".
5. Switch to admin session. Go `/admin/appeals`. Assert the appeal row's deadline badge text matches expected (chalk-2 mono if >72 h out).
6. Open detail. Assign 3 panel members (from seeded admin + 2 moderators). Save. Assert status flips to `under_review`.
7. Enter ruling "Uphold the original case, evidence insufficient." Submit. Assert status=`ruled`, `ruled_at` now.
8. Reload `/player/appeals`, assert status pill=`ruled`, ruling text visible.

`apps/web/tests/e2e/content-obligation-week.spec.ts` (scenario C):

1. Player login.
2. Go `/player/content`. Assert "This week" card shows `Met=false` (0 verified platforms).
3. Submit 2 Instagram posts (same player, 2 different URLs).
4. Submit 1 Twitter post.
5. Obligation card still `Met=false` (verification pending).
6. Switch to moderator session. Go `/admin/content`. Verify 1 IG post + 1 Twitter post.
7. Switch back to player. Reload. Assert `Met=true`.
8. Moderator session: reject the Twitter post with reason "URL does not resolve".
9. Player reload: `Met=false`. Rejection reason visible in own-posts table.

**E2E conventions** (inherited from Plan 10):

- Tests serialize (`fullyParallel: false`) to avoid session races.
- Self-cleaning: each test tags rows with `E2E-<timestamp>` in text fields where possible; a `beforeAll` soft-deletes stale rows older than 1 hour.
- Assume seeded accounts: `admin@cade.local`, `moderator@cade.local`, `e2e-player@cade.local` (add to `seed.sql` if missing).

---

## 11. Numbered tasks (22)

1. Migration `20260505000001_plan13b_storage_buckets.sql` — four buckets. Apply + verify `public=false`.
2. `apps/web/src/server/storage/paths.ts` + 4 unit tests (path format).
3. `apps/web/src/server/storage/signed.ts` + `signed.test.ts` (2 tests).
4. Extend `apps/web/src/components/admin/AdminSubnav.tsx` with 5 new tabs + `visibleTabs` prop.
5. Adjust `apps/web/src/app/admin/layout.tsx` to pre-resolve `visibleTabs` via `hasPermAsync`.
6. `apps/web/src/components/admin/DeadlineBadge.tsx` + 4 unit tests.
7. `apps/web/src/components/admin/AuditTrail.tsx` (shared).
8. `apps/web/src/components/shared/SignedFileInput.tsx` (client).
9. `/admin/orgs` list page + header.
10. `/admin/orgs/new` form + `createOrgAction`.
11. `/admin/orgs/[id]` detail (Info + Players + Contracts + Ledger sections) + linkPlayer/unlink actions.
12. `/admin/orgs/[id]/ledger/new` form + `recordLedgerEntryAction`.
13. `/admin/orgs/[id]/contracts/new` + `createContractAction`.
14. `/admin/disputes` list + `/admin/disputes/[id]` detail + assign/rule actions.
15. `/admin/appeals` list with `DeadlineBadge` + `/admin/appeals/[id]` detail + panel + rule.
16. `/admin/content` verification queue + verify/reject actions.
17. `/admin/content/sessions/[matchDayId]` grid + `saveSessionsAction`.
18. `/admin/preseason` list + `/admin/preseason/new` + `/admin/preseason/[id]` grid + save action.
19. Player subnav + `/player/disputes` + `/player/disputes/new` + submit action.
20. `/player/appeals` + `/player/appeals/new` + submit action + countdown.
21. `/player/content` submit form + own-status card.
22. Write 3 E2E specs; add seed rows (dedicated `e2e-player@cade.local` + disciplinary_case fixture if missing); gate-verify test/lint/build/e2e.

Commits slice by theme: (1) storage + shared primitives, (2) admin orgs + ledger + contracts, (3) disputes + appeals admin, (4) content + preseason admin, (5) player routes, (6) E2E + verification.

---

## 12. Acceptance criteria + verification gate

```
npm run test                                    # ≥15 new unit tests, full suite green
npm run lint                                    # clean
npm run build                                   # clean; new routes register
npm --workspace apps/web run e2e                # 3 new specs pass; existing pass
npm run audit:smoke                             # green (no change from Plan 13A)
```

Manual demo:

1. Scenario A: `/admin/orgs/new` → detail → deposit 50,000 → fine 5,000 → balance=45,000, no Edit/Delete UI.
2. Scenario B: player submits appeal → admin sees deadline + badge → assigns panel → rules → status=`ruled`.
3. Scenario C: player submits 3 posts → moderator verifies 2 → met=true → reject 1 → met=false.
4. Scenario D: admin schedules shoot → grid save → 2 absentees auto-warned (idempotent on re-save).

A–C captured in E2E. D covered by Plan 13A unit suite + UI smoke.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CAC cert / contract / evidence URL leaked via unsigned public URL | Medium | High | All four buckets private. Never render `<img src="/storage/...">` — always proxy through `createSignedRead` with 300 s TTL. No test ever calls `getPublicUrl()`. |
| Panel member revoked (soft-delete user) mid-ruling | Low | Medium | Panel editor reads `listUsersWithRoles()` at render; picker only offers active IDC/admin users. Existing appeals tolerate `[unknown user]` via `DataTable` render guard. Server action refuses `assignPanel` if any panel member is currently soft-deleted. |
| Deadline badge drift — client clock skewed → wrong tone | Medium | Low | Server renders initial tone from server `now()`. Client ticks every 30 s off the initial deadline ISO. Skew ≤30 s is acceptable. Add copy on `/player/appeals` "Deadlines are in Africa/Lagos (WAT)". |
| File upload abandoned (signed URL minted, form never submitted) | High | Low | Orphan files accepted. Add a weekly cleanup cron in a later plan. Not blocking. |
| Session-grid partial save (one row fails, rest succeed) | Medium | Low | Banner shows per-row errors; admins re-save. Server module is idempotent so retries are safe. Documented in the UI help copy. |
| Balance drift between `organizations.caution_fee_balance_coins` and sum of ledger rows | Medium | High | Plan 13A server module covers this via `FOR UPDATE`. Plan 13B adds a read-only sanity check: the detail-page Info panel shows "⚠ balance drift" if `organizations.caution_fee_balance_coins !== sum(entries.amount_coins * ±1)`. Never auto-corrects; admins open an `adjustment`. |
| PII in evidence screenshots (phone numbers, IDs) | High | High | EXIF strip still deferred (parent §11). UI copy on the upload widget: "Redact personal info before uploading. Evidence is visible to IDC panel." |
| Permission matrix drift vs parent spec §7 | Low | Medium | `perms.seed.test.ts` already asserts the 13A matrix. Extend with the new action→perm mappings from §8 (16 new assertions). |

---

## 14. Out of scope

- **Automated IG/TikTok/Twitter content verification** — Phase 3.
- **Holiday-aware deadlines** — Plan 14.
- **MFA for IDC / appeal ruling** — Phase 3.
- **OCR for CAC certificates** — never planned.
- **Auto player-to-org team-manager assignment** — manual only.
- **Panel-member view of appeal evidence via dedicated route** — `/admin/appeals/[id]` covers it since every panel member is also IDC/admin.
- **Contract e-signing / DocuSign integration** — never planned.
- **Content submission scheduling / drafts** — submit-then-verify only.
- **Preseason shoot full broadcast tie-in (vMix overlay)** — Plan 12 scope.
- **Ledger CSV export** — future admin-tools plan.
- **Team-manager dashboard** — defer; current plan surfaces contracts to admin only.

---

## 15. Critical files

- `apps/web/src/components/admin/AdminSubnav.tsx` (edit)
- `apps/web/src/app/admin/layout.tsx` (edit — `visibleTabs` prop)
- `apps/web/src/components/admin/DeadlineBadge.tsx` (new)
- `apps/web/src/components/admin/AuditTrail.tsx` (new)
- `apps/web/src/components/shared/SignedFileInput.tsx` (new)
- `apps/web/src/server/storage/paths.ts` (new)
- `apps/web/src/server/storage/signed.ts` (new)
- `apps/web/src/app/admin/orgs/**` (new)
- `apps/web/src/app/admin/disputes/**` (new)
- `apps/web/src/app/admin/appeals/**` (new)
- `apps/web/src/app/admin/content/**` (new)
- `apps/web/src/app/admin/preseason/**` (new)
- `apps/web/src/app/player/PlayerSubnav.tsx` (new)
- `apps/web/src/app/player/layout.tsx` (edit — mount `<PlayerSubnav/>`)
- `apps/web/src/app/player/disputes/**` (new)
- `apps/web/src/app/player/appeals/**` (new)
- `apps/web/src/app/player/content/**` (new)
- `apps/web/src/app/player/profile/page.tsx` (new — stub)
- `apps/web/tests/e2e/orgs-manual-ledger.spec.ts` (new)
- `apps/web/tests/e2e/appeal-submit-and-rule.spec.ts` (new)
- `apps/web/tests/e2e/content-obligation-week.spec.ts` (new)
- `supabase/migrations/20260505000001_plan13b_storage_buckets.sql` (new)
