import { describe, it, expect, vi } from "vitest";
import { submit, assignPanel, rule, withdraw, AppealError } from "./index";

const UUID_CASE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UUID_SUBMITTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_APPEAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_PANEL_1 = "11111111-1111-4111-8111-111111111111";
const UUID_PANEL_2 = "22222222-2222-4222-8222-222222222222";
const UUID_PANEL_3 = "33333333-3333-4333-8333-333333333333";
const UUID_PANEL_4 = "44444444-4444-4444-8444-444444444444";
const UUID_PANEL_5 = "55555555-5555-4555-8555-555555555555";
const UUID_PANEL_6 = "66666666-6666-4666-8666-666666666666";

function mkSb(opts: {
  existing?: { id: string } | null;
  insertRow?: Record<string, unknown> | null;
  updateRow?: Record<string, unknown> | null;
  readRow?: Record<string, unknown> | null;
}) {
  return {
    from: vi.fn((t: string) => {
      if (t !== "appeals") throw new Error(`unexpected ${t}`);
      return {
        select: vi.fn((cols: string) => {
          if (cols === "id") {
            // existence check for submit()
            return {
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  is: vi.fn(() => ({
                    maybeSingle: vi
                      .fn()
                      .mockResolvedValue({ data: opts.existing ?? null, error: null }),
                  })),
                })),
              })),
            };
          }
          // read for rule()/withdraw()
          return {
            eq: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: opts.readRow ?? null, error: null }),
            })),
          };
        }),
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
      };
    }),
  } as never;
}

describe("submit", () => {
  it("computes deadline_at and records appeal", async () => {
    const sb = mkSb({
      existing: null,
      insertRow: {
        id: "a-1",
        disciplinary_case_id: UUID_CASE,
        submitted_by_user_id: UUID_SUBMITTER,
        deadline_at: "2026-05-08T22:59:59Z",
        status: "submitted",
        grounds: "ref error",
        panel_member_user_ids: [],
      },
    });
    const out = await submit(sb, {
      disciplinaryCaseId: UUID_CASE,
      submittedByUserId: UUID_SUBMITTER,
      grounds: "ref error",
      evidenceUrls: [],
    });
    expect(out.status).toBe("submitted");
    expect(out.deadline_at).toBeTruthy();
  });

  it("rejects if an open appeal exists for the case (uniqueness)", async () => {
    const sb = mkSb({ existing: { id: "existing" } });
    await expect(
      submit(sb, {
        disciplinaryCaseId: UUID_CASE,
        submittedByUserId: UUID_SUBMITTER,
        grounds: "x",
        evidenceUrls: [],
      }),
    ).rejects.toBeInstanceOf(AppealError);
  });
});

describe("assignPanel", () => {
  it("accepts 3-member panel and sets status=under_review", async () => {
    const sb = mkSb({
      updateRow: {
        id: UUID_APPEAL,
        panel_member_user_ids: [UUID_PANEL_1, UUID_PANEL_2, UUID_PANEL_3],
        status: "under_review",
      },
    });
    const out = await assignPanel(sb, {
      appealId: UUID_APPEAL,
      panelMemberUserIds: [UUID_PANEL_1, UUID_PANEL_2, UUID_PANEL_3],
    });
    expect(out.status).toBe("under_review");
    expect(out.panel_member_user_ids).toHaveLength(3);
  });

  it("rejects >5-member panel", async () => {
    const sb = mkSb({ updateRow: {} });
    await expect(
      assignPanel(sb, {
        appealId: UUID_APPEAL,
        panelMemberUserIds: [
          UUID_PANEL_1,
          UUID_PANEL_2,
          UUID_PANEL_3,
          UUID_PANEL_4,
          UUID_PANEL_5,
          UUID_PANEL_6,
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects empty panel", async () => {
    const sb = mkSb({ updateRow: {} });
    await expect(
      assignPanel(sb, { appealId: UUID_APPEAL, panelMemberUserIds: [] }),
    ).rejects.toThrow();
  });
});

describe("rule", () => {
  it("rules in time (before deadline)", async () => {
    const future = new Date(Date.now() + 86400_000 * 5).toISOString();
    const sb = mkSb({
      readRow: { id: UUID_APPEAL, status: "under_review", deadline_at: future },
      updateRow: {
        id: UUID_APPEAL,
        status: "ruled",
        ruling: "upheld",
        ruled_at: "2026-05-07",
      },
    });
    const out = await rule(sb, { appealId: UUID_APPEAL, ruling: "upheld" });
    expect(out.status).toBe("ruled");
    expect(out.ruling).toBe("upheld");
  });

  it("flags late rulings", async () => {
    const past = new Date(Date.now() - 86400_000 * 5).toISOString();
    const sb = mkSb({
      readRow: { id: UUID_APPEAL, status: "under_review", deadline_at: past },
      updateRow: {
        id: UUID_APPEAL,
        status: "ruled",
        ruling: "[LATE RULING] upheld",
      },
    });
    const out = await rule(sb, { appealId: UUID_APPEAL, ruling: "upheld" });
    expect(out.ruling).toContain("[LATE RULING]");
  });

  it("refuses double-rule", async () => {
    const sb = mkSb({
      readRow: {
        id: UUID_APPEAL,
        status: "ruled",
        deadline_at: new Date().toISOString(),
      },
    });
    await expect(
      rule(sb, { appealId: UUID_APPEAL, ruling: "whatever" }),
    ).rejects.toThrow(/already ruled/);
  });

  it("refuses rule on withdrawn appeal", async () => {
    const sb = mkSb({
      readRow: {
        id: UUID_APPEAL,
        status: "withdrawn",
        deadline_at: new Date().toISOString(),
      },
    });
    await expect(
      rule(sb, { appealId: UUID_APPEAL, ruling: "x" }),
    ).rejects.toThrow(/withdrawn/);
  });
});

describe("withdraw", () => {
  it("allows submitter to withdraw", async () => {
    const sb = mkSb({
      readRow: {
        id: UUID_APPEAL,
        submitted_by_user_id: UUID_SUBMITTER,
        status: "submitted",
      },
      updateRow: { id: UUID_APPEAL, status: "withdrawn" },
    });
    const out = await withdraw(sb, {
      appealId: UUID_APPEAL,
      requestedByUserId: UUID_SUBMITTER,
    });
    expect(out.status).toBe("withdrawn");
  });

  it("blocks non-submitter", async () => {
    const sb = mkSb({
      readRow: {
        id: UUID_APPEAL,
        submitted_by_user_id: UUID_SUBMITTER,
        status: "submitted",
      },
    });
    await expect(
      withdraw(sb, {
        appealId: UUID_APPEAL,
        requestedByUserId: UUID_PANEL_1,
      }),
    ).rejects.toBeInstanceOf(AppealError);
  });

  it("blocks withdraw of ruled appeal", async () => {
    const sb = mkSb({
      readRow: {
        id: UUID_APPEAL,
        submitted_by_user_id: UUID_SUBMITTER,
        status: "ruled",
      },
    });
    await expect(
      withdraw(sb, {
        appealId: UUID_APPEAL,
        requestedByUserId: UUID_SUBMITTER,
      }),
    ).rejects.toThrow(/ruled/);
  });
});
