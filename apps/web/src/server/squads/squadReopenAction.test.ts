import { describe, it, expect, vi, beforeEach } from "vitest";
import { reopenSubmission } from "./reopen";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn(),
  PermissionError: class extends Error {},
}));

import { requirePermAsync } from "@/lib/perms-db";

type Row = {
  id: string;
  validation_status: "pending" | "approved" | "rejected";
  week_start_date: string;
  player_id: string;
  player: { user_id: string };
};

/**
 * Plan 41 P41-G — unit tests for the admin reopen path.
 *
 * Mocks the Supabase client. Covers the three required cases per the
 * prompt: perm denial bubbles, successful transition updates row +
 * inserts notification, status-guard rejects when status already pending.
 */
function mkSb(opts: {
  submission: Row | null;
  admin?: { display_name: string } | null;
  updateErr?: { message: string } | null;
  insertErr?: { message: string } | null;
}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];

  const submissionsQuery = () => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.submission,
            error: null,
          }),
        })),
      })),
    })),
    update: vi.fn((payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return {
        eq: vi.fn().mockResolvedValue({ error: opts.updateErr ?? null }),
      };
    }),
  });

  const usersQuery = () => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: opts.admin ?? null, error: null }),
        })),
      })),
    })),
  });

  const notificationsQuery = () => ({
    insert: vi.fn((payload: Record<string, unknown>) => {
      insertCalls.push(payload);
      return Promise.resolve({ error: opts.insertErr ?? null });
    }),
  });

  return {
    updateCalls,
    insertCalls,
    from: vi.fn((table: string) => {
      if (table === "squad_submissions") return submissionsQuery();
      if (table === "users") return usersQuery();
      if (table === "notifications") return notificationsQuery();
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

const ACTOR = { userId: "u-admin", roles: ["admin"] };

const BASE_ROW: Row = {
  id: "sub-1",
  validation_status: "approved",
  week_start_date: "2026-05-07",
  player_id: "pl-1",
  player: { user_id: "u-player" },
};

describe("reopenSubmission (Plan 41 P41-G)", () => {
  beforeEach(() => {
    (requirePermAsync as unknown as { mockReset: () => void }).mockReset();
    (
      requirePermAsync as unknown as {
        mockResolvedValue: (v: unknown) => void;
      }
    ).mockResolvedValue(undefined);
  });

  it("bubbles permission denial from requirePermAsync", async () => {
    (
      requirePermAsync as unknown as {
        mockRejectedValue: (v: unknown) => void;
      }
    ).mockRejectedValue(new Error("missing permission: squads.reopen"));
    const sb = mkSb({ submission: BASE_ROW });
    await expect(
      reopenSubmission(sb as never, ACTOR, "sub-1"),
    ).rejects.toThrow(/squads\.reopen/);
    expect(sb.updateCalls.length).toBe(0);
    expect(sb.insertCalls.length).toBe(0);
  });

  it("successful transition clears validator fields + inserts notification", async () => {
    const sb = mkSb({
      submission: { ...BASE_ROW, validation_status: "approved" },
      admin: { display_name: "Ada the Admin" },
    });
    const result = await reopenSubmission(sb as never, ACTOR, "sub-1");

    // Row update: flipped to pending, validator stamps + reason cleared.
    expect(sb.updateCalls.length).toBe(1);
    const upd = sb.updateCalls[0];
    expect(upd.validation_status).toBe("pending");
    expect(upd.validated_by).toBeNull();
    expect(upd.validated_at).toBeNull();
    expect(upd.rejection_reason).toBeNull();

    // Notification inserted with correct type + player user_id + body.
    expect(sb.insertCalls.length).toBe(1);
    const notif = sb.insertCalls[0];
    expect(notif.type).toBe("squad_reopened");
    expect(notif.user_id).toBe("u-player");
    expect(notif.announcement_id).toBeNull();
    expect(String(notif.body ?? "")).toContain("Ada the Admin");
    expect(String(notif.body ?? "")).toContain("2026-05-07");

    expect(result.priorStatus).toBe("approved");
    expect(result.playerUserId).toBe("u-player");
  });

  it("rejects when status is already pending (status guard)", async () => {
    const sb = mkSb({
      submission: { ...BASE_ROW, validation_status: "pending" },
    });
    await expect(
      reopenSubmission(sb as never, ACTOR, "sub-1"),
    ).rejects.toThrow(/pending/);
    expect(sb.updateCalls.length).toBe(0);
    expect(sb.insertCalls.length).toBe(0);
  });

  it("also works when prior status is rejected", async () => {
    const sb = mkSb({
      submission: { ...BASE_ROW, validation_status: "rejected" },
      admin: { display_name: "Admin" },
    });
    const result = await reopenSubmission(sb as never, ACTOR, "sub-1");
    expect(result.priorStatus).toBe("rejected");
    expect(sb.updateCalls.length).toBe(1);
    expect(sb.insertCalls.length).toBe(1);
  });

  it("throws when submission does not exist", async () => {
    const sb = mkSb({ submission: null });
    await expect(
      reopenSubmission(sb as never, ACTOR, "sub-404"),
    ).rejects.toThrow(/not found/);
  });
});
