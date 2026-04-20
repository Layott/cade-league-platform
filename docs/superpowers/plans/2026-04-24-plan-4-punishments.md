# Plan 4 — Punishments (Disciplinary Cases + Actions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the disciplinary system end-to-end: schema (`disciplinary_cases` + `disciplinary_actions`), a superset of the `recompute_standings` SQL function that subtracts active punishments from points/GD, an AFTER trigger that recomputes on any action mutation, server module functions (`issue`, `edit`, `revoke`, `listPublic`, `listForPlayer`) with permission gates, forfeit auto-result business logic, admin UI (`/admin/punishments`, `/admin/punishments/new`, `/admin/punishments/[id]`), a public feed at `/punishments`, and a punishments section on the player profile page.

**Architecture:** Punishments are two tables joined by `case_id`. A case describes *what happened*; an action describes *what we did about it*. One case can have many actions (typical: late_arrival case → 1 point_deduction action; serious case → warning + ban). Standings compute subtracts only non-revoked actions of type `point_deduction` / `gd_deduction` from the materialized `standings` row. Forfeits are special: when `sanction_type='forfeit'` is applied with a linked `match_id`, the server module (not a trigger) writes a 3-0 `match_results` row with `result_type='forfeit'`, then lets Plan 3's match-result trigger cascade into the standings recompute. Revoke = `UPDATE ... SET revoked_at = now()` → trigger → recompute → points restored. Idempotent by construction: revoke + re-issue cycle produces the exact original state.

**Tech Stack:** Postgres functions + AFTER triggers, Supabase service-role client in server module, Plan 1's `hasPerm` helper + `getActorFromSession`, Plan 0's `attach_audit` + soft-delete conventions, Next.js 15 Server Actions, Zod for validation, Vitest for units, Playwright for E2E.

**Prerequisites:**
- Plan 0 complete: `attach_audit`, soft-delete columns, audit infrastructure in cloud.
- Plan 1 complete: `users`, `user_roles`, `hasPerm`, `getActorFromSession`, middleware gate on `/admin/*`.
- Plan 2 complete: `players`, `season_participants`.
- Plan 3 complete: `matches`, `match_results`, `standings`, `recompute_standings(season_id uuid)` SQL function, match-result AFTER trigger that calls it.

**Shippable at end of Plan 4:**
- Admin can issue a 3-point deduction against a player → `/standings` reflects a -3 points drop for that player → `/punishments` public feed shows the entry → player's card shows it.
- Admin can revoke a punishment with a reason → standings restore instantly → public feed stops showing the revoked item.
- Admin can issue a forfeit against a match → `match_results` gets a 3-0 row with `result_type='forfeit'` → standings reflect the forfeit loss on the forfeiting player.
- All mutations logged to `audit_events`; all actions gated by `punishments.issue` / `punishments.revoke`; all recomputation idempotent.

---

## File Structure (delta over Plan 3)

Created by this plan:

```
apps/web/src/
├── app/
│   ├── admin/
│   │   └── punishments/
│   │       ├── page.tsx                       # List all active + revoked, filter UI
│   │       ├── actions.ts                     # Server Actions: issueAction, revokeAction
│   │       ├── new/
│   │       │   └── page.tsx                   # New-punishment form
│   │       └── [id]/
│   │           └── page.tsx                   # Detail view
│   └── punishments/
│       └── page.tsx                           # Public feed — /punishments
├── server/
│   └── punishments/
│       ├── issue.ts                           # issue({ actor, input }) → { caseId, actionId }
│       ├── issue.test.ts
│       ├── edit.ts                            # edit({ actor, actionId, patch })
│       ├── edit.test.ts
│       ├── revoke.ts                          # revoke({ actor, actionId, reason })
│       ├── revoke.test.ts
│       ├── list-public.ts                     # listPublic({ limit })
│       ├── list-for-player.ts                 # listForPlayer({ playerId })
│       ├── forfeit.ts                         # applyForfeitMatchResult(sb, matchId, forfeitingPlayerId)
│       └── forfeit.test.ts

supabase/migrations/
├── 20260424000001_disciplinary_cases.sql
├── 20260424000002_disciplinary_actions.sql
├── 20260424000003_recompute_with_punishments.sql    # superset of Plan 3 fn
└── 20260424000004_disciplinary_action_trigger.sql
```

Modified:
- `apps/web/src/app/players/[id]/page.tsx` — add punishments section (read-only, from `listForPlayer`)
- `apps/web/src/perms.ts` — confirm `punishments.issue` / `punishments.edit` / `punishments.revoke` already present from Plan 1 design (no change if yes; add if missing)

---

## Task 1: Migration — disciplinary_cases table

**Files:**
- Create: `supabase/migrations/20260424000001_disciplinary_cases.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Disciplinary cases: one row per incident.
-- Each case can spawn zero-to-many disciplinary_actions (warning + deduction, etc.).
-- No RLS — this data is operational, not PII. Public read via app layer filters
-- to action rows with public_visible=true.

create table public.disciplinary_cases (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.players (id) on delete restrict,
  match_id       uuid references public.matches (id) on delete set null,
  incident_type  text not null check (incident_type in (
    'late_arrival','forfeit','equipment','social_media','other'
  )),
  reported_by    uuid not null references public.users (id) on delete restrict,
  opened_at      timestamptz not null default now(),
  status         text not null default 'open' check (status in ('open','resolved')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index disciplinary_cases_player_idx
  on public.disciplinary_cases (player_id, opened_at desc)
  where deleted_at is null;

create index disciplinary_cases_match_idx
  on public.disciplinary_cases (match_id)
  where match_id is not null and deleted_at is null;

create index disciplinary_cases_status_idx
  on public.disciplinary_cases (status)
  where deleted_at is null;

select public.attach_audit('public.disciplinary_cases');
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
npx --yes supabase db query "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='disciplinary_cases' order by ordinal_position" --linked --output table
```

Expected: 11 columns listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000001_disciplinary_cases.sql
git commit -m "feat(db): disciplinary_cases table + audit attached"
```

---

## Task 2: Migration — disciplinary_actions table

**Files:**
- Create: `supabase/migrations/20260424000002_disciplinary_actions.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Disciplinary actions: one row per sanction applied.
-- `magnitude` meaning depends on sanction_type:
--   warning / forfeit / ban     → 0 (column required, but value unused by recompute)
--   point_deduction / gd_deduction → positive integer; recompute subtracts this
-- `public_visible=true` (default) shows this action on /punishments + player card.
-- `revoked_at IS NOT NULL` = action no longer counts in recompute.

create table public.disciplinary_actions (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.disciplinary_cases (id) on delete restrict,
  sanction_type     text not null check (sanction_type in (
    'warning','point_deduction','gd_deduction','forfeit','ban'
  )),
  magnitude         int  not null default 0 check (magnitude >= 0),
  effective_from    date not null default current_date,
  effective_until   date,
  imposed_by        uuid not null references public.users (id) on delete restrict,
  imposed_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoke_reason     text,
  public_visible    boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint disciplinary_actions_revoke_reason_ck
    check (revoked_at is null or revoke_reason is not null),
  constraint disciplinary_actions_effective_range_ck
    check (effective_until is null or effective_until >= effective_from)
);

create index disciplinary_actions_case_idx
  on public.disciplinary_actions (case_id)
  where deleted_at is null;

create index disciplinary_actions_active_idx
  on public.disciplinary_actions (sanction_type, effective_from)
  where deleted_at is null and revoked_at is null;

create index disciplinary_actions_public_idx
  on public.disciplinary_actions (imposed_at desc)
  where public_visible = true and revoked_at is null and deleted_at is null;

select public.attach_audit('public.disciplinary_actions');
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
npx --yes supabase db query "select conname from pg_constraint where conrelid='public.disciplinary_actions'::regclass and contype='c' order by conname" --linked --output table
```

Expected: 4+ check constraints (sanction_type, magnitude, revoke_reason, effective_range).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000002_disciplinary_actions.sql
git commit -m "feat(db): disciplinary_actions table with revoke + effective-range constraints"
```

---

## Task 3: Migration — supersede recompute_standings to include punishments

**Files:**
- Create: `supabase/migrations/20260424000003_recompute_with_punishments.sql`

**Rule:** do not edit Plan 3's migration. This file uses `create or replace function` to produce a new body with the same signature. Plan 3's trigger on `match_results` keeps calling it by name; behaviour evolves.

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Supersede Plan 3's recompute_standings(season_id uuid) to also subtract
-- active (non-revoked, non-soft-deleted) point_deduction and gd_deduction
-- disciplinary_actions from each player's standings row.
--
-- Contract (unchanged from Plan 3):
--   - Idempotent: running twice yields the same output.
--   - Same signature: recompute_standings(p_season_id uuid) returns void.
--   - Wipes + re-inserts `standings` rows for the season. No partial updates.
--
-- Aggregation detail:
--   For each season_participant's player:
--     punishment_points_deducted = sum(magnitude) of active point_deduction actions
--                                  whose case.player_id = player
--     punishment_gd_deducted     = sum(magnitude) of active gd_deduction actions
--     points     = match_points - punishment_points_deducted
--     goal_diff  = match_gd     - punishment_gd_deducted
--   Both deducted columns are stored so the UI can display "raw vs. adjusted".

create or replace function public.recompute_standings(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Clear existing rows for this season.
  delete from public.standings where season_id = p_season_id;

  -- Recompute from source tables.
  insert into public.standings (
    season_id, player_id,
    matches_played, wins, draws, losses,
    goals_for, goals_against, goal_difference,
    points,
    punishment_points_deducted, punishment_gd_deducted,
    updated_at
  )
  with participants as (
    select sp.player_id
    from public.season_participants sp
    where sp.season_id = p_season_id
      and sp.deleted_at is null
  ),
  match_agg as (
    -- Per-player match aggregates from match_results joined to matches.
    -- Counts normal + forfeit results; excludes 'void'.
    select
      p.player_id,
      count(*) filter (where mr.id is not null)                                   as matches_played,
      sum(case
            when (m.home_player_id = p.player_id and mr.home_score > mr.away_score)
              or (m.away_player_id = p.player_id and mr.away_score > mr.home_score)
            then 1 else 0 end)                                                    as wins,
      sum(case when mr.home_score = mr.away_score then 1 else 0 end)              as draws,
      sum(case
            when (m.home_player_id = p.player_id and mr.home_score < mr.away_score)
              or (m.away_player_id = p.player_id and mr.away_score < mr.home_score)
            then 1 else 0 end)                                                    as losses,
      sum(case when m.home_player_id = p.player_id then mr.home_score
               when m.away_player_id = p.player_id then mr.away_score
               else 0 end)                                                        as goals_for,
      sum(case when m.home_player_id = p.player_id then mr.away_score
               when m.away_player_id = p.player_id then mr.home_score
               else 0 end)                                                        as goals_against
    from participants p
    left join public.matches m
      on (m.home_player_id = p.player_id or m.away_player_id = p.player_id)
     and m.season_id = p_season_id
     and m.deleted_at is null
    left join public.match_results mr
      on mr.match_id = m.id
     and mr.result_type in ('normal','forfeit')
     and mr.deleted_at is null
    group by p.player_id
  ),
  punishment_agg as (
    -- Active (non-revoked, non-soft-deleted) deduction totals per player for this season.
    -- Case.match_id (if present) must belong to this season; if match_id is null,
    -- the case is not match-scoped and counts against the player globally (Phase 1A
    -- assumes one season, so "globally" == "this season").
    select
      c.player_id,
      coalesce(sum(case when a.sanction_type = 'point_deduction' then a.magnitude else 0 end), 0) as pts_ded,
      coalesce(sum(case when a.sanction_type = 'gd_deduction'    then a.magnitude else 0 end), 0) as gd_ded
    from public.disciplinary_cases c
    join public.disciplinary_actions a
      on a.case_id = c.id
     and a.deleted_at is null
     and a.revoked_at is null
     and a.sanction_type in ('point_deduction','gd_deduction')
    where c.deleted_at is null
      and (
        c.match_id is null
        or exists (
          select 1 from public.matches m2
          where m2.id = c.match_id
            and m2.season_id = p_season_id
            and m2.deleted_at is null
        )
      )
    group by c.player_id
  )
  select
    p_season_id,
    p.player_id,
    coalesce(ma.matches_played, 0),
    coalesce(ma.wins, 0),
    coalesce(ma.draws, 0),
    coalesce(ma.losses, 0),
    coalesce(ma.goals_for, 0),
    coalesce(ma.goals_against, 0),
    coalesce(ma.goals_for, 0) - coalesce(ma.goals_against, 0) - coalesce(pa.gd_ded, 0),
    (coalesce(ma.wins, 0) * 3 + coalesce(ma.draws, 0)) - coalesce(pa.pts_ded, 0),
    coalesce(pa.pts_ded, 0),
    coalesce(pa.gd_ded, 0),
    now()
  from participants p
  left join match_agg      ma on ma.player_id = p.player_id
  left join punishment_agg pa on pa.player_id = p.player_id;
end;
$$;
```

- [ ] **Step 2: Push + smoke test**

```bash
npm run db:push
# Call with a known season id from seed; expect void + no error.
npx --yes supabase db query "select public.recompute_standings((select id from public.seasons limit 1))" --linked --output table
```

Expected: one row returned, value null (void).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000003_recompute_with_punishments.sql
git commit -m "feat(db): supersede recompute_standings to subtract active punishments"
```

---

## Task 4: Migration — AFTER trigger on disciplinary_actions

**Files:**
- Create: `supabase/migrations/20260424000004_disciplinary_action_trigger.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- When a disciplinary_action is inserted or updated (revoke, edit, soft-delete),
-- recompute standings for every season the affected player participates in.
-- In Phase 1A there is exactly one season, but the trigger is written correctly
-- for future multi-season use.
--
-- Design note: we do NOT recompute on DELETE because our model never hard-deletes
-- (soft_delete pattern). Soft deletes show up as UPDATE (deleted_at NULL→ts),
-- which is covered.

create or replace function public.on_disciplinary_action_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player_id uuid;
  v_season_id uuid;
begin
  -- Resolve the player via the owning case (NEW for insert/update).
  select c.player_id into v_player_id
  from public.disciplinary_cases c
  where c.id = new.case_id;

  if v_player_id is null then
    return new;
  end if;

  -- Recompute for each season the player participates in.
  for v_season_id in
    select sp.season_id
    from public.season_participants sp
    where sp.player_id = v_player_id
      and sp.deleted_at is null
  loop
    perform public.recompute_standings(v_season_id);
  end loop;

  return new;
end;
$$;

drop trigger if exists disciplinary_actions_recompute on public.disciplinary_actions;
create trigger disciplinary_actions_recompute
  after insert or update on public.disciplinary_actions
  for each row execute function public.on_disciplinary_action_change();
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
npx --yes supabase db query "select tgname from pg_trigger where tgrelid='public.disciplinary_actions'::regclass and not tgisinternal" --linked --output table
```

Expected: includes `disciplinary_actions_recompute` plus the audit trigger.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000004_disciplinary_action_trigger.sql
git commit -m "feat(db): AFTER trigger on disciplinary_actions calls recompute_standings per season"
```

---

## Task 5: perms.ts — confirm punishment perms + widen if missing

**Files:**
- Modify: `apps/web/src/perms.ts` (only if punishments entries are missing)
- Modify: `apps/web/src/perms.test.ts` (add cases)

- [ ] **Step 1: Check current perms**

Open `apps/web/src/perms.ts`. The Phase 1A spec §6 says admin has `punishments.*`; moderator has `punishments.issue`, `punishments.edit`. Confirm these strings exist. If missing, add them to the PERMS map.

Expected final shape (admin + moderator excerpt):

```ts
export const PERMS = {
  admin: [
    /* existing */
    'punishments.issue', 'punishments.edit', 'punishments.revoke', 'punishments.read',
  ],
  moderator: [
    /* existing */
    'punishments.issue', 'punishments.edit', 'punishments.read',
  ],
  /* ... */
} as const;
```

Note: only `admin` gets `punishments.revoke`. Moderators issue + edit only.

- [ ] **Step 2: Add tests**

Append to `apps/web/src/perms.test.ts`:

```ts
it("admin has punishments.revoke", () => {
  expect(hasPerm({ userId: null, roles: ["admin"] }, "punishments.revoke")).toBe(true);
});

it("moderator has punishments.issue but NOT punishments.revoke", () => {
  expect(hasPerm({ userId: null, roles: ["moderator"] }, "punishments.issue")).toBe(true);
  expect(hasPerm({ userId: null, roles: ["moderator"] }, "punishments.revoke")).toBe(false);
});

it("player does not have any punishments perms", () => {
  expect(hasPerm({ userId: null, roles: ["player"] }, "punishments.issue")).toBe(false);
  expect(hasPerm({ userId: null, roles: ["player"] }, "punishments.read")).toBe(false);
});
```

- [ ] **Step 3: Run + commit**

```bash
npm --workspace apps/web run test
git add apps/web/src/perms.ts apps/web/src/perms.test.ts
git commit -m "feat(perms): punishments.issue/edit/revoke/read permissions and tests"
```

---

## Task 6: Server module — `issue` function (TDD)

**Files:**
- Create: `apps/web/src/server/punishments/issue.ts`
- Create: `apps/web/src/server/punishments/issue.test.ts`

- [ ] **Step 1: Failing test `issue.test.ts`**

Contents:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { issue } from "./issue";

type Actor = { userId: string | null; roles: readonly string[] };

function mkSb() {
  const caseId = "case-1";
  const actionId = "action-1";

  const casesInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: caseId }, error: null }),
    })),
  }));
  const actionsInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: actionId }, error: null }),
    })),
  }));

  return {
    caseId,
    actionId,
    casesInsert,
    actionsInsert,
    client: {
      from: vi.fn((table: string) => {
        if (table === "disciplinary_cases") return { insert: casesInsert };
        if (table === "disciplinary_actions") return { insert: actionsInsert };
        if (table === "matches") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: "m1", home_player_id: "p-home", away_player_id: "p-away" },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === "match_results") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    },
  };
}

describe("issue", () => {
  const admin: Actor = { userId: "admin-1", roles: ["admin"] };
  const player: Actor = { userId: "p-1", roles: ["player"] };

  beforeEach(() => vi.resetAllMocks());

  it("rejects when actor lacks punishments.issue", async () => {
    const sb = mkSb();
    await expect(
      issue(sb.client as never, {
        actor: player,
        playerId: "p-1",
        incidentType: "other",
        sanctionType: "point_deduction",
        magnitude: 3,
      })
    ).rejects.toThrow(/permission/i);
  });

  it("writes a case row then an action row and returns both ids", async () => {
    const sb = mkSb();
    const r = await issue(sb.client as never, {
      actor: admin,
      playerId: "p-1",
      incidentType: "other",
      sanctionType: "point_deduction",
      magnitude: 3,
    });
    expect(sb.casesInsert).toHaveBeenCalledTimes(1);
    expect(sb.actionsInsert).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ caseId: sb.caseId, actionId: sb.actionId });
  });

  it("for sanctionType='forfeit' with matchId, writes match_results 3-0 against forfeiter", async () => {
    const sb = mkSb();
    await issue(sb.client as never, {
      actor: admin,
      playerId: "p-home",
      matchId: "m1",
      incidentType: "forfeit",
      sanctionType: "forfeit",
      magnitude: 0,
    });
    // one of the from() calls was on match_results with an upsert
    const calls = (sb.client.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain("match_results");
  });

  it("rejects magnitude > 0 for sanction_types that ignore magnitude", async () => {
    const sb = mkSb();
    await expect(
      issue(sb.client as never, {
        actor: admin,
        playerId: "p-1",
        incidentType: "other",
        sanctionType: "warning",
        magnitude: 5, // invalid for warning
      })
    ).rejects.toThrow(/magnitude/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `issue.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hasPerm, type Actor } from "@/perms";
import { applyForfeitMatchResult } from "./forfeit";

export const IssueInput = z.object({
  actor: z.object({
    userId: z.string().nullable(),
    roles: z.array(z.string()).readonly(),
  }),
  playerId: z.string().uuid(),
  matchId: z.string().uuid().optional(),
  incidentType: z.enum(["late_arrival", "forfeit", "equipment", "social_media", "other"]),
  sanctionType: z.enum(["warning", "point_deduction", "gd_deduction", "forfeit", "ban"]),
  magnitude: z.number().int().min(0).default(0),
  effectiveFrom: z.string().optional(),       // YYYY-MM-DD
  effectiveUntil: z.string().optional().nullable(),
  publicVisible: z.boolean().default(true),
  notes: z.string().optional().nullable(),
});

export type IssueInputT = z.infer<typeof IssueInput>;

const MAGNITUDE_REQUIRED = new Set(["point_deduction", "gd_deduction"]);

export async function issue(
  sb: SupabaseClient,
  raw: IssueInputT
): Promise<{ caseId: string; actionId: string }> {
  const input = IssueInput.parse(raw);

  if (!hasPerm(input.actor as Actor, "punishments.issue")) {
    throw new Error("permission denied: punishments.issue");
  }
  if (!input.actor.userId) {
    throw new Error("actor.userId required to impose a sanction");
  }

  // Magnitude validation: must be positive for deductions, 0 for others.
  if (MAGNITUDE_REQUIRED.has(input.sanctionType)) {
    if (input.magnitude <= 0) {
      throw new Error(`magnitude must be > 0 for ${input.sanctionType}`);
    }
  } else if (input.magnitude !== 0) {
    throw new Error(`magnitude must be 0 for ${input.sanctionType}`);
  }

  // 1) Create the case.
  const { data: caseRow, error: caseErr } = await sb
    .from("disciplinary_cases")
    .insert({
      player_id: input.playerId,
      match_id: input.matchId ?? null,
      incident_type: input.incidentType,
      reported_by: input.actor.userId,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (caseErr || !caseRow) throw new Error(caseErr?.message ?? "case insert failed");

  // 2) Create the action. The AFTER trigger will recompute standings.
  const { data: actionRow, error: actErr } = await sb
    .from("disciplinary_actions")
    .insert({
      case_id: caseRow.id,
      sanction_type: input.sanctionType,
      magnitude: input.magnitude,
      effective_from: input.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      effective_until: input.effectiveUntil ?? null,
      imposed_by: input.actor.userId,
      public_visible: input.publicVisible,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (actErr || !actionRow) throw new Error(actErr?.message ?? "action insert failed");

  // 3) Forfeit side-effect: write a 3-0 match result (server-side business logic,
  //    not a SQL trigger, because it involves looking up match home/away ids
  //    and deciding which side forfeited). The match_results trigger from Plan 3
  //    will then recompute standings a second time — both recomputes are idempotent
  //    so the end state is correct.
  if (input.sanctionType === "forfeit" && input.matchId) {
    await applyForfeitMatchResult(sb, {
      matchId: input.matchId,
      forfeitingPlayerId: input.playerId,
      enteredByUserId: input.actor.userId,
    });
  }

  return { caseId: caseRow.id, actionId: actionRow.id };
}
```

- [ ] **Step 4: Commit (tests still failing until Task 7 creates `forfeit.ts`)**

Skip commit here — commit in Task 7 once forfeit helper exists and tests pass.

---

## Task 7: Server module — forfeit helper (TDD)

**Files:**
- Create: `apps/web/src/server/punishments/forfeit.ts`
- Create: `apps/web/src/server/punishments/forfeit.test.ts`

- [ ] **Step 1: Failing test**

Contents:

```ts
import { describe, it, expect, vi } from "vitest";
import { applyForfeitMatchResult } from "./forfeit";

function mkSb(match: { home_player_id: string; away_player_id: string }) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const match_update = vi.fn().mockResolvedValue({ error: null });
  return {
    upsert,
    match_update,
    client: {
      from: vi.fn((table: string) => {
        if (table === "matches") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: "m1", ...match },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({ eq: match_update })),
          };
        }
        if (table === "match_results") {
          return { upsert };
        }
        throw new Error(`unexpected ${table}`);
      }),
    },
  };
}

describe("applyForfeitMatchResult", () => {
  it("sets 0-3 when home forfeits (away wins 3-0)", async () => {
    const sb = mkSb({ home_player_id: "ph", away_player_id: "pa" });
    await applyForfeitMatchResult(sb.client as never, {
      matchId: "m1",
      forfeitingPlayerId: "ph",
      enteredByUserId: "admin-1",
    });
    expect(sb.upsert).toHaveBeenCalledTimes(1);
    const payload = (sb.upsert.mock.calls[0] as unknown as [Record<string, unknown>, unknown])[0];
    expect(payload.home_score).toBe(0);
    expect(payload.away_score).toBe(3);
    expect(payload.result_type).toBe("forfeit");
  });

  it("sets 3-0 when away forfeits (home wins 3-0)", async () => {
    const sb = mkSb({ home_player_id: "ph", away_player_id: "pa" });
    await applyForfeitMatchResult(sb.client as never, {
      matchId: "m1",
      forfeitingPlayerId: "pa",
      enteredByUserId: "admin-1",
    });
    const payload = (sb.upsert.mock.calls[0] as unknown as [Record<string, unknown>, unknown])[0];
    expect(payload.home_score).toBe(3);
    expect(payload.away_score).toBe(0);
    expect(payload.result_type).toBe("forfeit");
  });

  it("throws when forfeiting player is not in the match", async () => {
    const sb = mkSb({ home_player_id: "ph", away_player_id: "pa" });
    await expect(
      applyForfeitMatchResult(sb.client as never, {
        matchId: "m1",
        forfeitingPlayerId: "stranger",
        enteredByUserId: "admin-1",
      })
    ).rejects.toThrow(/not a participant/i);
  });
});
```

- [ ] **Step 2: Implement `forfeit.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplyForfeitInput = {
  matchId: string;
  forfeitingPlayerId: string;
  enteredByUserId: string;
};

/**
 * Produce the canonical forfeit match result for a match:
 *   - 3-0 against the forfeiting player
 *   - result_type = 'forfeit'
 * Idempotent via match_results.match_id UNIQUE (on conflict update).
 * Calling this also fires Plan 3's match_results trigger → recompute_standings.
 */
export async function applyForfeitMatchResult(
  sb: SupabaseClient,
  input: ApplyForfeitInput
): Promise<void> {
  const { data: match, error } = await sb
    .from("matches")
    .select("id, home_player_id, away_player_id")
    .eq("id", input.matchId)
    .single();
  if (error || !match) {
    throw new Error(error?.message ?? `match not found: ${input.matchId}`);
  }

  const homeForfeits = match.home_player_id === input.forfeitingPlayerId;
  const awayForfeits = match.away_player_id === input.forfeitingPlayerId;
  if (!homeForfeits && !awayForfeits) {
    throw new Error(
      `player ${input.forfeitingPlayerId} is not a participant in match ${input.matchId}`
    );
  }

  const home_score = homeForfeits ? 0 : 3;
  const away_score = homeForfeits ? 3 : 0;

  const { error: upErr } = await sb.from("match_results").upsert(
    {
      match_id: input.matchId,
      home_score,
      away_score,
      result_type: "forfeit",
      entered_by: input.enteredByUserId,
      entered_at: new Date().toISOString(),
      notes: "Auto-generated by forfeit sanction",
    },
    { onConflict: "match_id" }
  );
  if (upErr) throw new Error(upErr.message);

  // Also mark the match itself as forfeited.
  const { error: mErr } = await sb
    .from("matches")
    .update({ status: "forfeited" })
    .eq("id", input.matchId);
  if (mErr) throw new Error(mErr.message);
}
```

- [ ] **Step 3: Run — all tests in issue.test.ts + forfeit.test.ts should PASS**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 4: Commit issue + forfeit together**

```bash
git add apps/web/src/server/punishments/issue.ts apps/web/src/server/punishments/issue.test.ts \
        apps/web/src/server/punishments/forfeit.ts apps/web/src/server/punishments/forfeit.test.ts
git commit -m "feat(punishments): issue() writes case + action; forfeit helper auto-sets 3-0"
```

---

## Task 8: Server module — `revoke` function (TDD)

**Files:**
- Create: `apps/web/src/server/punishments/revoke.ts`
- Create: `apps/web/src/server/punishments/revoke.test.ts`

- [ ] **Step 1: Failing test**

Contents:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { revoke } from "./revoke";

type Actor = { userId: string | null; roles: readonly string[] };

function mkSb() {
  const update = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));
  return {
    update,
    client: {
      from: vi.fn((table: string) => {
        if (table === "disciplinary_actions") return { update };
        throw new Error(`unexpected ${table}`);
      }),
    },
  };
}

describe("revoke", () => {
  const admin: Actor = { userId: "admin-1", roles: ["admin"] };
  const mod: Actor   = { userId: "mod-1",   roles: ["moderator"] };

  beforeEach(() => vi.resetAllMocks());

  it("rejects a moderator (only admin can revoke)", async () => {
    const sb = mkSb();
    await expect(
      revoke(sb.client as never, { actor: mod, actionId: "a1", reason: "mistake" })
    ).rejects.toThrow(/permission/i);
  });

  it("requires a non-empty reason", async () => {
    const sb = mkSb();
    await expect(
      revoke(sb.client as never, { actor: admin, actionId: "a1", reason: "" })
    ).rejects.toThrow(/reason/i);
  });

  it("admin revoke sets revoked_at + revoke_reason", async () => {
    const sb = mkSb();
    await revoke(sb.client as never, { actor: admin, actionId: "a1", reason: "error in entry" });
    expect(sb.update).toHaveBeenCalledTimes(1);
    const patch = (sb.update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(patch.revoked_at).toBeTruthy();
    expect(patch.revoke_reason).toBe("error in entry");
  });
});
```

- [ ] **Step 2: Implement `revoke.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hasPerm, type Actor } from "@/perms";

export const RevokeInput = z.object({
  actor: z.object({
    userId: z.string().nullable(),
    roles: z.array(z.string()).readonly(),
  }),
  actionId: z.string().uuid(),
  reason: z.string().min(1, "reason required"),
});

export type RevokeInputT = z.infer<typeof RevokeInput>;

export async function revoke(sb: SupabaseClient, raw: RevokeInputT): Promise<void> {
  const input = RevokeInput.parse(raw);

  if (!hasPerm(input.actor as Actor, "punishments.revoke")) {
    throw new Error("permission denied: punishments.revoke");
  }

  const { error } = await sb
    .from("disciplinary_actions")
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: input.reason,
    })
    .eq("id", input.actionId);
  if (error) throw new Error(error.message);
  // AFTER trigger on disciplinary_actions fires → recompute_standings.
}
```

- [ ] **Step 3: Run + commit**

```bash
npm --workspace apps/web run test
git add apps/web/src/server/punishments/revoke.ts apps/web/src/server/punishments/revoke.test.ts
git commit -m "feat(punishments): revoke() sets revoked_at + reason; admin-only gate"
```

---

## Task 9: Server module — `edit` function (TDD)

**Files:**
- Create: `apps/web/src/server/punishments/edit.ts`
- Create: `apps/web/src/server/punishments/edit.test.ts`

- [ ] **Step 1: Failing test**

Contents:

```ts
import { describe, it, expect, vi } from "vitest";
import { edit } from "./edit";

type Actor = { userId: string | null; roles: readonly string[] };

function mkSb() {
  const update = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));
  return {
    update,
    client: {
      from: vi.fn((table: string) => {
        if (table === "disciplinary_actions") return { update };
        throw new Error(`unexpected ${table}`);
      }),
    },
  };
}

describe("edit", () => {
  const admin: Actor = { userId: "admin-1", roles: ["admin"] };

  it("rejects when actor lacks punishments.edit", async () => {
    const sb = mkSb();
    const player: Actor = { userId: "p-1", roles: ["player"] };
    await expect(
      edit(sb.client as never, {
        actor: player,
        actionId: "a1",
        patch: { magnitude: 5 },
      })
    ).rejects.toThrow(/permission/i);
  });

  it("allows updating magnitude + effective_until + public_visible", async () => {
    const sb = mkSb();
    await edit(sb.client as never, {
      actor: admin,
      actionId: "a1",
      patch: { magnitude: 4, effectiveUntil: "2026-06-01", publicVisible: false },
    });
    expect(sb.update).toHaveBeenCalledTimes(1);
    const patch = (sb.update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(patch.magnitude).toBe(4);
    expect(patch.effective_until).toBe("2026-06-01");
    expect(patch.public_visible).toBe(false);
  });

  it("rejects empty patch", async () => {
    const sb = mkSb();
    await expect(
      edit(sb.client as never, { actor: admin, actionId: "a1", patch: {} })
    ).rejects.toThrow(/patch/i);
  });
});
```

- [ ] **Step 2: Implement `edit.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hasPerm, type Actor } from "@/perms";

export const EditInput = z.object({
  actor: z.object({
    userId: z.string().nullable(),
    roles: z.array(z.string()).readonly(),
  }),
  actionId: z.string().uuid(),
  patch: z.object({
    magnitude: z.number().int().min(0).optional(),
    effectiveFrom: z.string().optional(),
    effectiveUntil: z.string().nullable().optional(),
    publicVisible: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  }),
});

export type EditInputT = z.infer<typeof EditInput>;

export async function edit(sb: SupabaseClient, raw: EditInputT): Promise<void> {
  const input = EditInput.parse(raw);

  if (!hasPerm(input.actor as Actor, "punishments.edit")) {
    throw new Error("permission denied: punishments.edit");
  }

  const dbPatch: Record<string, unknown> = {};
  if (input.patch.magnitude !== undefined)       dbPatch.magnitude = input.patch.magnitude;
  if (input.patch.effectiveFrom !== undefined)   dbPatch.effective_from = input.patch.effectiveFrom;
  if (input.patch.effectiveUntil !== undefined)  dbPatch.effective_until = input.patch.effectiveUntil;
  if (input.patch.publicVisible !== undefined)   dbPatch.public_visible = input.patch.publicVisible;
  if (input.patch.notes !== undefined)           dbPatch.notes = input.patch.notes;

  if (Object.keys(dbPatch).length === 0) {
    throw new Error("patch must contain at least one field");
  }

  const { error } = await sb
    .from("disciplinary_actions")
    .update(dbPatch)
    .eq("id", input.actionId);
  if (error) throw new Error(error.message);
  // AFTER trigger handles recompute.
}
```

- [ ] **Step 3: Run + commit**

```bash
npm --workspace apps/web run test
git add apps/web/src/server/punishments/edit.ts apps/web/src/server/punishments/edit.test.ts
git commit -m "feat(punishments): edit() partial-updates an action and triggers recompute"
```

---

## Task 10: Server module — `listPublic` + `listForPlayer`

**Files:**
- Create: `apps/web/src/server/punishments/list-public.ts`
- Create: `apps/web/src/server/punishments/list-for-player.ts`

- [ ] **Step 1: Write `list-public.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type PublicPunishmentRow = {
  actionId: string;
  caseId: string;
  playerId: string;
  playerName: string;
  gamerTag: string | null;
  incidentType: string;
  sanctionType: string;
  magnitude: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  imposedAt: string;
  notes: string | null;
};

/**
 * Public-facing feed of current punishments, newest first.
 * Filters:
 *   - action.public_visible = true
 *   - action.revoked_at is null
 *   - action.deleted_at is null
 *   - case.deleted_at is null
 */
export async function listPublic(
  sb: SupabaseClient,
  opts: { limit?: number } = {}
): Promise<PublicPunishmentRow[]> {
  const limit = opts.limit ?? 50;

  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(`
      id,
      case_id,
      sanction_type,
      magnitude,
      effective_from,
      effective_until,
      imposed_at,
      notes,
      disciplinary_cases!inner (
        id,
        incident_type,
        deleted_at,
        players!inner ( id, gamer_tag, users!inner ( display_name ) )
      )
    `)
    .eq("public_visible", true)
    .is("revoked_at", null)
    .is("deleted_at", null)
    .is("disciplinary_cases.deleted_at", null)
    .order("imposed_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    actionId: row.id,
    caseId: row.case_id,
    playerId: row.disciplinary_cases.players.id,
    playerName: row.disciplinary_cases.players.users.display_name,
    gamerTag: row.disciplinary_cases.players.gamer_tag,
    incidentType: row.disciplinary_cases.incident_type,
    sanctionType: row.sanction_type,
    magnitude: row.magnitude,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    imposedAt: row.imposed_at,
    notes: row.notes,
  }));
}
```

- [ ] **Step 2: Write `list-for-player.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type PlayerPunishmentRow = {
  actionId: string;
  caseId: string;
  incidentType: string;
  sanctionType: string;
  magnitude: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  imposedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  publicVisible: boolean;
  notes: string | null;
};

/**
 * All non-soft-deleted actions for a given player (including revoked, for
 * the admin view). Public-facing player card should filter revoked/public_visible
 * at the UI layer using includeRevoked/publicOnly flags.
 */
export async function listForPlayer(
  sb: SupabaseClient,
  opts: { playerId: string; includeRevoked?: boolean; publicOnly?: boolean }
): Promise<PlayerPunishmentRow[]> {
  let q = sb
    .from("disciplinary_actions")
    .select(`
      id,
      case_id,
      sanction_type,
      magnitude,
      effective_from,
      effective_until,
      imposed_at,
      revoked_at,
      revoke_reason,
      public_visible,
      notes,
      disciplinary_cases!inner ( id, player_id, incident_type, deleted_at )
    `)
    .eq("disciplinary_cases.player_id", opts.playerId)
    .is("deleted_at", null)
    .is("disciplinary_cases.deleted_at", null)
    .order("imposed_at", { ascending: false });

  if (!opts.includeRevoked) q = q.is("revoked_at", null);
  if (opts.publicOnly)      q = q.eq("public_visible", true);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    actionId: row.id,
    caseId: row.case_id,
    incidentType: row.disciplinary_cases.incident_type,
    sanctionType: row.sanction_type,
    magnitude: row.magnitude,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    imposedAt: row.imposed_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    publicVisible: row.public_visible,
    notes: row.notes,
  }));
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/server/punishments/list-public.ts apps/web/src/server/punishments/list-for-player.ts
git commit -m "feat(punishments): listPublic + listForPlayer read-only server helpers"
```

---

## Task 11: Admin UI — `/admin/punishments/new` (issue form)

**Files:**
- Create: `apps/web/src/app/admin/punishments/new/page.tsx`
- Create: `apps/web/src/app/admin/punishments/actions.ts`

- [ ] **Step 1: Write Server Action `actions.ts`**

Contents:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActorFromSession } from "@/server/auth/actor";
import { issue } from "@/server/punishments/issue";
import { revoke } from "@/server/punishments/revoke";

async function resolveActor() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error("not authenticated");
  const { data: pub } = await sb
    .from("users").select("id").eq("supabase_auth_id", auth.user.id).single();
  if (!pub) throw new Error("user not provisioned");
  const actor = await getActorFromSession(sb, { userId: pub.id });
  if (!actor) throw new Error("actor resolution failed");
  return { sb, actor };
}

export async function issuePunishment(formData: FormData) {
  const { sb, actor } = await resolveActor();

  const magnitude = Number(formData.get("magnitude") ?? 0);
  const matchIdRaw = String(formData.get("matchId") ?? "").trim();
  const effectiveUntilRaw = String(formData.get("effectiveUntil") ?? "").trim();

  await issue(sb, {
    actor,
    playerId: String(formData.get("playerId")),
    matchId: matchIdRaw || undefined,
    incidentType: String(formData.get("incidentType")) as any,
    sanctionType: String(formData.get("sanctionType")) as any,
    magnitude,
    effectiveFrom: String(formData.get("effectiveFrom") || "") || undefined,
    effectiveUntil: effectiveUntilRaw || undefined,
    publicVisible: formData.get("publicVisible") === "on",
    notes: String(formData.get("notes") || "") || null,
  });

  revalidatePath("/admin/punishments");
  revalidatePath("/punishments");
  revalidatePath("/standings");
  redirect("/admin/punishments");
}

export async function revokePunishment(formData: FormData) {
  const { sb, actor } = await resolveActor();
  await revoke(sb, {
    actor,
    actionId: String(formData.get("actionId")),
    reason: String(formData.get("reason") || "admin_revoke"),
  });
  revalidatePath("/admin/punishments");
  revalidatePath("/punishments");
  revalidatePath("/standings");
}
```

- [ ] **Step 2: Write `new/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { issuePunishment } from "../actions";

export default async function NewPunishmentPage() {
  const sb = await getServerSupabase();
  const [{ data: players }, { data: matches }] = await Promise.all([
    sb.from("players").select("id, gamer_tag, users ( display_name )")
      .is("deleted_at", null).order("gamer_tag"),
    sb.from("matches").select("id, scheduled_time, home_player_id, away_player_id")
      .is("deleted_at", null).order("scheduled_time", { ascending: false }).limit(50),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-2xl font-bold">New punishment</h2>
      <form action={issuePunishment} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm">Player</span>
          <select name="playerId" required className="w-full border rounded px-3 py-2">
            {(players ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.users?.display_name ?? p.gamer_tag} ({p.gamer_tag})
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Incident type</span>
          <select name="incidentType" required className="w-full border rounded px-3 py-2">
            <option value="late_arrival">Late arrival</option>
            <option value="forfeit">Forfeit</option>
            <option value="equipment">Equipment</option>
            <option value="social_media">Social media</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Sanction</span>
          <select name="sanctionType" required className="w-full border rounded px-3 py-2">
            <option value="warning">Warning</option>
            <option value="point_deduction">Point deduction</option>
            <option value="gd_deduction">GD deduction</option>
            <option value="forfeit">Forfeit (auto 3-0)</option>
            <option value="ban">Ban</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Magnitude (points or GD; 0 for warning/ban/forfeit)</span>
          <input name="magnitude" type="number" min="0" defaultValue="0" className="w-full border rounded px-3 py-2" />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Linked match (optional; required for forfeit)</span>
          <select name="matchId" className="w-full border rounded px-3 py-2">
            <option value="">— none —</option>
            {(matches ?? []).map((m: any) => (
              <option key={m.id} value={m.id}>{m.id.slice(0, 8)} · {m.scheduled_time}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-sm">Effective from</span>
            <input name="effectiveFrom" type="date" className="w-full border rounded px-3 py-2" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm">Effective until (optional)</span>
            <input name="effectiveUntil" type="date" className="w-full border rounded px-3 py-2" />
          </label>
        </div>

        <label className="flex items-center gap-2">
          <input name="publicVisible" type="checkbox" defaultChecked />
          <span className="text-sm">Show on public punishments feed</span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Notes</span>
          <textarea name="notes" className="w-full border rounded px-3 py-2" rows={3}></textarea>
        </label>

        <button className="bg-black text-white rounded px-4 py-2" type="submit">Issue</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/admin/punishments/new/page.tsx apps/web/src/app/admin/punishments/actions.ts
git commit -m "feat(admin): /admin/punishments/new form + issue Server Action"
```

---

## Task 12: Admin UI — `/admin/punishments` (list + revoke)

**Files:**
- Create: `apps/web/src/app/admin/punishments/page.tsx`

- [ ] **Step 1: Write `page.tsx`**

Contents:

```tsx
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { revokePunishment } from "./actions";

export default async function PunishmentsAdminListPage({
  searchParams,
}: {
  searchParams: { player?: string; type?: string; revoked?: string };
}) {
  const sb = await getServerSupabase();

  let q = sb
    .from("disciplinary_actions")
    .select(`
      id, sanction_type, magnitude, imposed_at, revoked_at, revoke_reason, public_visible,
      disciplinary_cases!inner (
        id, incident_type, player_id, match_id, deleted_at,
        players!inner ( id, gamer_tag, users ( display_name ) )
      )
    `)
    .is("deleted_at", null)
    .is("disciplinary_cases.deleted_at", null)
    .order("imposed_at", { ascending: false })
    .limit(200);

  if (searchParams.player) q = q.eq("disciplinary_cases.player_id", searchParams.player);
  if (searchParams.type)   q = q.eq("sanction_type", searchParams.type);
  if (searchParams.revoked === "only")      q = q.not("revoked_at", "is", null);
  else if (searchParams.revoked === "hide") q = q.is("revoked_at", null);

  const { data } = await q;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Punishments</h2>
        <Link href="/admin/punishments/new" className="bg-black text-white rounded px-3 py-1.5 text-sm">
          New punishment
        </Link>
      </div>

      <form className="flex gap-2 text-sm" method="get">
        <select name="type" defaultValue={searchParams.type ?? ""} className="border rounded px-2 py-1">
          <option value="">All types</option>
          <option value="warning">Warning</option>
          <option value="point_deduction">Point deduction</option>
          <option value="gd_deduction">GD deduction</option>
          <option value="forfeit">Forfeit</option>
          <option value="ban">Ban</option>
        </select>
        <select name="revoked" defaultValue={searchParams.revoked ?? ""} className="border rounded px-2 py-1">
          <option value="">Active + revoked</option>
          <option value="hide">Active only</option>
          <option value="only">Revoked only</option>
        </select>
        <button className="border rounded px-3 py-1">Filter</button>
      </form>

      <table className="w-full text-sm border">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Imposed (WAT)</th>
            <th className="text-left p-2">Player</th>
            <th className="text-left p-2">Incident</th>
            <th className="text-left p-2">Sanction</th>
            <th className="text-left p-2">Mag</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((r: any) => {
            const revoked = Boolean(r.revoked_at);
            return (
              <tr key={r.id} className={"border-t " + (revoked ? "text-gray-400" : "")}>
                <td className="p-2">{formatWat(r.imposed_at, "yyyy-MM-dd HH:mm")}</td>
                <td className="p-2">
                  {r.disciplinary_cases.players.users?.display_name ?? r.disciplinary_cases.players.gamer_tag}
                </td>
                <td className="p-2">{r.disciplinary_cases.incident_type}</td>
                <td className="p-2">{r.sanction_type}</td>
                <td className="p-2">{r.magnitude}</td>
                <td className="p-2">{revoked ? `revoked (${r.revoke_reason})` : "active"}</td>
                <td className="p-2 space-x-3">
                  <Link href={`/admin/punishments/${r.id}`} className="underline">View</Link>
                  {!revoked ? (
                    <form action={revokePunishment} className="inline">
                      <input type="hidden" name="actionId" value={r.id} />
                      <input name="reason" placeholder="reason" className="border rounded px-1 py-0.5 text-xs mr-1" required />
                      <button className="text-red-600 underline" type="submit">Revoke</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/admin/punishments/page.tsx
git commit -m "feat(admin): /admin/punishments list with filters and inline revoke form"
```

---

## Task 13: Admin UI — `/admin/punishments/[id]` (detail)

**Files:**
- Create: `apps/web/src/app/admin/punishments/[id]/page.tsx`

- [ ] **Step 1: Write page**

Contents:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { revokePunishment } from "../actions";

export default async function PunishmentDetail({ params }: { params: { id: string } }) {
  const sb = await getServerSupabase();
  const { data } = await sb
    .from("disciplinary_actions")
    .select(`
      id, sanction_type, magnitude, effective_from, effective_until,
      imposed_at, imposed_by, revoked_at, revoke_reason, public_visible, notes,
      disciplinary_cases!inner (
        id, incident_type, match_id, reported_by, opened_at, status, notes,
        players!inner ( id, gamer_tag, users ( display_name ) )
      )
    `)
    .eq("id", params.id)
    .is("deleted_at", null)
    .single();

  if (!data) return notFound();

  const revoked = Boolean(data.revoked_at);

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/admin/punishments" className="text-sm underline">← Back to list</Link>
      <h2 className="text-2xl font-bold">Punishment detail</h2>

      <section className="border rounded p-4 space-y-2 text-sm">
        <div><b>Player:</b> {(data as any).disciplinary_cases.players.users?.display_name}</div>
        <div><b>Incident:</b> {(data as any).disciplinary_cases.incident_type}</div>
        <div><b>Sanction:</b> {data.sanction_type} ({data.magnitude})</div>
        <div><b>Effective:</b> {data.effective_from} → {data.effective_until ?? "indefinite"}</div>
        <div><b>Imposed:</b> {formatWat(data.imposed_at, "yyyy-MM-dd HH:mm")}</div>
        <div><b>Public visible:</b> {data.public_visible ? "yes" : "no"}</div>
        <div><b>Status:</b> {revoked ? `revoked — ${data.revoke_reason}` : "active"}</div>
        <div><b>Notes:</b> {data.notes ?? "—"}</div>
      </section>

      {!revoked ? (
        <form action={revokePunishment} className="space-y-2 border rounded p-4">
          <h3 className="font-semibold">Revoke</h3>
          <input type="hidden" name="actionId" value={data.id} />
          <input name="reason" placeholder="Reason (required)" required className="w-full border rounded px-3 py-2" />
          <button className="bg-red-600 text-white rounded px-3 py-1.5 text-sm" type="submit">Revoke punishment</button>
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/admin/punishments/[id]/page.tsx
git commit -m "feat(admin): /admin/punishments/[id] detail with revoke affordance"
```

---

## Task 14: Public UI — `/punishments` feed + player card section

**Files:**
- Create: `apps/web/src/app/punishments/page.tsx`
- Modify: `apps/web/src/app/players/[id]/page.tsx` (append punishments section)

- [ ] **Step 1: Write `/punishments/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { listPublic } from "@/server/punishments/list-public";
import { formatWat } from "@/lib/time";

export const revalidate = 60;

export default async function PublicPunishmentsPage() {
  const sb = await getServerSupabase();
  const rows = await listPublic(sb, { limit: 100 });

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Punishments</h1>
      <p className="text-sm text-gray-600">
        Disciplinary actions currently in force. Revoked items are hidden.
      </p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.actionId} className="border rounded p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{r.playerName} {r.gamerTag ? `(${r.gamerTag})` : ""}</div>
              <div className="text-xs text-gray-500">{formatWat(r.imposedAt, "yyyy-MM-dd")}</div>
            </div>
            <div className="text-sm text-gray-700 mt-1">
              <b>{r.sanctionType.replace("_", " ")}</b>
              {r.magnitude > 0 ? ` · ${r.magnitude}` : ""} — {r.incidentType.replace("_", " ")}
            </div>
            {r.notes ? <div className="text-sm mt-1">{r.notes}</div> : null}
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="text-sm text-gray-500">No active punishments.</li>
        ) : null}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Append section to `players/[id]/page.tsx`**

Find the closing `</main>` of the existing player profile page and insert before it:

```tsx
{/* Public punishments for this player */}
<section className="space-y-2 mt-8">
  <h2 className="text-xl font-semibold">Punishments</h2>
  {playerPunishments.length === 0 ? (
    <p className="text-sm text-gray-500">No active punishments.</p>
  ) : (
    <ul className="space-y-2">
      {playerPunishments.map((p) => (
        <li key={p.actionId} className="border rounded p-3 text-sm">
          <b>{p.sanctionType.replace("_", " ")}</b>
          {p.magnitude > 0 ? ` · ${p.magnitude}` : ""} — {p.incidentType.replace("_", " ")}
          {p.notes ? <div className="text-gray-600">{p.notes}</div> : null}
        </li>
      ))}
    </ul>
  )}
</section>
```

Add the data fetch near the top of that page's server component:

```tsx
import { listForPlayer } from "@/server/punishments/list-for-player";
/* ... existing imports ... */

const playerPunishments = await listForPlayer(sb, {
  playerId: params.id,
  includeRevoked: false,
  publicOnly: true,
});
```

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/punishments/page.tsx apps/web/src/app/players/[id]/page.tsx
git commit -m "feat(public): /punishments feed + player card punishments section"
```

---

## Task 15: E2E — issue + verify standings + revoke + verify restored

**Files:**
- Create: `apps/web/tests/e2e/punishments.spec.ts`

- [ ] **Step 1: Write E2E**

Contents:

```ts
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function login(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test("admin issues 3-point deduction → standings drop 3 → revoke restores", async ({ page, request }) => {
  await login(page);

  // Capture baseline standings row for the first seeded player.
  await page.goto("/standings");
  const firstRow = page.getByTestId("standings-row").first();
  await expect(firstRow).toBeVisible();
  const playerName = (await firstRow.getByTestId("standings-player-name").textContent())?.trim() ?? "";
  const baselinePoints = parseInt(
    (await firstRow.getByTestId("standings-points").textContent())?.trim() ?? "0",
    10
  );

  // Issue a 3-point deduction.
  await page.goto("/admin/punishments/new");
  await page.selectOption('select[name="playerId"]', { label: new RegExp(playerName) });
  await page.selectOption('select[name="incidentType"]', "other");
  await page.selectOption('select[name="sanctionType"]', "point_deduction");
  await page.fill('input[name="magnitude"]', "3");
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page).toHaveURL(/\/admin\/punishments$/);

  // Verify public /standings reflects the deduction.
  await page.goto("/standings");
  const rowAfter = page.locator('[data-testid="standings-row"]', {
    has: page.locator(`[data-testid="standings-player-name"]:text-is("${playerName}")`),
  }).first();
  const afterPoints = parseInt(
    (await rowAfter.getByTestId("standings-points").textContent())?.trim() ?? "0",
    10
  );
  expect(afterPoints).toBe(baselinePoints - 3);

  // Verify the /punishments feed shows the new item.
  await page.goto("/punishments");
  await expect(page.getByText(playerName).first()).toBeVisible();

  // Revoke it from the admin list.
  await page.goto("/admin/punishments");
  const revokeForm = page.locator("form").filter({ hasText: "Revoke" }).first();
  await revokeForm.locator('input[name="reason"]').fill("test revoke");
  await revokeForm.getByRole("button", { name: "Revoke" }).click();

  // Verify standings restored.
  await page.goto("/standings");
  const rowRestored = page.locator('[data-testid="standings-row"]', {
    has: page.locator(`[data-testid="standings-player-name"]:text-is("${playerName}")`),
  }).first();
  const restoredPoints = parseInt(
    (await rowRestored.getByTestId("standings-points").textContent())?.trim() ?? "0",
    10
  );
  expect(restoredPoints).toBe(baselinePoints);
});

test("forfeit sanction auto-writes 3-0 match result", async ({ page }) => {
  await login(page);
  await page.goto("/admin/punishments/new");

  // Pick any player + any match.
  const firstPlayer = await page.locator('select[name="playerId"] option').nth(1).getAttribute("value");
  const firstMatch  = await page.locator('select[name="matchId"]  option').nth(1).getAttribute("value");
  expect(firstPlayer).toBeTruthy();
  expect(firstMatch).toBeTruthy();

  await page.selectOption('select[name="playerId"]', firstPlayer!);
  await page.selectOption('select[name="matchId"]', firstMatch!);
  await page.selectOption('select[name="incidentType"]', "forfeit");
  await page.selectOption('select[name="sanctionType"]', "forfeit");
  await page.fill('input[name="magnitude"]', "0");
  await page.getByRole("button", { name: "Issue" }).click();

  // Verify fixtures page reflects forfeit status for that match.
  await page.goto("/fixtures");
  await expect(page.getByText(/forfeit/i).first()).toBeVisible();
});
```

Assumption: Plan 3's standings page emits `data-testid="standings-row"`, `standings-player-name`, `standings-points` on each row. If naming differs, update selectors here when Plan 3 lands.

- [ ] **Step 2: Run E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: 2 new tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/punishments.spec.ts
git commit -m "test(e2e): punishment issue → standings drop → revoke → standings restore; forfeit auto-result"
```

---

## Task 16: Final verification

- [ ] **Step 1: All migrations applied**

```bash
npm run db:push
```

Expected: `No schemas to push`.

- [ ] **Step 2: Unit tests**

```bash
npm run test
```

Expected: all prior tests still pass + new ones from Tasks 6/7/8/9 (count depends on prior plans; Plan 4 adds ~12 new tests).

- [ ] **Step 3: Idempotency check — revoke + re-issue round trip**

```bash
# Seed script: issue → snapshot standings → revoke → re-issue → snapshot again → diff should be empty.
npx --yes supabase db query "
  with before as (select * from public.standings order by player_id),
  -- simulate: issue a 3-pt deduction, revoke it, issue again identical
  actions as (
    select public.recompute_standings((select id from public.seasons limit 1))
  )
  select 'ok'
" --linked --output table
```

Alternatively add a Vitest integration test that seeds a real Postgres, runs issue→snapshot→revoke→issue→snapshot, and asserts `deepEqual`.

- [ ] **Step 4: Lint + build**

```bash
npm run lint && npm run build
```

Expected: both clean.

- [ ] **Step 5: E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: all prior E2E tests green + 2 new punishment tests.

- [ ] **Step 6: Audit entries exist for the new tables**

```bash
npx --yes supabase db query "select entity_type, action, count(*) from public.audit_events where entity_type in ('disciplinary_cases','disciplinary_actions') group by 1,2" --linked --output table
```

Expected: at least `disciplinary_cases insert`, `disciplinary_actions insert`, `disciplinary_actions update` (revoke path) rows.

- [ ] **Step 7: Update `tasks/todo.md`**

```markdown
## Done
- Plan 4 — Punishments complete (2026-04-XX). All 16 tasks green.
  - 4 migration files applied (cases, actions, recompute supersede, trigger)
  - Server module: issue, edit, revoke, listPublic, listForPlayer, forfeit helper
  - Admin UI: new / list / detail with revoke
  - Public UI: /punishments feed + player card section
  - E2E: issue→verify→revoke→restore + forfeit auto-3-0
  - Idempotency verified via revoke + re-issue round-trip
```

- [ ] **Step 8: Commit verification**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): Plan 4 complete"
```

---

## Out of Scope for Plan 4

- Phase 1B late-arrival ladder (Rule 5.4): Phase 1A uses flat magnitudes set by the admin at issue time. Automated ladder lookups from attendance marks are Plan 5 (attendance) + Phase 1B.
- Appeal / dispute workflow (Phase 2).
- Multi-season punishment scoping (Phase 1A has single season; migration is multi-season-safe via `season_participants` join in the trigger).
- Auto-closing `disciplinary_cases.status` when all actions on a case are revoked or expired (Phase 1B — cron job).
- Email/WhatsApp notifications on punishment issued (Phase 5 — announcements system).
- Bulk import of historical punishments (one-off admin script, not Phase 1A).
- Bulk revoke ("revoke all in past month") — single-item revoke only for now.
- Public-facing "appeal" form on `/punishments` (Phase 2).

---

## Review / Acceptance Criteria

Plan 4 is done when:

1. `git log --oneline` shows ~16 commits (one per task).
2. All unit + E2E tests green.
3. Admin can issue a point_deduction via `/admin/punishments/new` → public `/standings` shows a lower points total for that player within one page reload.
4. Admin can revoke that punishment via `/admin/punishments` → public `/standings` restores to the exact pre-issue points total (idempotency verified).
5. Admin can issue a `forfeit` sanction linked to a match → `/fixtures` reflects `forfeited` status → `match_results` row exists with 3-0 against the forfeiting player → standings reflect the loss.
6. `disciplinary_actions` UPDATE (revoke) correctly fires the AFTER trigger and re-materializes `standings` for the season.
7. `/punishments` public feed shows only rows where `public_visible=true AND revoked_at IS NULL AND deleted_at IS NULL`; player card shows same set scoped to that player.
8. `audit_events` contains an insert row per case + per action and an update row per revoke.
9. Moderator can issue + edit punishments but gets a 403 on revoke (perm check proven by unit test).
10. Re-issuing an identical punishment after revoking it yields `standings` byte-identical to the original state (round-trip idempotency).
