import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/**
 * Bug 8 (2026-05-01) regression — when `reopenSubmissionAction` flips a
 * submission status from rejected → pending and revalidates this page, the
 * follow-up SSR render previously could crash if the supabase chain for
 * `match_days` (or `squad_change_requests`) returned a transient error
 * instead of `{data: row}`. The fix wraps both queries in try/catch with
 * console.error fallback. This test exercises the page render with a
 * mocked supabase client where `match_days.select(...).maybeSingle()`
 * resolves with `error: ...` AND a separate run where it `throw`s — the
 * page must produce HTML in both cases (no exception propagation).
 */

const matchDaysMaybeSingle = vi.fn();
const squadChangeMaybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => {
  const builder = (kind: "match_days" | "squad_change_requests") => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle:
      kind === "match_days" ? matchDaysMaybeSingle : squadChangeMaybeSingle,
  });
  const sb = {
    from: vi.fn((table: string) => {
      if (table === "match_days") return builder("match_days");
      if (table === "squad_change_requests")
        return builder("squad_change_requests");
      // Any other reads land on the @/server/squads mocks below.
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };
  return { getServerSupabase: vi.fn().mockResolvedValue(sb) };
});

vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: vi.fn(() => ({})),
}));

vi.mock("@/server/squads", () => ({
  getSubmissionWithItems: vi.fn().mockResolvedValue({
    submission: {
      id: "11111111-1111-4111-8111-111111111111",
      season_id: "22222222-2222-4222-8222-222222222222",
      player_id: "33333333-3333-4333-8333-333333333333",
      week_start_date: "2026-04-23",
      submitted_at: "2026-04-22T10:00:00Z",
      validation_status: "pending",
      futbin_screenshot_path: "screenshots/example.png",
      match_day_id: "44444444-4444-4444-8444-444444444444",
      rejection_reason: null,
      player: { display_name: "Test Player" },
    },
    items: [],
  }),
  getRuleForSeason: vi.fn().mockResolvedValue({
    max_budget_coins: 10_000_000,
    min_nigerian_items: 1,
    banned_item_types: [],
  }),
  evaluateRules: vi.fn().mockReturnValue({ ok: true, violations: [] }),
  createSignedRead: vi.fn().mockResolvedValue(null),
  reviewSquadAgainstFCDB: vi.fn().mockResolvedValue({
    items: [],
    summary: {
      total: 0,
      resolved: 0,
      fuzzy: 0,
      ambiguous: 0,
      unknown: 0,
      fcdbEmpty: true,
    },
  }),
}));

vi.mock("@/lib/time", () => ({
  formatWat: vi.fn(() => "2026-04-22 10:00"),
}));

vi.mock("./actions", () => ({
  approveAction: vi.fn(),
  rejectAction: vi.fn(),
  acceptFcdbCandidateAction: vi.fn(),
  reopenSubmissionAction: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound called");
  }),
}));

import AdminSquadDetailPage from "./page";

beforeEach(() => {
  matchDaysMaybeSingle.mockReset();
  squadChangeMaybeSingle.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/admin/squads/[id] page — defensive try/catch (Bug 8)", () => {
  it("does not throw when match_days fetch returns an error", async () => {
    matchDaysMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "transient supabase error" },
    });
    squadChangeMaybeSingle.mockResolvedValue({ data: null, error: null });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await AdminSquadDetailPage({
      params: Promise.resolve({ id: "abc" }),
    });
    // The page returned a JSX tree (not undefined / not a thrown error).
    expect(result).toBeTruthy();
    // The error path was logged.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("does not throw when match_days fetch THROWS", async () => {
    matchDaysMaybeSingle.mockRejectedValue(new Error("network down"));
    squadChangeMaybeSingle.mockResolvedValue({ data: null, error: null });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await AdminSquadDetailPage({
      params: Promise.resolve({ id: "abc" }),
    });
    expect(result).toBeTruthy();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("does not throw when squad_change_requests fetch returns an error", async () => {
    matchDaysMaybeSingle.mockResolvedValue({
      data: { match_date: "2026-04-25", venue_name: "CADE Studio" },
      error: null,
    });
    squadChangeMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "rls denied" },
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await AdminSquadDetailPage({
      params: Promise.resolve({ id: "abc" }),
    });
    expect(result).toBeTruthy();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("renders match-day label when match_days returns the row cleanly", async () => {
    matchDaysMaybeSingle.mockResolvedValue({
      data: { match_date: "2026-04-25", venue_name: "CADE Studio" },
      error: null,
    });
    squadChangeMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await AdminSquadDetailPage({
      params: Promise.resolve({ id: "abc" }),
    });
    expect(result).toBeTruthy();
  });
});
