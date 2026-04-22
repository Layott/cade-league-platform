import { describe, it, expect, vi } from "vitest";
import { listUnplayedMatchesToday } from "./unplayed";

/**
 * Plan 45 — unit tests for listUnplayedMatchesToday.
 *
 * We stub Supabase via a minimal query-builder that records `.from(...)`
 * calls + returns `{ data, error }` at the end of the chain. Tests cover
 * the 4 cases called out in the plan: no matches, all completed, mixed,
 * and session current_match_id set (which is currently ignored — kept as
 * a sanity check that the helper still returns data in that case).
 */

function makeQuery(result: { data: unknown; error: unknown }) {
  const thenable: Promise<typeof result> = Promise.resolve(result);
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "in", "order", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => thenable);
  chain.single = vi.fn(() => thenable);
  (chain as { then?: unknown }).then = thenable.then.bind(thenable);
  return chain as unknown as {
    select: () => unknown;
    eq: () => unknown;
    is: () => unknown;
    in: () => unknown;
    order: () => unknown;
    maybeSingle: () => Promise<typeof result>;
    then: Promise<typeof result>["then"];
  };
}

function mkSb(handlers: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => {
      if (!(table in handlers)) {
        throw new Error(`unplayed test: unexpected table "${table}"`);
      }
      return handlers[table];
    }),
  };
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function sessionRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: SESSION_ID,
    match_day_id: "md-1",
    ...overrides,
  };
}

function matchRow(
  id: string,
  status: "scheduled" | "in_progress" | "completed",
  opts: {
    hasResult?: boolean;
    scheduledTime?: string | null;
    homeName?: string;
    awayName?: string;
  } = {},
) {
  return {
    id,
    match_day_id: "md-1",
    scheduled_time: opts.scheduledTime ?? "18:00:00",
    status,
    match_day: { match_date: "2026-04-22" },
    home_player: {
      id: `${id}-home`,
      gamer_tag: "HOME",
      users: { display_name: opts.homeName ?? "Home Player" },
    },
    away_player: {
      id: `${id}-away`,
      gamer_tag: "AWAY",
      users: { display_name: opts.awayName ?? "Away Player" },
    },
    match_results: opts.hasResult ? [{ id: "r-" + id }] : [],
  };
}

describe("listUnplayedMatchesToday", () => {
  it("returns [] when session has no match_day pin", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: null, error: null }),
    });
    const out = await listUnplayedMatchesToday(sb as never, SESSION_ID);
    expect(out).toEqual([]);
  });

  it("returns [] when the match_day has no matches", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({ data: [], error: null }),
    });
    const out = await listUnplayedMatchesToday(sb as never, SESSION_ID);
    expect(out).toEqual([]);
  });

  it("filters out matches that already have a completed match_results row", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({
        data: [
          matchRow("m1", "in_progress", { hasResult: true }),
          matchRow("m2", "completed", { hasResult: true }),
        ],
        error: null,
      }),
    });
    const out = await listUnplayedMatchesToday(sb as never, SESSION_ID);
    expect(out).toEqual([]);
  });

  it("returns the mix of scheduled + in_progress without completed results", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({
        data: [
          matchRow("m-scheduled", "scheduled"),
          matchRow("m-live", "in_progress"),
          matchRow("m-done", "scheduled", { hasResult: true }),
        ],
        error: null,
      }),
    });
    const out = await listUnplayedMatchesToday(sb as never, SESSION_ID);
    const ids = out.map((m) => m.id).sort();
    expect(ids).toEqual(["m-live", "m-scheduled"]);
    expect(out[0].kickoffAt).toMatch(/^2026-04-22T/);
    expect(out.find((m) => m.id === "m-scheduled")?.status).toBe("scheduled");
  });

  it("still returns un-played matches even when the session has a current_match_id", async () => {
    // current_match_id isn't used by this helper — the match shows up as
    // 'in_progress' in the matches list, which is exactly what we want to
    // let the admin feature an already-live match as 'up next' if needed.
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: "m-live" }),
        error: null,
      }),
      matches: makeQuery({
        data: [matchRow("m-live", "in_progress")],
        error: null,
      }),
    });
    const out = await listUnplayedMatchesToday(sb as never, SESSION_ID);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("m-live");
  });

  it("maps scheduled_time + match_date into an ISO kickoffAt", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({
        data: [matchRow("m1", "scheduled", { scheduledTime: "19:30:00" })],
        error: null,
      }),
    });
    const out = await listUnplayedMatchesToday(sb as never, SESSION_ID);
    expect(out[0].kickoffAt).toBe("2026-04-22T19:30:00.000Z");
  });
});
