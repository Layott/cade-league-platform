import { describe, it, expect, vi } from "vitest";
import {
  getPlayerOrgBalance,
  getPlayerOpenCases,
  getPlayerActiveSanction,
  getPlayerDashboard,
} from "./dashboard";

/**
 * UI Audit Slice 2 — unit coverage for the player dashboard server
 * fns. Mocks the Supabase client per CLAUDE.md testing strategy. No
 * real DB calls; the focus is on filter shape (correct .eq / .in /
 * .is calls) and the in-process "currently in force" logic in
 * `getPlayerActiveSanction`.
 */

function buildMaybeSingle<T>(data: T) {
  return {
    data,
    error: null,
  };
}

function chainQuery<T>(rows: T[], opts: { count?: number } = {}) {
  // Each terminal returns Promise<{ data, error }>. We don't model
  // Supabase's full builder — only what the helpers under test invoke.
  const terminal = Promise.resolve({
    data: rows,
    error: null,
    count: opts.count ?? rows.length,
  });
  const builder: Record<string, ReturnType<typeof vi.fn>> & { then: typeof terminal.then } = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    is: vi.fn(() => builder),
    not: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve(buildMaybeSingle(rows[0] ?? null)),
    ),
    then: terminal.then.bind(terminal),
  };
  return builder;
}

describe("getPlayerOrgBalance", () => {
  it("returns null when player has no organization_id (free agent)", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "players") {
          return chainQuery([{ organization_id: null }]);
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const result = await getPlayerOrgBalance(
      sb as never,
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result).toBeNull();
  });

  it("returns null when player row missing", async () => {
    const sb = {
      from: vi.fn(() => chainQuery<{ organization_id: string | null }>([])),
    };
    const result = await getPlayerOrgBalance(
      sb as never,
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result).toBeNull();
  });

  it("returns balance + name for player with org", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "players") {
          return chainQuery([{ organization_id: "org-1" }]);
        }
        if (table === "organizations") {
          return chainQuery([
            { id: "org-1", name: "Killer Inc.", caution_fee_balance_coins: 4_500_000 },
          ]);
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const result = await getPlayerOrgBalance(
      sb as never,
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result).toEqual({
      organizationId: "org-1",
      organizationName: "Killer Inc.",
      balanceCoins: 4_500_000,
    });
  });

  it("coerces string balance to number (Postgres numeric returns string in some drivers)", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "players") {
          return chainQuery([{ organization_id: "org-2" }]);
        }
        return chainQuery([
          { id: "org-2", name: "Wolves", caution_fee_balance_coins: "1234567" },
        ]);
      }),
    };
    const result = await getPlayerOrgBalance(sb as never, "p");
    expect(result?.balanceCoins).toBe(1_234_567);
  });
});

describe("getPlayerOpenCases", () => {
  it("returns counts from disputes + appeals", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "disputes") return chainQuery([], { count: 2 });
        if (table === "appeals") return chainQuery([], { count: 1 });
        throw new Error(`unexpected ${table}`);
      }),
    };
    const result = await getPlayerOpenCases(sb as never, "user-1");
    expect(result).toEqual({ disputes: 2, appeals: 1 });
  });

  it("returns zeroes when no rows match", async () => {
    const sb = {
      from: vi.fn(() => chainQuery([], { count: 0 })),
    };
    const result = await getPlayerOpenCases(sb as never, "user-1");
    expect(result).toEqual({ disputes: 0, appeals: 0 });
  });

  it("treats null count as 0 (Supabase head:true edge case)", async () => {
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              is: vi.fn(() =>
                Promise.resolve({ data: null, error: null, count: null }),
              ),
            })),
          })),
        })),
      })),
    };
    const result = await getPlayerOpenCases(sb as never, "user-1");
    expect(result).toEqual({ disputes: 0, appeals: 0 });
  });
});

describe("getPlayerActiveSanction", () => {
  const NOW = new Date("2026-04-28T12:00:00.000Z");

  function mockSb(args: {
    cases: Array<{ id: string; incident_type: string }>;
    actions: Array<{
      id: string;
      case_id: string;
      sanction_type: string;
      magnitude: number;
      effective_from: string | null;
      effective_until: string | null;
      imposed_at: string;
      revoked_at: string | null;
      deleted_at: string | null;
    }>;
  }) {
    return {
      from: vi.fn((table: string) => {
        if (table === "disciplinary_cases") return chainQuery(args.cases);
        if (table === "disciplinary_actions") return chainQuery(args.actions);
        throw new Error(`unexpected ${table}`);
      }),
    };
  }

  it("returns null on a clean record (no cases)", async () => {
    const sb = mockSb({ cases: [], actions: [] });
    const result = await getPlayerActiveSanction(sb as never, "p1", NOW);
    expect(result).toBeNull();
  });

  it("returns null when all sanctions have lapsed (effective_until <= today)", async () => {
    const sb = mockSb({
      cases: [{ id: "c1", incident_type: "late_arrival" }],
      actions: [
        {
          id: "a1",
          case_id: "c1",
          sanction_type: "ban",
          magnitude: 1,
          effective_from: "2026-04-01",
          effective_until: "2026-04-15",
          imposed_at: "2026-04-01T10:00:00Z",
          revoked_at: null,
          deleted_at: null,
        },
      ],
    });
    const result = await getPlayerActiveSanction(sb as never, "p1", NOW);
    expect(result).toBeNull();
  });

  it("returns the most recent live sanction (effective_until > today)", async () => {
    const sb = mockSb({
      cases: [
        { id: "c1", incident_type: "late_arrival" },
        { id: "c2", incident_type: "absent" },
      ],
      actions: [
        {
          id: "a-newer",
          case_id: "c2",
          sanction_type: "ban",
          magnitude: 2,
          effective_from: "2026-04-25",
          effective_until: "2026-05-10",
          imposed_at: "2026-04-25T10:00:00Z",
          revoked_at: null,
          deleted_at: null,
        },
        {
          id: "a-older",
          case_id: "c1",
          sanction_type: "warning",
          magnitude: 0,
          effective_from: "2026-04-01",
          effective_until: "2026-04-30",
          imposed_at: "2026-04-01T10:00:00Z",
          revoked_at: null,
          deleted_at: null,
        },
      ],
    });
    const result = await getPlayerActiveSanction(sb as never, "p1", NOW);
    expect(result).not.toBeNull();
    expect(result?.actionId).toBe("a-newer");
    expect(result?.incidentType).toBe("absent");
  });

  it("returns open-ended sanction (effective_until = null) when effective_from is past", async () => {
    const sb = mockSb({
      cases: [{ id: "c1", incident_type: "match_fixing" }],
      actions: [
        {
          id: "a1",
          case_id: "c1",
          sanction_type: "ban",
          magnitude: 1,
          effective_from: "2026-04-01",
          effective_until: null,
          imposed_at: "2026-04-01T10:00:00Z",
          revoked_at: null,
          deleted_at: null,
        },
      ],
    });
    const result = await getPlayerActiveSanction(sb as never, "p1", NOW);
    expect(result?.actionId).toBe("a1");
    expect(result?.effectiveUntil).toBeNull();
  });

  it("skips a future-only sanction whose effective_from is after today", async () => {
    const sb = mockSb({
      cases: [{ id: "c1", incident_type: "absent" }],
      actions: [
        {
          id: "a1",
          case_id: "c1",
          sanction_type: "ban",
          magnitude: 1,
          effective_from: "2026-05-01",
          effective_until: "2026-05-10",
          imposed_at: "2026-04-25T10:00:00Z",
          revoked_at: null,
          deleted_at: null,
        },
      ],
    });
    const result = await getPlayerActiveSanction(sb as never, "p1", NOW);
    expect(result).toBeNull();
  });
});

describe("getPlayerDashboard", () => {
  it("composes all three reads in a single object", async () => {
    const NOW = new Date("2026-04-28T12:00:00.000Z");
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "players") {
          return chainQuery([{ organization_id: null }]);
        }
        if (table === "disputes") return chainQuery([], { count: 0 });
        if (table === "appeals") return chainQuery([], { count: 0 });
        if (table === "disciplinary_cases") return chainQuery([]);
        if (table === "disciplinary_actions") return chainQuery([]);
        throw new Error(`unexpected ${table}`);
      }),
    };
    const result = await getPlayerDashboard(sb as never, {
      playerId: "p",
      userId: "u",
      now: NOW,
    });
    expect(result).toEqual({
      orgBalance: null,
      openCases: { disputes: 0, appeals: 0 },
      activeSanction: null,
    });
  });
});
