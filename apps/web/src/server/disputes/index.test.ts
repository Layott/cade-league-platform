import { describe, it, expect, vi } from "vitest";
import { submit, assign, rule, withdraw, DisputeError } from "./index";

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function mkSb(opts: {
  insertRow?: Record<string, unknown> | null;
  updateRow?: Record<string, unknown> | null;
  readRow?: { id: string; raised_by_user_id: string; status: string } | null;
  readErr?: { message: string } | null;
}) {
  return {
    from: vi.fn((t: string) => {
      if (t !== "disputes") throw new Error(`unexpected ${t}`);
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: opts.insertRow ?? null,
              error: opts.insertRow ? null : { message: "insert fail" },
            }),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: opts.updateRow ?? null,
                error: opts.updateRow ? null : { message: "update fail" },
              }),
            })),
          })),
        })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: opts.readRow ?? null, error: opts.readErr ?? null }),
          })),
        })),
      };
    }),
  } as never;
}

describe("submit", () => {
  it("records raised_by + opened_at via DB default", async () => {
    const sb = mkSb({
      insertRow: {
        id: "d-1",
        raised_by_user_id: UUID_A,
        subject_type: "match",
        subject_id: UUID_B,
        description: "foul play",
        status: "submitted",
        opened_at: "2026-05-01",
      },
    });
    const out = await submit(sb, {
      raisedByUserId: UUID_A,
      subjectType: "match",
      subjectId: UUID_B,
      description: "foul play",
      evidenceUrls: [],
    });
    expect(out.status).toBe("submitted");
    expect(out.raised_by_user_id).toBe(UUID_A);
  });

  it("rejects empty description", async () => {
    const sb = mkSb({ insertRow: {} });
    await expect(
      submit(sb, {
        raisedByUserId: UUID_A,
        subjectType: "other",
        description: "",
        evidenceUrls: [],
      }),
    ).rejects.toThrow();
  });

  it("wraps DB error in DisputeError", async () => {
    const sb = mkSb({ insertRow: null });
    await expect(
      submit(sb, {
        raisedByUserId: UUID_A,
        subjectType: "other",
        description: "ok",
        evidenceUrls: [],
      }),
    ).rejects.toBeInstanceOf(DisputeError);
  });
});

describe("assign", () => {
  it("flips status to under_review and sets assignee", async () => {
    const sb = mkSb({
      updateRow: {
        id: "d-1",
        raised_by_user_id: UUID_A,
        assigned_to_user_id: UUID_C,
        status: "under_review",
      },
    });
    const out = await assign(sb, { disputeId: UUID_B, assignedToUserId: UUID_C });
    expect(out.status).toBe("under_review");
    expect(out.assigned_to_user_id).toBe(UUID_C);
  });
});

describe("rule", () => {
  it("sets resolved_at, ruling text, and status=resolved", async () => {
    const sb = mkSb({
      updateRow: {
        id: "d-1",
        status: "resolved",
        ruling: "upheld",
        resolved_at: "2026-05-07",
      },
    });
    const out = await rule(sb, { disputeId: UUID_B, ruling: "upheld" });
    expect(out.status).toBe("resolved");
    expect(out.ruling).toBe("upheld");
    expect(out.resolved_at).toBeTruthy();
  });
});

describe("withdraw", () => {
  it("allows raiser to withdraw their own submitted dispute", async () => {
    const sb = mkSb({
      readRow: { id: "d-1", raised_by_user_id: UUID_A, status: "submitted" },
      updateRow: { id: "d-1", status: "withdrawn" },
    });
    const out = await withdraw(sb, {
      disputeId: UUID_B,
      requestedByUserId: UUID_A,
    });
    expect(out.status).toBe("withdrawn");
  });

  it("blocks non-raiser from withdrawing", async () => {
    const sb = mkSb({
      readRow: { id: "d-1", raised_by_user_id: UUID_A, status: "submitted" },
    });
    await expect(
      withdraw(sb, { disputeId: UUID_B, requestedByUserId: UUID_C }),
    ).rejects.toBeInstanceOf(DisputeError);
  });

  it("blocks withdrawal of resolved disputes", async () => {
    const sb = mkSb({
      readRow: { id: "d-1", raised_by_user_id: UUID_A, status: "resolved" },
    });
    await expect(
      withdraw(sb, { disputeId: UUID_B, requestedByUserId: UUID_A }),
    ).rejects.toThrow(/resolved/);
  });

  it("throws when dispute missing", async () => {
    const sb = mkSb({ readRow: null });
    await expect(
      withdraw(sb, { disputeId: UUID_B, requestedByUserId: UUID_A }),
    ).rejects.toThrow(/not found/);
  });
});
