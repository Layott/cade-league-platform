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
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "squad_submissions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.submission ?? null,
                    error: null,
                  }),
                })),
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
