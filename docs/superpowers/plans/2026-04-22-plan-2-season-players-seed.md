# Plan 2 — Season + Players + Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the fixed-season data layer for **Division 1 Elite 2025-2026** (one `seasons` row hard-coded) and the 13-player roster scaffolding (`players` extending `public.users`, plus a `season_participants` join table), and ship the two public read-only pages `/players` and `/players/[id]` that render roster information server-side.

**Architecture:** Three Supabase migrations create `seasons`, `players`, `season_participants`. `players` is a one-to-one extension of `public.users` (created by Plan 1's `handle_new_auth_user` trigger) and is the only table in this plan with RLS enabled (PII host — NIN/bank land here in Phase 1B). `seasons` and `season_participants` have no RLS because they hold no PII and public routes need direct server read. The single Elite 2025-2026 season row is inserted at the end of the seasons migration so every environment has the row deterministically. `supabase/seed.sql` is a template that creates 13 `auth.users` via direct SQL (relying on Plan 1's mirror trigger to populate `public.users`) then inserts `players` + `season_participants` rows — all keyed off placeholder emails `player01..player13@cade.local` with TODO markers the user replaces before the real seed run. The public UI consists of two Next.js RSC pages under `apps/web/src/app/players/` that read through a thin server module `apps/web/src/server/players/`.

**Tech Stack:** Next.js 15 RSC, `@supabase/ssr` server client (already wired in Plan 0), Supabase CLI `db push`, audit trigger from Plan 0, auth schema from Plan 1.

**Prerequisites:**
- Plan 0 complete: `public.attach_audit()`, `audit_events`, timezone util, perms helper, supabase server client.
- Plan 1 complete: `public.users`, `public.user_roles`, `public.sessions`, `public.auth_events` in cloud, `handle_new_auth_user` trigger live on `auth.users`, RLS on `public.users`.
- `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`.
- `npm run db:push` already configured (Plan 1).
- Plan 1's dashboard-seeded `admin@cade.local` exists (not required by this plan but handy for manual verification).

**Shippable at end of Plan 2:**
- `public.seasons` has exactly one row: `Elite 2025-2026`, `status='active'`.
- `public.players` + `public.season_participants` tables exist, audited, with `players` RLS-gated.
- `supabase/seed.sql` is a ready-to-customize template that, when run against a fresh cloud DB with the user's real roster filled in, creates 13 auth users → 13 public.users (via trigger) → 13 players → 13 season_participants.
- `/players` renders a grid of 13 placeholder cards (or real roster once seed filled) showing avatar placeholder, display name, jersey number, gamer tag.
- `/players/[id]` renders a single player's profile card (no stats yet — those land in Plan 3+).
- Unit tests cover the season + player server module read helpers.
- `npm run lint && npm run test && npm run build` all clean.

---

## File Structure (delta over Plan 1)

Created by this plan:

```
apps/web/src/
├── app/
│   └── players/
│       ├── page.tsx                              # Public roster grid
│       ├── loading.tsx                           # Skeleton grid while RSC streams
│       └── [id]/
│           └── page.tsx                          # Public player profile
├── server/
│   ├── seasons/
│   │   ├── index.ts                              # getActiveSeason, getSeasonById
│   │   └── index.test.ts
│   └── players/
│       ├── index.ts                              # listPlayersInActiveSeason, getPlayerById
│       ├── index.test.ts
│       └── types.ts                              # Player, SeasonParticipant view types
└── components/
    └── players/
        ├── PlayerCard.tsx                        # Grid tile
        └── PlayerAvatar.tsx                      # Photo-or-initials fallback

supabase/
├── migrations/
│   ├── 20260422000001_seasons.sql
│   ├── 20260422000002_players.sql
│   └── 20260422000003_season_participants.sql
└── seed.sql                                      # 13-player roster TEMPLATE
```

Modified:
- `apps/web/src/app/layout.tsx` — add a minimal public nav linking to `/players` (one-line change).

---

## Task 1: Migration — `seasons` table + hard-coded Elite 2025-2026 row

**Files:**
- Create: `supabase/migrations/20260422000001_seasons.sql`

- [ ] **Step 1: Write the migration**

Contents of `supabase/migrations/20260422000001_seasons.sql`:

```sql
-- Phase 1A hard-codes a single season: Division 1 Elite 2025-2026.
-- Multi-season abstraction is a Phase 1B non-goal (spec §16).
-- No RLS: this table holds no PII and public routes read it server-side
-- via the anon key. Business logic gates writes (admin-only) at the API layer.

create table public.seasons (
  id              uuid primary key default gen_random_uuid(),
  year_range      text not null unique,
  division_name   text not null,
  start_date      date not null,
  end_date        date not null,
  status          text not null
                    check (status in ('upcoming','active','completed','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index seasons_status_idx
  on public.seasons (status)
  where deleted_at is null;

select public.attach_audit('public.seasons');

-- Hard-coded Elite 2025-2026 season row.
-- year_range is unique, so re-running this migration on an existing DB is a no-op.
insert into public.seasons (year_range, division_name, start_date, end_date, status)
values ('2025-2026', 'Division 1 Elite', '2025-09-01', '2026-06-30', 'active')
on conflict (year_range) do nothing;
```

- [ ] **Step 2: Push the migration**

```bash
npm run db:push
```

Expected output:

```
Applying migration 20260422000001_seasons.sql...
Finished supabase db push.
```

- [ ] **Step 3: Verify the row exists**

```bash
npx --yes supabase db query "select year_range, division_name, status from public.seasons" --linked --output table
```

Expected: one row — `2025-2026 | Division 1 Elite | active`.

- [ ] **Step 4: Verify audit captured the insert**

```bash
npx --yes supabase db query "select action, entity_type from public.audit_events where entity_type='seasons'" --linked --output table
```

Expected: one `insert` row for `seasons` (actor null because the migration runs without a request context).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260422000001_seasons.sql
git commit -m "feat(db): seasons table + Elite 2025-2026 hard-coded row"
```

---

## Task 2: Migration — `players` table with RLS

**Files:**
- Create: `supabase/migrations/20260422000002_players.sql`

- [ ] **Step 1: Write the migration**

Contents of `supabase/migrations/20260422000002_players.sql`:

```sql
-- players extends public.users with competition-specific attributes.
-- One players row per users row (user_id is UNIQUE).
-- RLS enabled: this is a PII host for the Phase 1B NIN/bank columns.
-- For Phase 1A, only non-sensitive columns live here — but we turn on RLS
-- now so we never forget later.

create table public.players (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references public.users (id) on delete cascade,
  gamer_tag       text not null,
  psn_id          text,
  jersey_number   int check (jersey_number between 1 and 99),
  photo_url       text,
  bio             text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index players_user_idx         on public.players (user_id)       where deleted_at is null;
create index players_gamer_tag_idx    on public.players (gamer_tag)     where deleted_at is null;
create index players_jersey_idx       on public.players (jersey_number) where deleted_at is null;

select public.attach_audit('public.players');

-- RLS policies
alter table public.players enable row level security;

-- Anyone (including anon) can read non-deleted players. Public pages rely on this.
create policy players_public_read
  on public.players for select
  using (deleted_at is null);

-- A user can read their own deleted row (useful for restore UI later).
create policy players_self_read_any
  on public.players for select
  using (
    exists (
      select 1 from public.users u
      where u.id = players.user_id
        and u.supabase_auth_id = auth.uid()
    )
  );

-- A user can update their own profile fields (bio, photo_url, gamer_tag, psn_id).
-- Jersey number changes require an admin (server uses service role which bypasses RLS).
create policy players_self_update
  on public.players for update
  using (
    exists (
      select 1 from public.users u
      where u.id = players.user_id
        and u.supabase_auth_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = players.user_id
        and u.supabase_auth_id = auth.uid()
    )
  );

-- INSERT and DELETE are server-managed only (service role bypasses RLS).
create policy players_no_direct_insert
  on public.players for insert
  with check (false);

create policy players_no_direct_delete
  on public.players for delete
  using (false);
```

- [ ] **Step 2: Push**

```bash
npm run db:push
```

Expected:

```
Applying migration 20260422000002_players.sql...
Finished supabase db push.
```

- [ ] **Step 3: Verify RLS is on and column shape is correct**

```bash
npx --yes supabase db query "select relrowsecurity from pg_class where oid='public.players'::regclass" --linked --output table
```

Expected: `true`.

```bash
npx --yes supabase db query "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='players' order by ordinal_position" --linked --output table
```

Expected: 10 columns in order `id, user_id, gamer_tag, psn_id, jersey_number, photo_url, bio, created_at, updated_at, deleted_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260422000002_players.sql
git commit -m "feat(db): players table (extends users) with RLS + audit"
```

---

## Task 3: Migration — `season_participants` join table

**Files:**
- Create: `supabase/migrations/20260422000003_season_participants.sql`

- [ ] **Step 1: Write the migration**

Contents of `supabase/migrations/20260422000003_season_participants.sql`:

```sql
-- Link table: which players are in which season.
-- For Phase 1A this is effectively (season_id = Elite 2025-2026) × 13 rows,
-- but the table shape supports multiple seasons in later phases.
-- No RLS: no PII, public routes read directly.

create table public.season_participants (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid not null references public.seasons (id) on delete cascade,
  player_id       uuid not null references public.players (id) on delete cascade,
  entry_status    text not null default 'confirmed'
                    check (entry_status in ('invited','confirmed','withdrawn','disqualified')),
  registered_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (season_id, player_id)
);

create index season_participants_season_idx
  on public.season_participants (season_id)
  where deleted_at is null;

create index season_participants_player_idx
  on public.season_participants (player_id)
  where deleted_at is null;

create index season_participants_active_idx
  on public.season_participants (season_id, entry_status)
  where deleted_at is null and entry_status = 'confirmed';

select public.attach_audit('public.season_participants');
```

- [ ] **Step 2: Push**

```bash
npm run db:push
```

Expected:

```
Applying migration 20260422000003_season_participants.sql...
Finished supabase db push.
```

- [ ] **Step 3: Verify**

```bash
npx --yes supabase db query "select column_name from information_schema.columns where table_schema='public' and table_name='season_participants' order by ordinal_position" --linked --output table
```

Expected: 9 columns in the order declared above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260422000003_season_participants.sql
git commit -m "feat(db): season_participants join table + audit"
```

---

## Task 4: Seasons server module — TDD

**Files:**
- Create: `apps/web/src/server/seasons/index.ts`
- Create: `apps/web/src/server/seasons/index.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `apps/web/src/server/seasons/index.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getActiveSeason, getSeasonById } from "./index";

function sbWith(data: unknown, error: unknown = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data, error }),
          })),
          maybeSingle: vi.fn().mockResolvedValue({ data, error }),
        })),
      })),
    })),
  };
}

describe("seasons module", () => {
  it("getActiveSeason returns the single active season row", async () => {
    const row = {
      id: "season-1",
      year_range: "2025-2026",
      division_name: "Division 1 Elite",
      status: "active",
    };
    const sb = sbWith(row);
    const result = await getActiveSeason(sb as never);
    expect(result).toEqual(row);
    expect(sb.from).toHaveBeenCalledWith("seasons");
  });

  it("getActiveSeason returns null when no active season", async () => {
    const sb = sbWith(null);
    const result = await getActiveSeason(sb as never);
    expect(result).toBeNull();
  });

  it("getSeasonById looks up by id", async () => {
    const row = {
      id: "season-7",
      year_range: "2025-2026",
      division_name: "Division 1 Elite",
      status: "active",
    };
    const sb = sbWith(row);
    const result = await getSeasonById(sb as never, "season-7");
    expect(result).toEqual(row);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
npm --workspace apps/web run test
```

Expected: compile error "Cannot find module './index'".

- [ ] **Step 3: Implement `apps/web/src/server/seasons/index.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type Season = {
  id: string;
  year_range: string;
  division_name: string;
  start_date: string;
  end_date: string;
  status: "upcoming" | "active" | "completed" | "archived";
};

const COLUMNS = "id, year_range, division_name, start_date, end_date, status";

/**
 * Returns the single active season, or null. Phase 1A always has exactly
 * one active season (Elite 2025-2026) seeded by migration.
 */
export async function getActiveSeason(sb: SupabaseClient): Promise<Season | null> {
  const { data, error } = await sb
    .from("seasons")
    .select(COLUMNS)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Season | null) ?? null;
}

export async function getSeasonById(
  sb: SupabaseClient,
  id: string
): Promise<Season | null> {
  const { data, error } = await sb
    .from("seasons")
    .select(COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Season | null) ?? null;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 3 new tests pass (plus prior Plan 0 + Plan 1 tests remain green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/seasons
git commit -m "feat(seasons): getActiveSeason + getSeasonById server helpers"
```

---

## Task 5: Players view types + server module — TDD

**Files:**
- Create: `apps/web/src/server/players/types.ts`
- Create: `apps/web/src/server/players/index.ts`
- Create: `apps/web/src/server/players/index.test.ts`

- [ ] **Step 1: Write `types.ts`**

Contents of `apps/web/src/server/players/types.ts`:

```ts
/**
 * Public-facing view of a player for roster cards + profile pages.
 * Joins public.players + public.users so callers never need to know
 * the underlying two-table layout.
 */
export type PlayerView = {
  id: string;                    // players.id
  user_id: string;               // users.id
  display_name: string;          // users.display_name
  gamer_tag: string;             // players.gamer_tag
  psn_id: string | null;
  jersey_number: number | null;
  photo_url: string | null;
  bio: string | null;
  entry_status: "invited" | "confirmed" | "withdrawn" | "disqualified";
};
```

- [ ] **Step 2: Write the failing test `apps/web/src/server/players/index.test.ts`**

Contents:

```ts
import { describe, it, expect, vi } from "vitest";
import { listPlayersInActiveSeason, getPlayerById } from "./index";

const seasonRow = {
  id: "season-1",
  year_range: "2025-2026",
  division_name: "Division 1 Elite",
  status: "active",
  start_date: "2025-09-01",
  end_date: "2026-06-30",
};

const joinRows = [
  {
    entry_status: "confirmed",
    players: {
      id: "p1",
      user_id: "u1",
      gamer_tag: "ACE_Spek",
      psn_id: "spek_01",
      jersey_number: 10,
      photo_url: null,
      bio: null,
      users: { id: "u1", display_name: "Spektakula" },
    },
  },
  {
    entry_status: "confirmed",
    players: {
      id: "p2",
      user_id: "u2",
      gamer_tag: "KINGZ_kb",
      psn_id: "kb_keeper",
      jersey_number: 1,
      photo_url: "https://example.com/kb.jpg",
      bio: "Keeper",
      users: { id: "u2", display_name: "KB" },
    },
  },
];

function mockSb({
  season,
  participants,
  single,
}: {
  season?: typeof seasonRow | null;
  participants?: typeof joinRows;
  single?: typeof joinRows[number]["players"] & { users: { id: string; display_name: string } };
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "seasons") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: season ?? null, error: null }),
              })),
            })),
          })),
        };
      }
      if (table === "season_participants") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({ data: participants ?? [], error: null }),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "players") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: single ?? null, error: null }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("players module", () => {
  it("listPlayersInActiveSeason returns flattened PlayerView rows", async () => {
    const sb = mockSb({ season: seasonRow, participants: joinRows });
    const result = await listPlayersInActiveSeason(sb as never);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "p1",
      user_id: "u1",
      display_name: "Spektakula",
      gamer_tag: "ACE_Spek",
      jersey_number: 10,
      entry_status: "confirmed",
    });
    expect(result[1].display_name).toBe("KB");
  });

  it("listPlayersInActiveSeason returns [] when no active season", async () => {
    const sb = mockSb({ season: null });
    const result = await listPlayersInActiveSeason(sb as never);
    expect(result).toEqual([]);
  });

  it("getPlayerById returns a single PlayerView", async () => {
    const sb = mockSb({
      single: {
        id: "p1",
        user_id: "u1",
        gamer_tag: "ACE_Spek",
        psn_id: "spek_01",
        jersey_number: 10,
        photo_url: null,
        bio: "Forward",
        users: { id: "u1", display_name: "Spektakula" },
      },
    });
    const result = await getPlayerById(sb as never, "p1");
    expect(result).toMatchObject({
      id: "p1",
      display_name: "Spektakula",
      gamer_tag: "ACE_Spek",
      bio: "Forward",
    });
  });

  it("getPlayerById returns null when not found", async () => {
    const sb = mockSb({ single: undefined });
    const result = await getPlayerById(sb as never, "missing");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

Expected: compile error for `./index`.

- [ ] **Step 4: Implement `apps/web/src/server/players/index.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerView } from "./types";
import { getActiveSeason } from "@/server/seasons";

/**
 * All confirmed players in the currently active season, ordered by jersey
 * number (nulls last) then display_name. Safe to call from RSC on /players.
 */
export async function listPlayersInActiveSeason(
  sb: SupabaseClient
): Promise<PlayerView[]> {
  const season = await getActiveSeason(sb);
  if (!season) return [];

  const { data, error } = await sb
    .from("season_participants")
    .select(
      `
      entry_status,
      players!inner (
        id, user_id, gamer_tag, psn_id, jersey_number, photo_url, bio,
        users!inner ( id, display_name )
      )
      `
    )
    .eq("season_id", season.id)
    .eq("entry_status", "confirmed")
    .is("deleted_at", null)
    .order("registered_at", { ascending: true });
  if (error) throw error;

  type Row = {
    entry_status: PlayerView["entry_status"];
    players: {
      id: string;
      user_id: string;
      gamer_tag: string;
      psn_id: string | null;
      jersey_number: number | null;
      photo_url: string | null;
      bio: string | null;
      users: { id: string; display_name: string };
    };
  };

  const rows = ((data ?? []) as unknown as Row[]).map<PlayerView>((r) => ({
    id: r.players.id,
    user_id: r.players.user_id,
    display_name: r.players.users.display_name,
    gamer_tag: r.players.gamer_tag,
    psn_id: r.players.psn_id,
    jersey_number: r.players.jersey_number,
    photo_url: r.players.photo_url,
    bio: r.players.bio,
    entry_status: r.entry_status,
  }));

  // In-memory sort: jersey number asc (nulls last), then name.
  return rows.sort((a, b) => {
    const aj = a.jersey_number ?? Number.POSITIVE_INFINITY;
    const bj = b.jersey_number ?? Number.POSITIVE_INFINITY;
    if (aj !== bj) return aj - bj;
    return a.display_name.localeCompare(b.display_name);
  });
}

/**
 * Single player profile view. Returns null when the row is missing or soft-deleted.
 */
export async function getPlayerById(
  sb: SupabaseClient,
  playerId: string
): Promise<PlayerView | null> {
  const { data, error } = await sb
    .from("players")
    .select(
      `
      id, user_id, gamer_tag, psn_id, jersey_number, photo_url, bio,
      users!inner ( id, display_name )
      `
    )
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  type Row = {
    id: string;
    user_id: string;
    gamer_tag: string;
    psn_id: string | null;
    jersey_number: number | null;
    photo_url: string | null;
    bio: string | null;
    users: { id: string; display_name: string };
  };

  const row = data as unknown as Row;
  return {
    id: row.id,
    user_id: row.user_id,
    display_name: row.users.display_name,
    gamer_tag: row.gamer_tag,
    psn_id: row.psn_id,
    jersey_number: row.jersey_number,
    photo_url: row.photo_url,
    bio: row.bio,
    entry_status: "confirmed",
  };
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 4 new tests pass. All prior tests still green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/players
git commit -m "feat(players): listPlayersInActiveSeason + getPlayerById server module"
```

---

## Task 6: PlayerAvatar + PlayerCard components

**Files:**
- Create: `apps/web/src/components/players/PlayerAvatar.tsx`
- Create: `apps/web/src/components/players/PlayerCard.tsx`

- [ ] **Step 1: Write `PlayerAvatar.tsx`**

Contents of `apps/web/src/components/players/PlayerAvatar.tsx`:

```tsx
import Image from "next/image";

type Props = {
  photoUrl: string | null;
  displayName: string;
  size?: number;
};

/**
 * Square avatar. Shows Image when photo_url is set, else a neutral tile
 * with 1-2 initials derived from display_name. Deliberately avoids
 * external dependencies — we can swap for shadcn/ui Avatar later.
 */
export function PlayerAvatar({ photoUrl, displayName, size = 96 }: Props) {
  if (photoUrl) {
    return (
      <Image
        src={photoUrl}
        alt={displayName}
        width={size}
        height={size}
        className="rounded-lg object-cover bg-slate-100"
      />
    );
  }

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-lg bg-slate-200 flex items-center justify-center text-slate-600 font-semibold"
      aria-label={`${displayName} avatar placeholder`}
    >
      <span style={{ fontSize: size / 3 }}>{initials || "?"}</span>
    </div>
  );
}
```

- [ ] **Step 2: Write `PlayerCard.tsx`**

Contents of `apps/web/src/components/players/PlayerCard.tsx`:

```tsx
import Link from "next/link";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PlayerView } from "@/server/players/types";

export function PlayerCard({ player }: { player: PlayerView }) {
  return (
    <Link
      href={`/players/${player.id}`}
      className="block rounded-xl border bg-white p-4 hover:shadow-md transition"
      data-testid="player-card"
    >
      <div className="flex items-start gap-4">
        <PlayerAvatar photoUrl={player.photo_url} displayName={player.display_name} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold truncate">{player.display_name}</h3>
            {player.jersey_number != null ? (
              <span className="text-sm text-slate-500">#{player.jersey_number}</span>
            ) : null}
          </div>
          <p className="text-sm text-slate-600 truncate">{player.gamer_tag}</p>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles without type errors. (Unused components are fine — the pages in Task 7 consume them.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/players
git commit -m "feat(ui): PlayerCard + PlayerAvatar components with initials fallback"
```

---

## Task 7: Public `/players` roster page

**Files:**
- Create: `apps/web/src/app/players/page.tsx`
- Create: `apps/web/src/app/players/loading.tsx`
- Modify: `apps/web/src/app/layout.tsx` (add a nav link)

- [ ] **Step 1: Write `apps/web/src/app/players/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { listPlayersInActiveSeason } from "@/server/players";
import { getActiveSeason } from "@/server/seasons";
import { PlayerCard } from "@/components/players/PlayerCard";

export const revalidate = 60; // ISR per spec §12

export default async function PlayersPage() {
  const sb = await getServerSupabase();
  const [season, players] = await Promise.all([
    getActiveSeason(sb),
    listPlayersInActiveSeason(sb),
  ]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <header className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-slate-500">
          {season ? `${season.division_name} · ${season.year_range}` : "Roster"}
        </p>
        <h1 className="text-3xl font-bold">Players</h1>
      </header>

      {players.length === 0 ? (
        <p className="text-slate-600" data-testid="players-empty">
          No players registered yet.
        </p>
      ) : (
        <section
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="players-grid"
        >
          {players.map((p) => (
            <PlayerCard key={p.id} player={p} />
          ))}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/app/players/loading.tsx`**

Contents:

```tsx
export default function PlayersLoading() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <div className="h-10 w-48 bg-slate-200 rounded animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl border bg-white p-4 animate-pulse" />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Modify `apps/web/src/app/layout.tsx` to add a nav link**

Locate the root `<body>` element in `apps/web/src/app/layout.tsx`. Immediately inside the body tag, before `{children}`, insert:

```tsx
<nav className="border-b bg-white px-6 py-3">
  <div className="max-w-6xl mx-auto flex items-center gap-6 text-sm">
    <a href="/" className="font-semibold">CADE League</a>
    <a href="/players" className="text-slate-600 hover:text-slate-900">Players</a>
  </div>
</nav>
```

If `layout.tsx` does not already wrap content in a fragment or div, keep the existing structure — only the `<nav>` is added.

- [ ] **Step 4: Build**

```bash
npm --workspace apps/web run build
```

Expected: `/players` listed as a dynamic/static route. No type errors.

- [ ] **Step 5: Manual smoke (optional)**

```bash
npm run dev
```

Navigate to `http://localhost:3000/players`. With an empty DB (seed not yet run) expect the "No players registered yet." empty state.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/players/page.tsx apps/web/src/app/players/loading.tsx apps/web/src/app/layout.tsx
git commit -m "feat(web): public /players roster grid with ISR + loading skeleton"
```

---

## Task 8: Public `/players/[id]` profile page

**Files:**
- Create: `apps/web/src/app/players/[id]/page.tsx`

- [ ] **Step 1: Write the page**

Contents of `apps/web/src/app/players/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getPlayerById } from "@/server/players";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";

export const revalidate = 60;

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const player = await getPlayerById(sb, id);
  if (!player) notFound();

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <Link href="/players" className="text-sm text-slate-500 hover:underline">
        ← Back to roster
      </Link>

      <header className="flex items-start gap-6">
        <PlayerAvatar
          photoUrl={player.photo_url}
          displayName={player.display_name}
          size={128}
        />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{player.display_name}</h1>
          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            {player.jersey_number != null ? (
              <span className="px-2 py-1 rounded bg-slate-100">#{player.jersey_number}</span>
            ) : null}
            <span className="px-2 py-1 rounded bg-slate-100">Gamer tag: {player.gamer_tag}</span>
            {player.psn_id ? (
              <span className="px-2 py-1 rounded bg-slate-100">PSN: {player.psn_id}</span>
            ) : null}
          </div>
        </div>
      </header>

      {player.bio ? (
        <section className="prose max-w-none">
          <h2 className="text-lg font-semibold">Bio</h2>
          <p className="text-slate-700 whitespace-pre-line">{player.bio}</p>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">Season stats</h2>
        <p className="text-slate-500 text-sm">Stats appear once matches begin (Plan 3+).</p>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm --workspace apps/web run build
```

Expected: dynamic route `/players/[id]` registered.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/players/[id]
git commit -m "feat(web): public /players/[id] profile page with stats placeholder"
```

---

## Task 9: `supabase/seed.sql` — 13-player roster TEMPLATE

**Files:**
- Create: `supabase/seed.sql`

This seed file is idempotent-ish (safe to re-run on a fresh or partially-seeded DB) and is a TEMPLATE: the 13 placeholder entries must be replaced with real roster data before being run in production. The migration in Task 1 already inserts the season row; this file only adds auth users + players + participants.

The file creates `auth.users` rows directly via SQL. The `handle_new_auth_user` trigger from Plan 1 populates `public.users` automatically. We then insert matching `public.players` and `public.season_participants` rows keyed off the users' emails.

- [ ] **Step 1: Write `supabase/seed.sql`**

Contents:

```sql
-- ============================================================================
-- CADE League Phase 1A seed — Division 1 Elite 2025-2026 roster
-- ============================================================================
--
--   >>> REPLACE WITH REAL ROSTER BEFORE PRODUCTION SEED <<<
--
-- This file creates 13 placeholder accounts for local + staging testing.
-- For every player row below:
--   * swap email from player01..13@cade.local to the real contact email
--   * swap display_name to the player's real (or preferred) name
--   * swap gamer_tag to the player's in-game tag
--   * swap psn_id to the player's PSN ID
--   * keep jersey_number unique and in range 1..99
--   * leave photo_url null (admins upload via dashboard in Phase 1B)
--
-- Dev password for every placeholder: dev-player-2026
--   Rotate before staging. Production players get a password-reset email
--   via Supabase Auth (admin flow lands in Plan 6, not here).
--
-- How to run:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
--
-- Safe to re-run: every insert uses ON CONFLICT DO NOTHING keyed on email / id.
-- ============================================================================

-- Resolve the single active season (inserted by migration
-- 20260422000001_seasons.sql). If this returns null the migration didn't run.
do $$
declare
  v_season_id uuid;
begin
  select id into v_season_id
    from public.seasons
    where year_range = '2025-2026' and status = 'active'
    limit 1;
  if v_season_id is null then
    raise exception 'No active 2025-2026 season found. Run migrations first.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 13 auth.users rows.
-- We insert directly into auth.users with a pre-hashed password. Supabase's
-- internal password hashing (bcrypt, cost 10) matches what a normal signup
-- would produce. The hash below corresponds to the literal "dev-player-2026".
-- Generated with: `select crypt('dev-player-2026', gen_salt('bf', 10))`.
--
-- The handle_new_auth_user trigger (Plan 1 migration 20260421000005) mirrors
-- each new auth.users row into public.users automatically — we do NOT insert
-- into public.users here.
-- ----------------------------------------------------------------------------

-- NOTE: bcrypt hashes are one-way; the placeholder below is a valid hash of
-- "dev-player-2026" at cost 10. Regenerate if you rotate the dev password:
--   select crypt('dev-player-2026', gen_salt('bf', 10));
-- Then paste the resulting string as the encrypted_password value everywhere.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  -- TODO: replace each (email, display_name) with real roster data.
  -- 1
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player01@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player One"}'::jsonb, now(), now(), false, false),
  -- 2
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player02@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Two"}'::jsonb, now(), now(), false, false),
  -- 3
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player03@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Three"}'::jsonb, now(), now(), false, false),
  -- 4
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player04@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Four"}'::jsonb, now(), now(), false, false),
  -- 5
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player05@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Five"}'::jsonb, now(), now(), false, false),
  -- 6
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player06@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Six"}'::jsonb, now(), now(), false, false),
  -- 7
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player07@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Seven"}'::jsonb, now(), now(), false, false),
  -- 8
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player08@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Eight"}'::jsonb, now(), now(), false, false),
  -- 9
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player09@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Nine"}'::jsonb, now(), now(), false, false),
  -- 10
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player10@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Ten"}'::jsonb, now(), now(), false, false),
  -- 11
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player11@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Eleven"}'::jsonb, now(), now(), false, false),
  -- 12
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player12@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Twelve"}'::jsonb, now(), now(), false, false),
  -- 13
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'player13@cade.local',
   crypt('dev-player-2026', gen_salt('bf', 10)),
   now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Player Thirteen"}'::jsonb, now(), now(), false, false)
on conflict (email) do nothing;

-- ----------------------------------------------------------------------------
-- public.players — one row per user just inserted.
-- We look the user up by email so we don't need to hard-code UUIDs.
-- Jersey numbers are arbitrary placeholders; swap when you fill in real data.
-- ----------------------------------------------------------------------------

with roster(email, gamer_tag, psn_id, jersey_number) as (values
  -- email                              , gamer_tag       , psn_id          , jersey
  ('player01@cade.local'::citext,        'TAG_PLAYER01',   'psn_player01',  1),
  ('player02@cade.local'::citext,        'TAG_PLAYER02',   'psn_player02',  2),
  ('player03@cade.local'::citext,        'TAG_PLAYER03',   'psn_player03',  3),
  ('player04@cade.local'::citext,        'TAG_PLAYER04',   'psn_player04',  4),
  ('player05@cade.local'::citext,        'TAG_PLAYER05',   'psn_player05',  5),
  ('player06@cade.local'::citext,        'TAG_PLAYER06',   'psn_player06',  6),
  ('player07@cade.local'::citext,        'TAG_PLAYER07',   'psn_player07',  7),
  ('player08@cade.local'::citext,        'TAG_PLAYER08',   'psn_player08',  8),
  ('player09@cade.local'::citext,        'TAG_PLAYER09',   'psn_player09',  9),
  ('player10@cade.local'::citext,        'TAG_PLAYER10',   'psn_player10', 10),
  ('player11@cade.local'::citext,        'TAG_PLAYER11',   'psn_player11', 11),
  ('player12@cade.local'::citext,        'TAG_PLAYER12',   'psn_player12', 12),
  ('player13@cade.local'::citext,        'TAG_PLAYER13',   'psn_player13', 13)
)
insert into public.players (user_id, gamer_tag, psn_id, jersey_number)
select u.id, r.gamer_tag, r.psn_id, r.jersey_number
  from roster r
  join public.users u on u.email = r.email
  where u.deleted_at is null
on conflict (user_id) do nothing;

-- ----------------------------------------------------------------------------
-- public.season_participants — register every seeded player in the active season.
-- ----------------------------------------------------------------------------

insert into public.season_participants (season_id, player_id, entry_status)
select s.id, p.id, 'confirmed'
  from public.seasons s
  cross join public.players p
  join public.users u on u.id = p.user_id
  where s.year_range = '2025-2026'
    and s.status = 'active'
    and s.deleted_at is null
    and u.email in (
      'player01@cade.local','player02@cade.local','player03@cade.local',
      'player04@cade.local','player05@cade.local','player06@cade.local',
      'player07@cade.local','player08@cade.local','player09@cade.local',
      'player10@cade.local','player11@cade.local','player12@cade.local',
      'player13@cade.local'
    )
on conflict (season_id, player_id) do nothing;

-- ----------------------------------------------------------------------------
-- Assign the 'player' role to each seeded user.
-- ----------------------------------------------------------------------------

insert into public.user_roles (user_id, role)
select u.id, 'player'
  from public.users u
  where u.email in (
    'player01@cade.local','player02@cade.local','player03@cade.local',
    'player04@cade.local','player05@cade.local','player06@cade.local',
    'player07@cade.local','player08@cade.local','player09@cade.local',
    'player10@cade.local','player11@cade.local','player12@cade.local',
    'player13@cade.local'
  )
on conflict (user_id, role) do nothing;

-- ============================================================================
-- Verification summary (run these manually after seeding):
--   select count(*) from public.users        where email like 'player%@cade.local';  -- 13
--   select count(*) from public.players;                                              -- 13
--   select count(*) from public.season_participants;                                  -- 13
-- ============================================================================
```

- [ ] **Step 2: Run the seed against the cloud DB (dry run)**

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

(where `SUPABASE_DB_URL` comes from `npx supabase status --linked` or the Supabase dashboard).

Expected output: no errors. 13 `auth.users` inserted on first run, subsequent runs report 0 new rows via `ON CONFLICT`.

- [ ] **Step 3: Verify counts**

```bash
npx --yes supabase db query "select (select count(*) from public.users where email like 'player%@cade.local') as users, (select count(*) from public.players) as players, (select count(*) from public.season_participants) as participants, (select count(*) from public.user_roles where role='player') as roles" --linked --output table
```

Expected: `users=13, players=13, participants=13, roles=13`.

- [ ] **Step 4: Spot-check one seeded player via the public API**

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/players?select=id,gamer_tag,jersey_number&limit=3" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Expected: a JSON array with 3 objects (RLS `players_public_read` allows anon select).

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(seed): Phase 1A 13-player roster template with TODO markers"
```

---

## Task 10: Smoke the public pages against seeded data

**Files:**
- Create: `apps/web/tests/e2e/players.spec.ts`

- [ ] **Step 1: Write the E2E spec**

Contents of `apps/web/tests/e2e/players.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("public /players renders the 13 seeded cards", async ({ page }) => {
  await page.goto("/players");
  await expect(page.getByRole("heading", { name: "Players" })).toBeVisible();
  // 13 cards if seed ran, or the empty state if it hasn't. Assert one of the two.
  const cards = page.getByTestId("player-card");
  const empty = page.getByTestId("players-empty");
  await expect(cards.first().or(empty)).toBeVisible();
  const count = await cards.count();
  if (count > 0) {
    expect(count).toBe(13);
  }
});

test("clicking a card opens the profile page", async ({ page }) => {
  await page.goto("/players");
  const first = page.getByTestId("player-card").first();
  if (await first.isVisible().catch(() => false)) {
    await first.click();
    await expect(page).toHaveURL(/\/players\/[0-9a-f-]{36}/);
    await expect(page.getByRole("link", { name: /back to roster/i })).toBeVisible();
  } else {
    test.skip(true, "seed not run — skip profile navigation test");
  }
});
```

- [ ] **Step 2: Run E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: prior E2E tests (from Plans 0 + 1) still pass, plus the 2 new tests. If the seed ran, `/players` shows 13 cards and clicking navigates to `/players/[id]`. If the seed did not run, the roster test passes on the empty state and the profile test is skipped.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/players.spec.ts
git commit -m "test(e2e): /players roster + /players/[id] navigation happy path"
```

---

## Task 11: Final verification

- [ ] **Step 1: All migrations applied**

```bash
npm run db:push
```

Expected: `No schemas to push.` (all 3 new migrations already in cloud from Tasks 1–3).

- [ ] **Step 2: Unit tests green**

```bash
npm run test
```

Expected: prior tests from Plans 0 + 1 + 7 new tests from this plan all pass (3 seasons + 4 players).

- [ ] **Step 3: Lint + build clean**

```bash
npm run lint && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: E2E green**

```bash
npm --workspace apps/web run e2e
```

Expected: all E2E tests (smoke + login + players) pass.

- [ ] **Step 5: Data shape final check**

```bash
npx --yes supabase db query "
  select
    (select count(*) from public.seasons where status='active') as active_seasons,
    (select count(*) from public.players)                       as players,
    (select count(*) from public.season_participants where entry_status='confirmed') as confirmed_participants
" --linked --output table
```

Expected (post-seed): `active_seasons=1, players=13, confirmed_participants=13`.

- [ ] **Step 6: Audit log captured roster writes**

```bash
npx --yes supabase db query "select entity_type, action, count(*) from public.audit_events where entity_type in ('seasons','players','season_participants') group by 1,2 order by 1,2" --linked --output table
```

Expected: inserts recorded for all three tables.

- [ ] **Step 7: Update `tasks/todo.md`**

Move Plan 2 to Done and add:

```markdown
## Done
- Plan 2 — Season + Players + Seed complete (2026-04-XX).
  - 3 migrations applied (seasons, players, season_participants)
  - Elite 2025-2026 season row inserted via migration
  - players RLS enabled (public read, server-managed writes)
  - supabase/seed.sql template with 13 placeholder players
  - /players grid + /players/[id] profile pages live (ISR 60s)
  - 7 new unit tests + 2 new E2E tests green
```

- [ ] **Step 8: Commit verification notes**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): Plan 2 complete"
```

---

## Out of Scope for Plan 2

- Match days, matches, match_results, player_match_stats — Plan 3.
- Standings table + recompute — Plan 3.
- Admin UI for editing roster (add/remove players mid-season) — Plan 7 (admin CRUD).
- Profile edit form for players — Plan 8 (player dashboard).
- Photo upload via Supabase Storage — later; seed leaves `photo_url` null and the avatar fallback handles it.
- Squad submission + Friday change window — explicit Phase 1A non-goal (spec §16).
- Stats block on `/players/[id]` — placeholder only; real stats land when Plan 3 ships `match_results`.
- Password rotation / provisioning flow for seeded accounts — Plan 6 (admin user management).
- Phase 1B PII columns on `players` (NIN, bank) — RLS is enabled now so the columns can be added without policy churn.
- Trash / restore UI — Plan 9.

---

## Review / Acceptance Criteria

Plan 2 is done when:

1. `git log --oneline` shows ~11 focused commits (one per task plus verification).
2. `npm run lint && npm run test && npm run build` all exit 0.
3. `npm run db:push` reports no pending migrations.
4. `public.seasons` contains exactly one row with `year_range='2025-2026'` and `status='active'`.
5. `public.players` has RLS enabled (`relrowsecurity = true`) and the four policies (`players_public_read`, `players_self_read_any`, `players_self_update`, `players_no_direct_insert`, `players_no_direct_delete`) are visible in `pg_policies`.
6. Running `psql -f supabase/seed.sql` (after editing the roster TODOs) yields 13 users, 13 players, 13 season participants, 13 `player` role rows — idempotent on re-run.
7. `/players` renders the 13 seeded cards sorted by jersey number.
8. `/players/[id]` renders a single player's profile and a "Back to roster" link.
9. `public.audit_events` shows insert rows for `seasons`, `players`, `season_participants` after the seed runs.
10. The seed file has the prominent `>>> REPLACE WITH REAL ROSTER BEFORE PRODUCTION SEED <<<` block at the top and per-field TODO comments at each roster entry.
