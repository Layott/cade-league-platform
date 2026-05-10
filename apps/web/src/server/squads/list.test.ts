import { describe, it, expect, vi } from "vitest";
import {
  listSubmissionsForWeek,
  getApprovedSubmissionForPlayer,
  listSubmissionsForPlayerInSeason,
  getSubmissionForPlayerAndMatchDay,
} from "./list";

describe("listSubmissionsForWeek", () => {
  it("builds a query filtered by status", async () => {
    // The real supabase-js query chain is thenable at the end. We mirror
    // that with a self-chaining object whose `then` resolves with the
    // shaped result.
    const resultRows = [
      {
        id: "s1",
        season_id: "se",
        player_id: "p1",
        week_start_date: "2026-04-16",
        futbin_screenshot_path: "k",
        submitted_at: "2026-04-16T10:00:00Z",
        validation_status: "pending" as const,
        validated_by: null,
        validated_at: null,
        rejection_reason: null,
        notes: null,
        player: { id: "p1", display_name: "P", gamer_tag: "p" },
      },
    ];
    const query: Record<string, unknown> = {};
    query.eq = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.then = (resolve: (v: { data: typeof resultRows; error: null }) => unknown) =>
      resolve({ data: resultRows, error: null });

    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    };
    const rows = await listSubmissionsForWeek(sb as never, "se", "2026-04-16", {
      status: "pending",
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.validation_status).toBe("pending");
  });
});

describe("getApprovedSubmissionForPlayer", () => {
  it("returns null when no approved submission found", async () => {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => chain),
      })),
    };
    const row = await getApprovedSubmissionForPlayer(sb as never, "p1", "2026-04-16");
    expect(row).toBeNull();
  });

  it("picks the most recent of multiple per-MD approved submissions in the same week", async () => {
    // Regression for 2026-05-10 production crash: post `squad_submissions_per_md_unique`
    // migration, weekend Sat+Sun pair can carry 2 approved rows with the same
    // week_start_date. Pre-fix `.maybeSingle()` raised "JSON object requested,
    // multiple rows returned" from every public `/players/<id>` page that ran
    // this lookup once both weekend submissions were approved.
    const sub1 = {
      id: "s-latest",
      season_id: "se",
      player_id: "p1",
      week_start_date: "2026-04-16",
      match_day_id: "md-sun",
      futbin_screenshot_path: "k",
      submitted_at: "2026-04-17T08:00:00Z",
      validation_status: "approved" as const,
      validated_by: null,
      validated_at: null,
      rejection_reason: null,
      notes: null,
    };
    let fromCalls = 0;
    const subChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [sub1], error: null }),
    };
    const itemsChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const sb = {
      from: vi.fn(() => {
        fromCalls += 1;
        return {
          select: vi.fn(() => (fromCalls === 1 ? subChain : itemsChain)),
        };
      }),
    };
    const result = await getApprovedSubmissionForPlayer(
      sb as never,
      "p1",
      "2026-04-16",
    );
    expect(result?.submission.id).toBe("s-latest");
  });
});

describe("listSubmissionsForPlayerInSeason", () => {
  it("groups submissions by match_day_id and falls back to week-anchor key for legacy rows", async () => {
    const rows = [
      // newest — match_day_id present
      {
        id: "s1",
        match_day_id: "md-1",
        week_start_date: "2026-04-16",
        submitted_at: "2026-04-16T08:00:00Z",
        validation_status: "approved" as const,
        rejection_reason: null,
      },
      // legacy weekly row (no match_day_id)
      {
        id: "s2",
        match_day_id: null,
        week_start_date: "2026-04-09",
        submitted_at: "2026-04-09T08:00:00Z",
        validation_status: "approved" as const,
        rejection_reason: null,
      },
      // older row for SAME match day — newer write wins (already first
      // because of submitted_at DESC ordering).
      {
        id: "s1-old",
        match_day_id: "md-1",
        week_start_date: "2026-04-16",
        submitted_at: "2026-04-15T08:00:00Z",
        validation_status: "rejected" as const,
        rejection_reason: "stale",
      },
    ];
    const query: Record<string, unknown> = {};
    query.eq = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.then = (resolve: (v: { data: typeof rows; error: null }) => unknown) =>
      resolve({ data: rows, error: null });

    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    };
    const map = await listSubmissionsForPlayerInSeason(sb as never, "p1", "se");
    expect(map.size).toBe(2);
    // match_day_id key takes the freshest summary.
    expect(map.get("md-1")?.submissionId).toBe("s1");
    expect(map.get("md-1")?.validationStatus).toBe("approved");
    // legacy row keyed by week-anchor synthetic key.
    expect(map.get("week:2026-04-09")?.submissionId).toBe("s2");
  });
});

describe("getSubmissionForPlayerAndMatchDay", () => {
  it("returns the direct match_day_id submission with items", async () => {
    let fromCalls = 0;
    const sub = {
      id: "s1",
      season_id: "se",
      player_id: "p1",
      week_start_date: "2026-04-16",
      futbin_screenshot_path: "k",
      submitted_at: "2026-04-16T08:00:00Z",
      validation_status: "approved" as const,
      validated_by: null,
      validated_at: null,
      rejection_reason: null,
      notes: null,
    };
    const item = {
      id: "i1",
      submission_id: "s1",
      name: "Mbappé",
      rating: 91,
      position: "ST",
      value: 1_000_000,
      item_type: "gold",
      nationality_flag: "FR",
      slot_index: 0,
      resolved_fc_player_id: null,
      fc_player: null,
    };
    const directChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: sub, error: null }),
    };
    const itemsQuery: Record<string, unknown> = {};
    itemsQuery.eq = vi.fn(() => itemsQuery);
    itemsQuery.is = vi.fn(() => itemsQuery);
    itemsQuery.order = vi.fn(() => itemsQuery);
    itemsQuery.then = (
      resolve: (v: { data: Array<typeof item>; error: null }) => unknown,
    ) => resolve({ data: [item], error: null });

    const sb = {
      from: vi.fn(() => {
        fromCalls += 1;
        // First call resolves the submission lookup; second resolves items.
        return fromCalls === 1
          ? { select: vi.fn(() => directChain) }
          : { select: vi.fn(() => itemsQuery) };
      }),
    };
    const out = await getSubmissionForPlayerAndMatchDay(
      sb as never,
      "p1",
      "md-1",
      "2026-04-16",
    );
    expect(out?.submission.id).toBe("s1");
    expect(out?.items.length).toBe(1);
    expect(out?.items[0]?.name).toBe("Mbappé");
  });

  it("returns null when neither direct nor legacy fallback hits", async () => {
    let chainIdx = 0;
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          chainIdx += 1;
          return {
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      })),
    };
    const out = await getSubmissionForPlayerAndMatchDay(
      sb as never,
      "p1",
      "md-1",
      "2026-04-16",
    );
    expect(out).toBeNull();
    expect(chainIdx).toBeGreaterThanOrEqual(2); // direct + legacy fallback
  });
});
