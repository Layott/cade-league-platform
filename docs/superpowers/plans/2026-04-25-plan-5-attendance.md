# Plan 5 — Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ref-driven attendance marking for Division 1 Elite 2025-2026. Refs and admins mark each player on each match day as Present / Late / Absent. Late and Absent marks auto-open a `disciplinary_case` and a `disciplinary_action` (point deduction) using the Phase 1A flat penalty ladder. Edits require an override reason and revoke/re-apply the linked penalty atomically.

**Architecture:** One `attendance_marks` row per (match_day, player) — server-side upserts. The server module `src/server/attendance/` wraps the mutation path, emits a penalty via Plan 4's `disciplinary_cases` + `disciplinary_actions` tables on late/absent, and links the action id back onto the mark for easy revoke-on-edit. Admin UI at `/admin/match-days/[id]/attendance` renders a table of season participants with per-row status buttons and an Edit dialog that requires a reason. Attendance is internal only — no public page in this plan.

**Tech Stack:** Next.js 15 Server Actions, Supabase (SSR client), Vitest + mocks for unit tests, Playwright for E2E. Audit trigger infrastructure from Plan 0, permissions from Plan 1, `players` + `season_participants` from Plan 2, `match_days` from Plan 3, `disciplinary_cases` + `disciplinary_actions` from Plan 4.

**Prerequisites:**
- Plan 0 complete (audit trigger helper `public.attach_audit()` available).
- Plan 1 complete (auth, `user_roles`, `hasPerm`, middleware gating `/admin/*`).
- Plan 2 complete (`players`, `season_participants` tables seeded).
- Plan 3 complete (`match_days` with `match_start_time`, `arrival_cutoff_time`).
- Plan 4 complete (`disciplinary_cases`, `disciplinary_actions`, `recomputeStandings(seasonId)`).
- Permissions `attendance.mark` and `attendance.edit` already wired in `src/perms.ts` (added in Plan 1 map; verify presence).

**Shippable at end of Plan 5:**
- An admin / moderator can open `/admin/match-days/[id]/attendance` and see a roster of that season's participants.
- Clicking Present / Late / Absent marks the player — row updates with status + timestamp + marked_by.
- Late → auto-opens a disciplinary case with a `point_deduction` action of magnitude 1.
- Absent → same but magnitude 3.
- Edit with reason flips status; if flipping away from late/absent, the auto-action is revoked (revoked_at set, revoke_reason = override_reason). If flipping toward late/absent from present, a fresh case + action is opened.
- Every mark + edit is audit-logged.
- Unit tests cover the markLate / editMark flows; one E2E walks through mark → penalty visible → edit → penalty revoked.

---

## File Structure (delta over Plan 4)

Created by this plan:

```
apps/web/src/
├── app/
│   └── admin/
│       └── match-days/
│           └── [id]/
│               └── attendance/
│                   ├── page.tsx                 # Roster + status buttons + edit dialog
│                   └── actions.ts               # Server Actions for mark + edit + undo
├── server/
│   └── attendance/
│       ├── index.ts                             # Re-exports
│       ├── mark.ts                              # markPresent, markLate, markAbsent
│       ├── mark.test.ts
│       ├── edit.ts                              # editMark
│       ├── edit.test.ts
│       ├── list.ts                              # listByMatchDay
│       ├── penalty.ts                           # flatLadder(), openAutoCase(), revokeAutoAction()
│       └── penalty.test.ts

supabase/migrations/
└── 20260425000001_attendance_marks.sql
```

Modified:
- `apps/web/src/perms.ts` — confirm `attendance.mark` + `attendance.edit` exist under `admin` and `moderator`. Add if missing.

---

## Task 1: Migration — attendance_marks table

**Files:**
- Create: `supabase/migrations/20260425000001_attendance_marks.sql`

- [ ] **Step 1: Write the migration**

Contents:

```sql
-- attendance_marks: one row per player per match day.
-- status tracks Present/Late/Absent; marked_at is wall clock of the mark;
-- scheduled_call_time is captured at mark-time (match_day.match_start_time − arrival_cutoff)
-- so later edits to the match_day don't rewrite history.
-- delta_seconds = marked_at − scheduled_call_time (negative = early).
-- override_reason is required (and set) whenever an existing row is edited.
-- auto_action_id points to the disciplinary_action created for late/absent so
-- editMark can revoke it idempotently without searching.

create table public.attendance_marks (
  id                   uuid primary key default gen_random_uuid(),
  match_day_id         uuid not null references public.match_days (id) on delete cascade,
  player_id            uuid not null references public.players (id) on delete cascade,
  status               text not null check (status in ('present','late','absent')),
  marked_at            timestamptz not null default now(),
  marked_by            uuid not null references public.users (id),
  scheduled_call_time  timestamptz not null,
  delta_seconds        int not null,
  override_reason      text,
  auto_case_id         uuid references public.disciplinary_cases (id),
  auto_action_id       uuid references public.disciplinary_actions (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (match_day_id, player_id)
);

create index attendance_marks_match_day_idx
  on public.attendance_marks (match_day_id)
  where deleted_at is null;

create index attendance_marks_player_idx
  on public.attendance_marks (player_id)
  where deleted_at is null;

create index attendance_marks_status_idx
  on public.attendance_marks (match_day_id, status)
  where deleted_at is null;

select public.attach_audit('public.attendance_marks');
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
```

Expected: `Applying migration 20260425000001_attendance_marks.sql... Finished supabase db push.`

Verify the table + UNIQUE constraint exist:

```bash
npx supabase db query "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='attendance_marks' order by ordinal_position" --linked --output table
npx supabase db query "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.attendance_marks'::regclass" --linked --output table
```

Expected: 13 columns; UNIQUE on `(match_day_id, player_id)`; CHECK on `status`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260425000001_attendance_marks.sql
git commit -m "feat(db): attendance_marks table + audit attached + auto-action link"
```

---

## Task 2: Perms sanity — attendance.mark + attendance.edit

**Files:**
- Modify (if needed): `apps/web/src/perms.ts`
- Modify (if needed): `apps/web/src/perms.test.ts`

Plan 1 should already list `attendance.mark` and `attendance.edit` under `admin` and `moderator`. This task is a belt-and-braces verification.

- [ ] **Step 1: Inspect existing map**

Open `apps/web/src/perms.ts`. Confirm `admin` carries `attendance.*` (or at minimum both `attendance.mark` and `attendance.edit`) and `moderator` lists `attendance.mark` + `attendance.edit`.

- [ ] **Step 2: Add perm tests**

Append to `apps/web/src/perms.test.ts`:

```ts
it("admin has attendance.mark and attendance.edit", () => {
  expect(hasPerm({ userId: "u", roles: ["admin"] }, "attendance.mark")).toBe(true);
  expect(hasPerm({ userId: "u", roles: ["admin"] }, "attendance.edit")).toBe(true);
});

it("moderator has attendance.mark and attendance.edit", () => {
  expect(hasPerm({ userId: "u", roles: ["moderator"] }, "attendance.mark")).toBe(true);
  expect(hasPerm({ userId: "u", roles: ["moderator"] }, "attendance.edit")).toBe(true);
});

it("player does NOT have attendance.mark", () => {
  expect(hasPerm({ userId: "u", roles: ["player"] }, "attendance.mark")).toBe(false);
});

it("viewer does NOT have attendance.edit", () => {
  expect(hasPerm({ userId: null, roles: [] }, "attendance.edit")).toBe(false);
});
```

- [ ] **Step 3: Run tests**

```bash
npm --workspace apps/web run test
```

Expected: 4 new tests pass. If any fail, edit `perms.ts` to include the missing entries, then re-run.

- [ ] **Step 4: Commit (only if file changed)**

```bash
git add apps/web/src/perms.ts apps/web/src/perms.test.ts
git commit -m "test(perms): lock down attendance.mark + attendance.edit matrix"
```

---

## Task 3: Penalty helper (flat ladder + auto-case creation) — TDD

**Files:**
- Create: `apps/web/src/server/attendance/penalty.ts`
- Create: `apps/web/src/server/attendance/penalty.test.ts`

Phase 1A penalty ladder is flat per spec §7:
- `late` → 1 point deduction
- `absent` → 3 point deduction

Rule 5.4's scaled ladder is Phase 1B — DO NOT implement.

- [ ] **Step 1: Failing test `penalty.test.ts`**

Contents:

```ts
import { describe, it, expect, vi } from "vitest";
import { flatLadder, openAutoCase, revokeAutoAction } from "./penalty";

describe("flatLadder", () => {
  it("returns magnitude 1 for late", () => {
    expect(flatLadder("late")).toEqual({ sanction_type: "point_deduction", magnitude: 1 });
  });
  it("returns magnitude 3 for absent", () => {
    expect(flatLadder("absent")).toEqual({ sanction_type: "point_deduction", magnitude: 3 });
  });
  it("returns null for present", () => {
    expect(flatLadder("present")).toBeNull();
  });
});

describe("openAutoCase", () => {
  function mkSb() {
    const insertedCase = vi.fn().mockResolvedValue({
      data: { id: "case-1" },
      error: null,
    });
    const insertedAction = vi.fn().mockResolvedValue({
      data: { id: "action-1" },
      error: null,
    });

    return {
      insertedCase,
      insertedAction,
      from: vi.fn((table: string) => {
        if (table === "disciplinary_cases") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: insertedCase,
              })),
            })),
          };
        }
        if (table === "disciplinary_actions") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: insertedAction,
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
  }

  it("creates case + action for late", async () => {
    const sb = mkSb();
    const out = await openAutoCase(sb as never, {
      playerId: "p-1",
      status: "late",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(out).toEqual({ caseId: "case-1", actionId: "action-1" });
    expect(sb.from).toHaveBeenCalledWith("disciplinary_cases");
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
  });

  it("creates case + action for absent", async () => {
    const sb = mkSb();
    await openAutoCase(sb as never, {
      playerId: "p-1",
      status: "absent",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
  });

  it("returns null for present", async () => {
    const sb = mkSb();
    const out = await openAutoCase(sb as never, {
      playerId: "p-1",
      status: "present",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(out).toBeNull();
    expect(sb.from).not.toHaveBeenCalled();
  });
});

describe("revokeAutoAction", () => {
  it("sets revoked_at + revoke_reason on the given action id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const sb = { from: vi.fn(() => ({ update })) };

    await revokeAutoAction(sb as never, {
      actionId: "action-1",
      reason: "attendance edit",
    });

    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: expect.any(String),
        revoke_reason: "attendance edit",
      })
    );
    expect(eq).toHaveBeenCalledWith("id", "action-1");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `penalty.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type AttendanceStatus = "present" | "late" | "absent";

export type LadderEntry = { sanction_type: "point_deduction"; magnitude: number };

/**
 * Phase 1A flat late-arrival ladder (spec §7):
 *   late   → 1 point deduction
 *   absent → 3 point deduction
 * Rule 5.4's scaled ladder is deferred to Phase 1B.
 */
export function flatLadder(status: AttendanceStatus): LadderEntry | null {
  if (status === "late") return { sanction_type: "point_deduction", magnitude: 1 };
  if (status === "absent") return { sanction_type: "point_deduction", magnitude: 3 };
  return null;
}

export type OpenAutoCaseInput = {
  playerId: string;
  status: AttendanceStatus;
  matchDayId: string;
  actorUserId: string;
  effectiveDate: string; // ISO date (YYYY-MM-DD)
};

export type OpenAutoCaseResult = { caseId: string; actionId: string } | null;

export async function openAutoCase(
  sb: SupabaseClient,
  input: OpenAutoCaseInput
): Promise<OpenAutoCaseResult> {
  const ladder = flatLadder(input.status);
  if (!ladder) return null;

  const { data: c, error: cErr } = await sb
    .from("disciplinary_cases")
    .insert({
      player_id: input.playerId,
      match_day_id: input.matchDayId,
      incident_type: "late_arrival",
      reported_by: input.actorUserId,
      status: "open",
    })
    .select("id")
    .single();
  if (cErr || !c) throw new Error(`failed to open case: ${cErr?.message ?? "no data"}`);

  const { data: a, error: aErr } = await sb
    .from("disciplinary_actions")
    .insert({
      case_id: c.id,
      sanction_type: ladder.sanction_type,
      magnitude: ladder.magnitude,
      effective_from: input.effectiveDate,
      imposed_by: input.actorUserId,
      public_visible: true,
    })
    .select("id")
    .single();
  if (aErr || !a) throw new Error(`failed to open action: ${aErr?.message ?? "no data"}`);

  return { caseId: c.id, actionId: a.id };
}

export type RevokeAutoActionInput = { actionId: string; reason: string };

export async function revokeAutoAction(
  sb: SupabaseClient,
  input: RevokeAutoActionInput
): Promise<void> {
  const { error } = await sb
    .from("disciplinary_actions")
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: input.reason,
    })
    .eq("id", input.actionId);
  if (error) throw new Error(`failed to revoke action: ${error.message}`);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 7 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/attendance/penalty.ts apps/web/src/server/attendance/penalty.test.ts
git commit -m "feat(attendance): flat ladder + openAutoCase/revokeAutoAction helpers"
```

---

## Task 4: Mark functions (markPresent/Late/Absent) — TDD

**Files:**
- Create: `apps/web/src/server/attendance/mark.ts`
- Create: `apps/web/src/server/attendance/mark.test.ts`

Signatures (from spec):
- `markPresent(matchDayId, playerId, actorUserId)`
- `markLate(matchDayId, playerId, actorUserId)`
- `markAbsent(matchDayId, playerId, actorUserId)`

All three upsert into `attendance_marks` on `(match_day_id, player_id)` and for late/absent also create a disciplinary case + action (via `openAutoCase` from Task 3), storing the returned ids on the mark row (`auto_case_id`, `auto_action_id`). Must refuse to overwrite an existing mark — calling on a row that already exists throws `ConflictError` and directs caller to `editMark`.

- [ ] **Step 1: Failing test `mark.test.ts`**

Contents:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { markPresent, markLate, markAbsent } from "./mark";

const openAutoCaseMock = vi.fn();
const revokeAutoActionMock = vi.fn();
vi.mock("./penalty", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    openAutoCase: (...args: unknown[]) => openAutoCaseMock(...args),
    revokeAutoAction: (...args: unknown[]) => revokeAutoActionMock(...args),
  };
});

function mkSb(opts: {
  matchDay?: { match_date: string; match_start_time: string; arrival_cutoff_time: string };
  existingMark?: { id: string } | null;
  insertedId?: string;
}) {
  const existingMark = opts.existingMark ?? null;
  return {
    from: vi.fn((table: string) => {
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: opts.matchDay ?? {
                  match_date: "2026-05-01",
                  match_start_time: "19:30:00",
                  arrival_cutoff_time: "19:15:00",
                },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "attendance_marks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: existingMark,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: opts.insertedId ?? "mark-1" },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("markPresent", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    revokeAutoActionMock.mockReset();
  });

  it("inserts attendance_marks row with status=present and NO penalty", async () => {
    const sb = mkSb({});
    openAutoCaseMock.mockResolvedValue(null);

    const out = await markPresent(sb as never, {
      matchDayId: "md-1",
      playerId: "p-1",
      actorUserId: "u-1",
    });

    expect(out.id).toBe("mark-1");
    expect(openAutoCaseMock).not.toHaveBeenCalled();
  });

  it("throws ConflictError when mark already exists", async () => {
    const sb = mkSb({ existingMark: { id: "existing" } });
    await expect(
      markPresent(sb as never, {
        matchDayId: "md-1",
        playerId: "p-1",
        actorUserId: "u-1",
      })
    ).rejects.toThrow(/already marked/i);
  });
});

describe("markLate", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    openAutoCaseMock.mockResolvedValue({ caseId: "c-1", actionId: "a-1" });
  });

  it("creates disciplinary_case + action of magnitude 1", async () => {
    const sb = mkSb({});
    const out = await markLate(sb as never, {
      matchDayId: "md-1",
      playerId: "p-1",
      actorUserId: "u-1",
    });
    expect(out.id).toBe("mark-1");
    expect(openAutoCaseMock).toHaveBeenCalledTimes(1);
    expect(openAutoCaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "late", playerId: "p-1" })
    );
  });
});

describe("markAbsent", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    openAutoCaseMock.mockResolvedValue({ caseId: "c-1", actionId: "a-2" });
  });

  it("creates case + action with magnitude 3 semantics (via openAutoCase)", async () => {
    const sb = mkSb({});
    await markAbsent(sb as never, {
      matchDayId: "md-1",
      playerId: "p-1",
      actorUserId: "u-1",
    });
    expect(openAutoCaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "absent" })
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `mark.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { openAutoCase, type AttendanceStatus } from "./penalty";

export type MarkInput = {
  matchDayId: string;
  playerId: string;
  actorUserId: string;
};

export type MarkResult = { id: string; status: AttendanceStatus };

export class ConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ConflictError";
  }
}

async function doMark(
  sb: SupabaseClient,
  input: MarkInput,
  status: AttendanceStatus
): Promise<MarkResult> {
  // 1. Look up match_day for scheduled_call_time context.
  const { data: md, error: mdErr } = await sb
    .from("match_days")
    .select("match_date, match_start_time, arrival_cutoff_time")
    .eq("id", input.matchDayId)
    .single();
  if (mdErr || !md) throw new Error(`match_day not found: ${input.matchDayId}`);

  // scheduled_call_time = match_date @ arrival_cutoff_time (WAT). Store as ISO UTC.
  // Africa/Lagos is UTC+1 year-round (no DST), so we can form the timestamptz directly.
  const scheduledCall = new Date(`${md.match_date}T${md.arrival_cutoff_time}+01:00`);
  const markedAt = new Date();
  const deltaSeconds = Math.round((markedAt.getTime() - scheduledCall.getTime()) / 1000);

  // 2. Refuse if already marked — caller must use editMark.
  const { data: existing } = await sb
    .from("attendance_marks")
    .select("id")
    .eq("match_day_id", input.matchDayId)
    .eq("player_id", input.playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    throw new ConflictError(
      `player ${input.playerId} already marked for match_day ${input.matchDayId} — use editMark`
    );
  }

  // 3. Open penalty case (null for present).
  const auto = await openAutoCase(sb, {
    playerId: input.playerId,
    status,
    matchDayId: input.matchDayId,
    actorUserId: input.actorUserId,
    effectiveDate: md.match_date,
  });

  // 4. Insert the mark row.
  const { data: inserted, error: insErr } = await sb
    .from("attendance_marks")
    .insert({
      match_day_id: input.matchDayId,
      player_id: input.playerId,
      status,
      marked_at: markedAt.toISOString(),
      marked_by: input.actorUserId,
      scheduled_call_time: scheduledCall.toISOString(),
      delta_seconds: deltaSeconds,
      auto_case_id: auto?.caseId ?? null,
      auto_action_id: auto?.actionId ?? null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(`failed to insert mark: ${insErr?.message}`);

  return { id: inserted.id, status };
}

export async function markPresent(sb: SupabaseClient, input: MarkInput): Promise<MarkResult> {
  return doMark(sb, input, "present");
}

export async function markLate(sb: SupabaseClient, input: MarkInput): Promise<MarkResult> {
  return doMark(sb, input, "late");
}

export async function markAbsent(sb: SupabaseClient, input: MarkInput): Promise<MarkResult> {
  return doMark(sb, input, "absent");
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 4 new tests pass (total from this plan so far: 11 attendance tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/attendance/mark.ts apps/web/src/server/attendance/mark.test.ts
git commit -m "feat(attendance): markPresent/Late/Absent with auto-case linkage"
```

---

## Task 5: editMark with revoke/re-apply semantics — TDD

**Files:**
- Create: `apps/web/src/server/attendance/edit.ts`
- Create: `apps/web/src/server/attendance/edit.test.ts`

Signature: `editMark(markId, newStatus, reason, actorUserId)`.

Rules:
- Non-empty `reason` required — empty/whitespace throws `ValidationError` with message `"override_reason required"`.
- If `newStatus === current.status`, no-op (still requires a reason; still records the audit event but does NOT create/revoke penalties).
- If current was late/absent → new is present: revoke `auto_action_id`, clear the mark's `auto_case_id`/`auto_action_id`.
- If current was present → new is late/absent: open a fresh case + action via `openAutoCase`, store new ids on mark.
- If current was late → absent (or vice versa): revoke existing action + open a fresh case + action.
- Update `status`, `override_reason`, `updated_at`, `marked_at = now()`, `marked_by = actor`.

- [ ] **Step 1: Failing test `edit.test.ts`**

Contents:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { editMark, ValidationError } from "./edit";

const openAutoCaseMock = vi.fn();
const revokeAutoActionMock = vi.fn();
vi.mock("./penalty", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    openAutoCase: (...args: unknown[]) => openAutoCaseMock(...args),
    revokeAutoAction: (...args: unknown[]) => revokeAutoActionMock(...args),
  };
});

type MarkRow = {
  id: string;
  match_day_id: string;
  player_id: string;
  status: "present" | "late" | "absent";
  auto_case_id: string | null;
  auto_action_id: string | null;
};

function mkSb(row: MarkRow) {
  const state = { row: { ...row } };
  return {
    state,
    from: vi.fn((table: string) => {
      if (table === "attendance_marks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: state.row, error: null }),
              })),
              single: vi.fn().mockResolvedValue({ data: state.row, error: null }),
            })),
          })),
          update: vi.fn((patch: Partial<MarkRow>) => {
            Object.assign(state.row, patch);
            return { eq: vi.fn().mockResolvedValue({ error: null }) };
          }),
        };
      }
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { match_date: "2026-05-01" },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("editMark", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    revokeAutoActionMock.mockReset();
  });

  it("rejects empty reason", async () => {
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "late",
      auto_case_id: "c",
      auto_action_id: "a",
    });
    await expect(
      editMark(sb as never, {
        markId: "m-1",
        newStatus: "present",
        reason: "   ",
        actorUserId: "u",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("late → present revokes auto-action + clears mark linkage", async () => {
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "late",
      auto_case_id: "c-1",
      auto_action_id: "a-1",
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "present",
      reason: "was on call — released",
      actorUserId: "u",
    });

    expect(revokeAutoActionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionId: "a-1", reason: expect.any(String) })
    );
    expect(openAutoCaseMock).not.toHaveBeenCalled();
    expect(sb.state.row.status).toBe("present");
    expect(sb.state.row.auto_action_id).toBeNull();
    expect(sb.state.row.auto_case_id).toBeNull();
  });

  it("present → absent opens a fresh auto-case", async () => {
    openAutoCaseMock.mockResolvedValue({ caseId: "c-2", actionId: "a-2" });
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "present",
      auto_case_id: null,
      auto_action_id: null,
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "absent",
      reason: "miscommunication, player never showed",
      actorUserId: "u",
    });

    expect(openAutoCaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "absent" })
    );
    expect(revokeAutoActionMock).not.toHaveBeenCalled();
    expect(sb.state.row.status).toBe("absent");
    expect(sb.state.row.auto_case_id).toBe("c-2");
    expect(sb.state.row.auto_action_id).toBe("a-2");
  });

  it("late → absent revokes old action + opens new case", async () => {
    openAutoCaseMock.mockResolvedValue({ caseId: "c-3", actionId: "a-3" });
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "late",
      auto_case_id: "c-old",
      auto_action_id: "a-old",
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "absent",
      reason: "left before kickoff",
      actorUserId: "u",
    });

    expect(revokeAutoActionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionId: "a-old" })
    );
    expect(openAutoCaseMock).toHaveBeenCalled();
    expect(sb.state.row.status).toBe("absent");
    expect(sb.state.row.auto_action_id).toBe("a-3");
  });

  it("no-op same-status edit still stores reason, no penalty churn", async () => {
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "present",
      auto_case_id: null,
      auto_action_id: null,
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "present",
      reason: "clarifying prior mark stands",
      actorUserId: "u",
    });

    expect(openAutoCaseMock).not.toHaveBeenCalled();
    expect(revokeAutoActionMock).not.toHaveBeenCalled();
    expect(sb.state.row.status).toBe("present");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `edit.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { openAutoCase, revokeAutoAction, type AttendanceStatus } from "./penalty";

export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ValidationError";
  }
}

export type EditMarkInput = {
  markId: string;
  newStatus: AttendanceStatus;
  reason: string;
  actorUserId: string;
};

export async function editMark(sb: SupabaseClient, input: EditMarkInput): Promise<void> {
  if (!input.reason || !input.reason.trim()) {
    throw new ValidationError("override_reason required");
  }

  // 1. Load current mark.
  const { data: mark, error: mErr } = await sb
    .from("attendance_marks")
    .select("id, match_day_id, player_id, status, auto_case_id, auto_action_id")
    .eq("id", input.markId)
    .is("deleted_at", null)
    .single();
  if (mErr || !mark) throw new Error(`mark not found: ${input.markId}`);

  const prev = mark.status as AttendanceStatus;
  const next = input.newStatus;

  const wasPenal = prev === "late" || prev === "absent";
  const becomesPenal = next === "late" || next === "absent";
  const statusChanged = prev !== next;

  let newCaseId: string | null = mark.auto_case_id ?? null;
  let newActionId: string | null = mark.auto_action_id ?? null;

  // 2. Revoke old auto-action if moving away from late/absent OR switching
  //    between late ↔ absent (magnitude differs).
  if (statusChanged && wasPenal && mark.auto_action_id) {
    await revokeAutoAction(sb, {
      actionId: mark.auto_action_id,
      reason: `attendance edit: ${input.reason.trim()}`,
    });
    newCaseId = null;
    newActionId = null;
  }

  // 3. Open fresh auto-case if becoming late/absent and we don't already have one
  //    matching this status. (Simplest rule: after revoke, always open fresh.)
  if (statusChanged && becomesPenal) {
    const { data: md } = await sb
      .from("match_days")
      .select("match_date")
      .eq("id", mark.match_day_id)
      .single();
    const effectiveDate = (md as { match_date: string } | null)?.match_date
      ?? new Date().toISOString().slice(0, 10);

    const auto = await openAutoCase(sb, {
      playerId: mark.player_id,
      status: next,
      matchDayId: mark.match_day_id,
      actorUserId: input.actorUserId,
      effectiveDate,
    });
    if (auto) {
      newCaseId = auto.caseId;
      newActionId = auto.actionId;
    }
  }

  // 4. Persist the edit.
  const { error: uErr } = await sb
    .from("attendance_marks")
    .update({
      status: next,
      override_reason: input.reason.trim(),
      marked_at: new Date().toISOString(),
      marked_by: input.actorUserId,
      auto_case_id: newCaseId,
      auto_action_id: newActionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.markId);
  if (uErr) throw new Error(`failed to update mark: ${uErr.message}`);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 5 new tests pass (total: 16 attendance tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/attendance/edit.ts apps/web/src/server/attendance/edit.test.ts
git commit -m "feat(attendance): editMark with reason-required + revoke/re-apply penalty"
```

---

## Task 6: List helper + index barrel

**Files:**
- Create: `apps/web/src/server/attendance/list.ts`
- Create: `apps/web/src/server/attendance/index.ts`

`listByMatchDay` returns the roster joined with existing marks (left-join so unmarked players appear with null status). The UI needs: `player_id`, `display_name` / `gamer_tag`, `jersey_number`, `mark_id`, `status`, `marked_at`, `marked_by_name`, `auto_action_id`.

- [ ] **Step 1: Write `list.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type RosterRow = {
  player_id: string;
  display_name: string;
  gamer_tag: string | null;
  jersey_number: number | null;
  mark_id: string | null;
  status: "present" | "late" | "absent" | null;
  marked_at: string | null;
  marked_by_id: string | null;
  marked_by_name: string | null;
  auto_action_id: string | null;
};

/**
 * Load the full participant roster for the match day's season, left-joined with
 * any existing attendance_mark. Players without a mark come back with nulls.
 */
export async function listByMatchDay(
  sb: SupabaseClient,
  matchDayId: string
): Promise<RosterRow[]> {
  // Resolve season for this match day.
  const { data: md } = await sb
    .from("match_days")
    .select("season_id")
    .eq("id", matchDayId)
    .single();
  if (!md) return [];

  // Pull season participants with player details.
  const { data: participants } = await sb
    .from("season_participants")
    .select(
      "player_id, players:player_id (id, jersey_number, gamer_tag, users:user_id (display_name))"
    )
    .eq("season_id", (md as { season_id: string }).season_id)
    .is("deleted_at", null);

  // Pull existing marks for this match day.
  const { data: marks } = await sb
    .from("attendance_marks")
    .select(
      "id, player_id, status, marked_at, auto_action_id, marked_by, markers:marked_by (display_name)"
    )
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null);

  const marksByPlayer = new Map<string, (typeof marks extends (infer T)[] | null ? T : never)>();
  (marks ?? []).forEach((m: { player_id: string } & Record<string, unknown>) => {
    marksByPlayer.set(m.player_id, m as never);
  });

  return (participants ?? []).map((p: Record<string, unknown>) => {
    const player = p.players as Record<string, unknown> | null;
    const users = (player?.users as Record<string, unknown> | null) ?? null;
    const mark = marksByPlayer.get(p.player_id as string) as Record<string, unknown> | undefined;
    const markers = (mark?.markers as Record<string, unknown> | null) ?? null;
    return {
      player_id: p.player_id as string,
      display_name: (users?.display_name as string | null) ?? "(unknown)",
      gamer_tag: (player?.gamer_tag as string | null) ?? null,
      jersey_number: (player?.jersey_number as number | null) ?? null,
      mark_id: (mark?.id as string | null) ?? null,
      status: (mark?.status as RosterRow["status"]) ?? null,
      marked_at: (mark?.marked_at as string | null) ?? null,
      marked_by_id: (mark?.marked_by as string | null) ?? null,
      marked_by_name: (markers?.display_name as string | null) ?? null,
      auto_action_id: (mark?.auto_action_id as string | null) ?? null,
    };
  });
}
```

- [ ] **Step 2: Write `index.ts`**

Contents:

```ts
export { markPresent, markLate, markAbsent, ConflictError } from "./mark";
export type { MarkInput, MarkResult } from "./mark";
export { editMark, ValidationError } from "./edit";
export type { EditMarkInput } from "./edit";
export { listByMatchDay } from "./list";
export type { RosterRow } from "./list";
export { flatLadder } from "./penalty";
export type { AttendanceStatus } from "./penalty";
```

- [ ] **Step 3: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/attendance/list.ts apps/web/src/server/attendance/index.ts
git commit -m "feat(attendance): listByMatchDay + module barrel export"
```

---

## Task 7: Server Actions for admin UI

**Files:**
- Create: `apps/web/src/app/admin/match-days/[id]/attendance/actions.ts`

Thin Server Action wrappers that:
- Resolve `Actor` via `getActorFromSession` (Plan 1) + check `attendance.mark` / `attendance.edit`.
- Resolve `publicUserId` to pass as `actorUserId`.
- Call into `src/server/attendance/` module.
- `revalidatePath` after success.

- [ ] **Step 1: Write `actions.ts`**

Contents:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { hasPerm } from "@/perms";
import { markPresent, markLate, markAbsent, editMark } from "@/server/attendance";

async function requireActor(perm: "attendance.mark" | "attendance.edit") {
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) redirect("/login");

  const { data: roleRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (!hasPerm({ userId: pub.id, roles }, perm)) {
    throw new Error("forbidden");
  }
  return { sb, actorUserId: pub.id };
}

export async function markAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId"));
  const playerId = String(formData.get("playerId"));
  const status = String(formData.get("status"));
  const { sb, actorUserId } = await requireActor("attendance.mark");

  const input = { matchDayId, playerId, actorUserId };
  if (status === "present") await markPresent(sb, input);
  else if (status === "late") await markLate(sb, input);
  else if (status === "absent") await markAbsent(sb, input);
  else throw new Error(`bad status: ${status}`);

  revalidatePath(`/admin/match-days/${matchDayId}/attendance`);
}

export async function editAction(formData: FormData) {
  const markId = String(formData.get("markId"));
  const newStatus = String(formData.get("newStatus")) as "present" | "late" | "absent";
  const reason = String(formData.get("reason") ?? "").trim();
  const matchDayId = String(formData.get("matchDayId"));
  if (!reason) throw new Error("override_reason required");

  const { sb, actorUserId } = await requireActor("attendance.edit");
  await editMark(sb, { markId, newStatus, reason, actorUserId });
  revalidatePath(`/admin/match-days/${matchDayId}/attendance`);
}

export async function undoAction(formData: FormData) {
  const markId = String(formData.get("markId"));
  const matchDayId = String(formData.get("matchDayId"));
  const { sb, actorUserId } = await requireActor("attendance.edit");
  await editMark(sb, {
    markId,
    newStatus: "present",
    reason: "undo from attendance screen",
    actorUserId,
  });
  revalidatePath(`/admin/match-days/${matchDayId}/attendance`);
}
```

- [ ] **Step 2: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/match-days/[id]/attendance/actions.ts
git commit -m "feat(attendance): server actions for mark/edit/undo with perm gate"
```

---

## Task 8: Admin UI — attendance page

**Files:**
- Create: `apps/web/src/app/admin/match-days/[id]/attendance/page.tsx`

Renders the roster table. Each row either shows three status buttons (when unmarked) or shows the status chip + timestamp + marked_by + Edit + Undo (when marked). Edit opens a dialog that posts the new status + required reason.

- [ ] **Step 1: Write `page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { listByMatchDay } from "@/server/attendance";
import { markAction, editAction, undoAction } from "./actions";

export default async function AttendancePage({ params }: { params: { id: string } }) {
  const sb = await getServerSupabase();
  const roster = await listByMatchDay(sb, params.id);

  const { data: md } = await sb
    .from("match_days")
    .select("match_date, match_start_time, arrival_cutoff_time, venue_name")
    .eq("id", params.id)
    .single();

  return (
    <div className="space-y-6" data-testid="attendance-page">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">Attendance</h2>
        {md ? (
          <p className="text-sm text-gray-600">
            {md.match_date} · call {md.arrival_cutoff_time} · KO {md.match_start_time}
            {md.venue_name ? ` · ${md.venue_name}` : ""}
          </p>
        ) : null}
      </header>

      <table className="w-full text-sm border">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">#</th>
            <th className="text-left p-2">Player</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Marked</th>
            <th className="text-left p-2">Penalty</th>
            <th className="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((row) => (
            <tr key={row.player_id} className="border-t align-top" data-testid={`att-row-${row.player_id}`}>
              <td className="p-2">{row.jersey_number ?? "—"}</td>
              <td className="p-2">
                <div className="font-medium">{row.display_name}</div>
                {row.gamer_tag ? <div className="text-xs text-gray-500">{row.gamer_tag}</div> : null}
              </td>
              <td className="p-2">
                {row.status ? (
                  <span
                    data-testid={`att-status-${row.player_id}`}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      row.status === "present"
                        ? "bg-green-100 text-green-700"
                        : row.status === "late"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {row.status}
                  </span>
                ) : (
                  <span className="text-gray-400 text-xs">unmarked</span>
                )}
              </td>
              <td className="p-2 text-xs">
                {row.marked_at ? (
                  <div>
                    <div>{formatWat(row.marked_at, "HH:mm:ss")}</div>
                    <div className="text-gray-500">{row.marked_by_name ?? "—"}</div>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="p-2 text-xs">
                {row.auto_action_id ? (
                  <span className="text-red-700">linked</span>
                ) : row.status && row.status !== "present" ? (
                  <span className="text-gray-500">revoked</span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="p-2">
                {!row.mark_id ? (
                  <div className="flex gap-2">
                    {(["present", "late", "absent"] as const).map((s) => (
                      <form action={markAction} key={s}>
                        <input type="hidden" name="matchDayId" value={params.id} />
                        <input type="hidden" name="playerId" value={row.player_id} />
                        <input type="hidden" name="status" value={s} />
                        <button
                          data-testid={`att-btn-${s}-${row.player_id}`}
                          className="px-2 py-1 text-xs border rounded hover:bg-slate-50"
                          type="submit"
                        >
                          {s[0].toUpperCase() + s.slice(1)}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-2 items-start">
                    <details className="relative">
                      <summary
                        data-testid={`att-edit-${row.player_id}`}
                        className="cursor-pointer text-xs underline"
                      >
                        Edit
                      </summary>
                      <form
                        action={editAction}
                        className="absolute z-10 mt-1 bg-white border rounded shadow p-3 space-y-2 w-64"
                      >
                        <input type="hidden" name="markId" value={row.mark_id} />
                        <input type="hidden" name="matchDayId" value={params.id} />
                        <label className="block text-xs space-y-1">
                          <span>New status</span>
                          <select
                            name="newStatus"
                            className="w-full border rounded px-2 py-1 text-sm"
                            defaultValue={row.status ?? "present"}
                          >
                            <option value="present">Present</option>
                            <option value="late">Late</option>
                            <option value="absent">Absent</option>
                          </select>
                        </label>
                        <label className="block text-xs space-y-1">
                          <span>Reason (required)</span>
                          <textarea
                            name="reason"
                            required
                            minLength={3}
                            data-testid={`att-reason-${row.player_id}`}
                            className="w-full border rounded px-2 py-1 text-sm"
                            rows={2}
                          />
                        </label>
                        <button className="w-full bg-black text-white rounded py-1 text-xs" type="submit">
                          Save edit
                        </button>
                      </form>
                    </details>
                    {row.auto_action_id ? (
                      <form action={undoAction}>
                        <input type="hidden" name="markId" value={row.mark_id} />
                        <input type="hidden" name="matchDayId" value={params.id} />
                        <button className="text-xs text-blue-700 underline" type="submit">
                          Undo penalty
                        </button>
                      </form>
                    ) : null}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles; new route `/admin/match-days/[id]/attendance` appears in build output.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/match-days/[id]/attendance/page.tsx
git commit -m "feat(admin): attendance roster page with mark + edit + undo UI"
```

---

## Task 9: E2E happy path (mark → penalty → edit → revoke)

**Files:**
- Create: `apps/web/tests/e2e/attendance.spec.ts`

Depends on seed data: admin user from Plan 1, players from Plan 2 seed, one match_day from Plan 3 seed, and Plan 4's `/admin/punishments` page.

- [ ] **Step 1: Write E2E spec**

Contents:

```ts
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test("admin marks player absent → penalty appears → edits to present → penalty revoked", async ({ page, request }) => {
  await loginAsAdmin(page);

  // Jump to the first match day's attendance page. Seed guarantees ≥1 row.
  // Admin match-days index should expose a link; we take the first one.
  await page.goto("/admin/match-days");
  const firstAttendanceLink = page.getByRole("link", { name: /attendance/i }).first();
  await firstAttendanceLink.click();
  await expect(page.getByTestId("attendance-page")).toBeVisible();

  // Pick the first row and mark absent.
  const firstRow = page.locator("[data-testid^=att-row-]").first();
  const playerId = await firstRow.getAttribute("data-testid").then((s) => s!.replace("att-row-", ""));
  await page.getByTestId(`att-btn-absent-${playerId}`).click();

  // Status chip now reads "absent".
  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("absent");

  // Penalty should be visible on /admin/punishments.
  await page.goto("/admin/punishments");
  await expect(page.getByText(/point_deduction/i).first()).toBeVisible();
  await expect(page.getByText(/3/).first()).toBeVisible(); // magnitude 3

  // Go back and edit to present with a reason.
  await page.goBack();
  await page.getByTestId(`att-edit-${playerId}`).click();
  await page.getByTestId(`att-reason-${playerId}`).fill("system test — revoking absence");
  await page.getByRole("combobox", { name: /new status/i }).selectOption("present");
  await page.getByRole("button", { name: "Save edit" }).click();

  await expect(page.getByTestId(`att-status-${playerId}`)).toHaveText("present");

  // The punishments page should now show the action as revoked.
  await page.goto("/admin/punishments");
  await expect(page.getByText(/revoked/i).first()).toBeVisible();
});

test("edit without reason is rejected", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/match-days");
  await page.getByRole("link", { name: /attendance/i }).first().click();
  // Mark a player late first so an edit is possible.
  const firstRow = page.locator("[data-testid^=att-row-]").first();
  const playerId = await firstRow.getAttribute("data-testid").then((s) => s!.replace("att-row-", ""));
  await page.getByTestId(`att-btn-late-${playerId}`).click();
  await page.getByTestId(`att-edit-${playerId}`).click();
  // Leave reason blank, try to submit — HTML5 required + server guard both enforce.
  await page.getByRole("button", { name: "Save edit" }).click();
  // Still on attendance page, reason field shows validation.
  await expect(page.getByTestId(`att-reason-${playerId}`)).toBeVisible();
});
```

- [ ] **Step 2: Run E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: 2 new tests pass (plus prior plans' E2Es). If the punishments page lacks distinct `revoked` text, adjust assertions to match Plan 4's actual markup.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/attendance.spec.ts
git commit -m "test(e2e): attendance mark + penalty + edit-revokes flow"
```

---

## Task 10: Audit + soft-delete verification

- [ ] **Step 1: Confirm audit rows for the new table**

Run after the E2E (or any dev mark):

```bash
npx --yes supabase db query "select entity_type, action, count(*) from public.audit_events where entity_type='attendance_marks' group by 1,2" --linked --output table
```

Expected: at least one `insert` row; after the edit, at least one `update` row.

- [ ] **Step 2: Verify disciplinary_actions audit**

```bash
npx --yes supabase db query "select entity_type, action, count(*) from public.audit_events where entity_type in ('disciplinary_cases','disciplinary_actions') group by 1,2" --linked --output table
```

Expected: insert rows from the auto-case, update rows from the revoke.

- [ ] **Step 3: Soft-delete smoke test**

In a scratch SQL session, soft-delete a mark and verify `listByMatchDay` excludes it:

```bash
npx --yes supabase db query "update public.attendance_marks set deleted_at = now() where id = (select id from public.attendance_marks limit 1) returning id" --linked --output table
```

Reload `/admin/match-days/[id]/attendance` in the browser → the marked row should show as unmarked again (since list filters `deleted_at is null`).

- [ ] **Step 4: Commit verification notes (if any)**

If seed or a migration tweak was needed to make the checks pass, commit it. Otherwise skip.

---

## Task 11: Final verification

- [ ] **Step 1: Migrations applied**

```bash
npm run db:push
```

Expected: `No schemas to push`.

- [ ] **Step 2: Unit tests**

```bash
npm run test
```

Expected: all prior plans' tests still green + 16 new attendance tests.

- [ ] **Step 3: Lint + build**

```bash
npm run lint && npm run build
```

Expected: both clean. New route `/admin/match-days/[id]/attendance` listed in build output.

- [ ] **Step 4: E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: prior specs + 2 new attendance specs pass.

- [ ] **Step 5: Update `tasks/todo.md`**

Move Plan 5 to Done:

```markdown
## Done
- Plan 5 — Attendance complete (2026-04-XX). All 11 tasks green.
  - attendance_marks migration applied with UNIQUE (match_day_id, player_id) + audit
  - markPresent/Late/Absent + editMark implemented with revoke/re-apply penalty flow
  - /admin/match-days/[id]/attendance roster UI shipped with Edit + Undo
  - 16 new unit tests green + 2 E2E specs green
  - Public /players/[id] attendance % deferred (not in scope of this plan)
```

- [ ] **Step 6: Commit verification**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): Plan 5 complete"
```

---

## Out of Scope for Plan 5

- Public `/players/[id]` attendance percentage panel — deferred per scope note; belongs with a `players` / public-profile plan or Phase 1B refinements.
- Rule 5.4 scaled late-arrival ladder — Phase 1B.
- Bulk-mark UI ("mark everyone not-yet-marked as present") — Phase 1B once refs complain.
- Attendance reports / season-wide attendance CSV — Phase 1B.
- Push notifications to players when marked absent — Phase 3.
- Mobile-first attendance screen optimization — PWA pass later.
- Retroactive mark for a player who wasn't a season_participant at the time — not supported; UI shows only current participants.
- Automatic standings recompute on attendance-driven penalty — relies on Plan 4's existing `recomputeStandings()` trigger on `disciplinary_actions` insert/update. Verified by the E2E, not re-implemented here.

---

## Review / Acceptance Criteria

Plan 5 is done when:

1. `git log --oneline` shows ~11 commits (one per task).
2. `attendance_marks` table exists in cloud DB with UNIQUE `(match_day_id, player_id)` and audit trigger attached.
3. All unit tests green: 16 new attendance tests (3 ladder, 3 openAutoCase, 1 revokeAutoAction, 4 mark, 5 edit) on top of prior plan totals.
4. Admin can navigate to `/admin/match-days/[id]/attendance`, see the roster, mark any player Present/Late/Absent, and row updates in place.
5. Marking a player Late creates one row in `disciplinary_cases` + one row in `disciplinary_actions` with `magnitude = 1`. Absent creates `magnitude = 3`.
6. Editing a Late/Absent mark to Present sets `revoked_at` + `revoke_reason` on the linked `disciplinary_actions` row.
7. Editing with empty/whitespace reason is rejected server-side (`ValidationError: override_reason required`).
8. `public.audit_events` shows rows for `attendance_marks` insert + update, plus `disciplinary_cases`/`disciplinary_actions` insert + update from the auto-flow.
9. Non-admin / non-moderator hitting the attendance Server Actions gets a `forbidden` error.
10. E2E `attendance.spec.ts` passes both scenarios (mark-absent-then-revoke; edit-without-reason-rejected).
