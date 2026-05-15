import { describe, it, expect, vi } from "vitest";
import { getCurrentSquadStatus } from "./squadStatus";

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const SUB_ID = "22222222-2222-4222-8222-222222222222";

type MaybeSubmission = {
  id: string;
  validation_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  week_start_date: string;
} | null;

/**
 * Mock `sb` client. Returns the same supabase-js chain shape the production
 * code uses:
 *   sb.from('squad_submissions').select(...).eq(...).eq(...).is(...).maybeSingle()
 *   sb.from('squad_change_requests').select(..., {count,head}).eq(...).is(...)
 *   sb.from('audit_events').select(...).eq(...).eq(...).eq(...).gte(...).order(...).limit(...)
 */
function mkSb(opts: {
  submission?: MaybeSubmission;
  // 2026-05-09 — supports the `fetchCurrentSubmission` multi-row return
  // case introduced after migration `20260801000020`. When populated,
  // the mock returns the full array (in order) so the production code's
  // `.order('submitted_at', desc).limit(1)` semantics are exercised.
  submissions?: NonNullable<MaybeSubmission>[];
  changeRequestCount?: number;
  auditReopen?: {
    actor_user_id: string | null;
    created_at: string;
    after_json: Record<string, unknown>;
  } | null;
  windowOverride?: {
    week_start_date: string;
    state: "force_open" | "force_close";
    note: string | null;
    set_by: string;
    set_at: string;
  } | null;
  // 2026-05-15 — match days the resolver should consider when scanning
  // for per-MD open windows. Each entry seeds `match_days`, optional
  // `squad_match_day_overrides` (force_open / force_close), and optional
  // `match_day_schedule_overrides` (push the open/close times).
  matchDays?: Array<{
    id: string;
    match_date: string;
    forceState?: "force_open" | "force_close" | null;
    scheduleOpenAt?: string | null;
    scheduleDeadlineAt?: string | null;
    submittedByPlayer?: boolean;
  }>;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "squad_submissions") {
        const rows: NonNullable<MaybeSubmission>[] = opts.submissions
          ? opts.submissions
          : opts.submission
            ? [opts.submission]
            : [];
        // Two callers hit this table:
        //   1. fetchCurrentSubmission — chains
        //      select().eq(player).eq(week).is(deleted_at).order().limit()
        //   2. findOpenUpcomingMatchDay — chains
        //      select(match_day_id).eq(player).in(match_day_ids).is(deleted_at)
        // The shared `select()` returns a single chainable that resolves both
        // shapes; the second call awaits the final `is()` so its mock
        // resolves with the list of match_day_ids the player has submitted
        // for (driven by opts.matchDays[].submittedByPlayer).
        const filedMatchDayIds = (opts.matchDays ?? [])
          .filter((md) => md.submittedByPlayer)
          .map((md) => ({ match_day_id: md.id }));
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue({
                      data: rows,
                      error: null,
                    }),
                  })),
                })),
              })),
              in: vi.fn(() => ({
                is: vi.fn().mockResolvedValue({
                  data: filedMatchDayIds,
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      if (table === "match_days") {
        const mds = (opts.matchDays ?? []).map((md) => ({
          id: md.id,
          match_date: md.match_date,
        }));
        return {
          select: vi.fn(() => ({
            gte: vi.fn(() => ({
              lt: vi.fn(() => ({
                is: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({
                    data: mds,
                    error: null,
                  }),
                })),
              })),
            })),
            // resolveSquadWindowForMatchDay reads (id, match_date) by id.
            eq: vi.fn((_col: string, mdId: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(() => {
                  const md = (opts.matchDays ?? []).find((m) => m.id === mdId);
                  return Promise.resolve({
                    data: md ? { match_date: md.match_date } : null,
                    error: null,
                  });
                }),
              })),
            })),
          })),
        };
      }
      if (table === "squad_match_day_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, mdId: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(() => {
                  const md = (opts.matchDays ?? []).find((m) => m.id === mdId);
                  if (!md?.forceState) {
                    return Promise.resolve({ data: null, error: null });
                  }
                  return Promise.resolve({
                    data: {
                      match_day_id: mdId,
                      state: md.forceState,
                      note: null,
                      set_by: "admin",
                      set_at: new Date().toISOString(),
                    },
                    error: null,
                  });
                }),
              })),
            })),
          })),
        };
      }
      if (table === "match_day_schedule_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, mdId: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(() => {
                  const md = (opts.matchDays ?? []).find((m) => m.id === mdId);
                  if (!md?.scheduleOpenAt && !md?.scheduleDeadlineAt) {
                    return Promise.resolve({ data: null, error: null });
                  }
                  return Promise.resolve({
                    data: {
                      match_day_id: mdId,
                      submission_open_at: md.scheduleOpenAt ?? null,
                      submission_deadline_at: md.scheduleDeadlineAt ?? null,
                      notes: null,
                    },
                    error: null,
                  });
                }),
              })),
            })),
          })),
        };
      }
      if (table === "squad_change_requests") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({
                count: opts.changeRequestCount ?? 0,
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "audit_events") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({
                        data: opts.auditReopen ? [opts.auditReopen] : [],
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "squad_window_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: opts.windowOverride ?? null,
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("getCurrentSquadStatus", () => {
  it("returns pre_deadline with hoursUntil when no submission + before Thursday 10:00 WAT", async () => {
    // Thursday 2026-04-16; before 10:00 WAT deadline.
    const sb = mkSb({ submission: null });
    const now = new Date("2026-04-16T08:00:00+01:00"); // 2hr before deadline
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("pre_deadline");
    if (status.kind === "pre_deadline") {
      expect(status.hoursUntil).toBe(2);
      expect(status.deadline.toISOString()).toBe(
        new Date("2026-04-16T10:00:00+01:00").toISOString(),
      );
    }
  });

  it("returns window_closed when no submission + past Thursday 10:00 WAT deadline", async () => {
    const sb = mkSb({ submission: null });
    const now = new Date("2026-04-16T12:00:00+01:00"); // 2hr past deadline
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("window_closed");
  });

  // Bug 2026-05-15: dashboard misreported window_closed when the weekly
  // Thursday deadline had passed but admin had force_opened (or extended
  // via match_day_schedule_overrides) a specific upcoming match day.
  it("returns pre_deadline when an upcoming match day is force_opened by admin", async () => {
    const sb = mkSb({
      submission: null,
      matchDays: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          match_date: "2026-04-18", // Saturday
          forceState: "force_open",
        },
      ],
    });
    // Friday 2026-04-17 12:00 WAT — well past the Thursday default deadline.
    const now = new Date("2026-04-17T12:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("pre_deadline");
  });

  it("returns pre_deadline when match_day_schedule_overrides pushes the deadline forward", async () => {
    const sb = mkSb({
      submission: null,
      matchDays: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          match_date: "2026-04-18",
          scheduleDeadlineAt: "2026-04-17T23:00:00+01:00", // Friday 23:00
        },
      ],
    });
    // Friday 2026-04-17 12:00 — past the Thursday default but BEFORE the
    // admin-pushed Friday 23:00 deadline.
    const now = new Date("2026-04-17T12:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("pre_deadline");
    if (status.kind === "pre_deadline") {
      expect(status.deadline.toISOString()).toBe(
        new Date("2026-04-17T23:00:00+01:00").toISOString(),
      );
    }
  });

  it("returns window_closed when the only upcoming MD is force_closed", async () => {
    const sb = mkSb({
      submission: null,
      matchDays: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          match_date: "2026-04-18",
          forceState: "force_close",
        },
      ],
    });
    const now = new Date("2026-04-17T12:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("window_closed");
  });

  it("skips MDs the player already submitted for when scanning per-MD windows", async () => {
    const sb = mkSb({
      submission: null,
      matchDays: [
        // Saturday — already submitted by this player; skip even though open.
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          match_date: "2026-04-18",
          forceState: "force_open",
          submittedByPlayer: true,
        },
        // Sunday — open and unsubmitted; this is the one the dashboard
        // should surface as the next due deadline.
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          match_date: "2026-04-19",
          forceState: "force_open",
        },
      ],
    });
    const now = new Date("2026-04-17T12:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("pre_deadline");
  });

  it("returns submitted_pending when submission exists with validation_status='pending'", async () => {
    const sb = mkSb({
      submission: {
        id: SUB_ID,
        validation_status: "pending",
        rejection_reason: null,
        week_start_date: "2026-04-16",
      },
    });
    const now = new Date("2026-04-16T08:30:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("submitted_pending");
  });

  it("returns submitted_approved when submission is approved and Friday window not open", async () => {
    const sb = mkSb({
      submission: {
        id: SUB_ID,
        validation_status: "approved",
        rejection_reason: null,
        week_start_date: "2026-04-16",
      },
    });
    // Thursday afternoon — past deadline but well before Friday 21:00.
    const now = new Date("2026-04-16T15:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("submitted_approved");
  });

  it("returns submitted_rejected with reason when submission is rejected", async () => {
    const sb = mkSb({
      submission: {
        id: SUB_ID,
        validation_status: "rejected",
        rejection_reason: "Budget exceeded",
        week_start_date: "2026-04-16",
      },
    });
    const now = new Date("2026-04-16T11:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("submitted_rejected");
    if (status.kind === "submitted_rejected") {
      expect(status.reason).toBe("Budget exceeded");
    }
  });

  it("returns friday_change_window with changesRemaining=1 when inside window and no swap used", async () => {
    const sb = mkSb({
      submission: {
        id: SUB_ID,
        validation_status: "approved",
        rejection_reason: null,
        week_start_date: "2026-04-16",
      },
      changeRequestCount: 0,
    });
    // Friday 2026-04-17 21:30 WAT — inside the 21:00-22:00 window.
    const now = new Date("2026-04-17T21:30:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("friday_change_window");
    if (status.kind === "friday_change_window") {
      expect(status.changesRemaining).toBe(1);
    }
  });

  it("returns friday_change_window with changesRemaining=0 when swap already used", async () => {
    const sb = mkSb({
      submission: {
        id: SUB_ID,
        validation_status: "approved",
        rejection_reason: null,
        week_start_date: "2026-04-16",
      },
      changeRequestCount: 1,
    });
    const now = new Date("2026-04-17T21:45:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("friday_change_window");
    if (status.kind === "friday_change_window") {
      expect(status.changesRemaining).toBe(0);
    }
  });

  it("returns reopened_by_admin when pending submission past deadline with audit marker", async () => {
    const reopenAt = "2026-04-16T14:00:00+01:00";
    const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
    const sb = mkSb({
      submission: {
        id: SUB_ID,
        validation_status: "pending",
        rejection_reason: null,
        week_start_date: "2026-04-16",
      },
      auditReopen: {
        actor_user_id: ADMIN_ID,
        created_at: reopenAt,
        after_json: { reopened: true, prior_status: "rejected" },
      },
    });
    const now = new Date("2026-04-16T15:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("reopened_by_admin");
    if (status.kind === "reopened_by_admin") {
      expect(status.reopenedBy).toBe(ADMIN_ID);
      expect(status.reopenedAt.toISOString()).toBe(new Date(reopenAt).toISOString());
    }
  });

  it("handles multiple per-MD submissions in the same week without crashing (picks latest)", async () => {
    // Regression for 2026-05-09 production crash: post `squad_submissions_per_md_unique`
    // migration, weekend Sat+Sun pair carries 2 rows with the same week_start_date.
    // Pre-fix `.maybeSingle()` raised "JSON object requested, multiple rows returned"
    // from EVERY /player/* page via the layout-level dashboard banner.
    const sb = mkSb({
      submissions: [
        {
          id: SUB_ID,
          validation_status: "pending",
          rejection_reason: null,
          week_start_date: "2026-04-16",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          validation_status: "approved",
          rejection_reason: null,
          week_start_date: "2026-04-16",
        },
      ],
    });
    const now = new Date("2026-04-16T08:30:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    // Latest row (mock order = production `submitted_at desc` order) wins.
    expect(status.kind).toBe("submitted_pending");
  });

  it("ignores audit_events without the reopened marker and returns submitted_pending", async () => {
    const sb = mkSb({
      submission: {
        id: SUB_ID,
        validation_status: "pending",
        rejection_reason: null,
        week_start_date: "2026-04-16",
      },
      auditReopen: {
        actor_user_id: "someone",
        created_at: "2026-04-16T14:00:00+01:00",
        after_json: { unrelated: "change" },
      },
    });
    const now = new Date("2026-04-16T15:00:00+01:00");
    const status = await getCurrentSquadStatus(sb as never, PLAYER_ID, now);
    expect(status.kind).toBe("submitted_pending");
  });
});
