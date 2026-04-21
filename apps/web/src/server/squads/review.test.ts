import { describe, it, expect, vi, beforeEach } from "vitest";
import { approveSubmission, rejectSubmission } from "./review";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn(),
  PermissionError: class extends Error {},
}));

import { requirePermAsync } from "@/lib/perms-db";

function mkSb(opts: {
  submission?: { id: string; validation_status: string } | null;
  updateErr?: { message: string } | null;
}) {
  const sub = opts.submission ?? { id: "s1", validation_status: "pending" };
  const updateCalls: unknown[] = [];
  return {
    updateCalls,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: sub, error: null }),
          })),
        })),
      })),
      update: vi.fn((payload: unknown) => {
        updateCalls.push(payload);
        return {
          eq: vi.fn().mockResolvedValue({ error: opts.updateErr ?? null }),
        };
      }),
    })),
  };
}

const ACTOR = { userId: "u-ref", roles: ["referee"] };

describe("approveSubmission", () => {
  beforeEach(() => {
    (requirePermAsync as unknown as { mockReset: () => void }).mockReset();
    (requirePermAsync as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      undefined,
    );
  });

  it("flips status to approved and stamps validator", async () => {
    const sb = mkSb({});
    await approveSubmission(sb as never, ACTOR, "sub-1");
    const payload = sb.updateCalls[0] as {
      validation_status: string;
      validated_by: string;
    };
    expect(payload.validation_status).toBe("approved");
    expect(payload.validated_by).toBe("u-ref");
  });

  it("throws when submission already approved", async () => {
    const sb = mkSb({ submission: { id: "s1", validation_status: "approved" } });
    await expect(approveSubmission(sb as never, ACTOR, "sub-1")).rejects.toThrow(
      /not pending/i,
    );
  });

  it("bubbles permission error from requirePermAsync", async () => {
    (requirePermAsync as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
      new Error("missing permission: squads.validate"),
    );
    const sb = mkSb({});
    await expect(approveSubmission(sb as never, ACTOR, "sub-1")).rejects.toThrow(
      /squads.validate/,
    );
  });
});

describe("rejectSubmission", () => {
  beforeEach(() => {
    (requirePermAsync as unknown as { mockReset: () => void }).mockReset();
    (requirePermAsync as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      undefined,
    );
  });

  it("requires a non-empty reason", async () => {
    const sb = mkSb({});
    await expect(rejectSubmission(sb as never, ACTOR, "sub-1", "")).rejects.toThrow(
      /rejection_reason required/i,
    );
  });

  it("stamps reason and flips status to rejected", async () => {
    const sb = mkSb({});
    await rejectSubmission(sb as never, ACTOR, "sub-1", "budget over");
    const payload = sb.updateCalls[0] as {
      validation_status: string;
      rejection_reason: string;
    };
    expect(payload.validation_status).toBe("rejected");
    expect(payload.rejection_reason).toBe("budget over");
  });
});
