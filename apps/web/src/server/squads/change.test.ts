import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestChange } from "./change";

vi.mock("@/lib/perms-db", () => ({
  hasPermAsync: vi.fn(),
  PermissionError: class extends Error {},
}));

import { hasPermAsync } from "@/lib/perms-db";

const UUID_SUB = "33333333-3333-4333-8333-333333333333";
const UUID_REF = "44444444-4444-4444-8444-444444444444";
const UUID_ITEM = "55555555-5555-4555-8555-555555555555";

function mkSb(opts: {
  submission?: {
    id: string;
    week_start_date: string;
    validation_status: string;
  } | null;
  existingChange?: { id: string } | null;
  refRoles?: string[];
  insertedId?: string;
  insertErr?: { message: string } | null;
}) {
  const sub =
    opts.submission ?? {
      id: UUID_SUB,
      week_start_date: "2026-04-16",
      validation_status: "approved",
    };
  return {
    from: vi.fn((table: string) => {
      if (table === "squad_submissions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: sub, error: null }),
              })),
            })),
          })),
        };
      }
      if (table === "squad_change_requests") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: opts.existingChange ?? null, error: null }),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: opts.insertedId ?? "ch-1" },
                error: opts.insertErr ?? null,
              }),
            })),
          })),
        };
      }
      if (table === "user_roles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({
                data: (opts.refRoles ?? ["referee"]).map((r) => ({ role: r })),
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "squad_player_items") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function mkInput(
  over: Partial<Parameters<typeof requestChange>[1]> = {},
): Parameters<typeof requestChange>[1] {
  return {
    submissionId: UUID_SUB,
    playerOutItemId: UUID_ITEM,
    playerOutName: "Old Player",
    playerIn: {
      name: "New Player",
      itemType: "gold",
      rating: 85,
      value: 250_000,
      nationalityFlag: "NG",
    },
    authorizedByRefUserId: UUID_REF,
    ...over,
  };
}

// Friday 21:10 WAT
const IN_WINDOW = new Date("2026-04-17T21:10:00+01:00");
// Friday 20:59 WAT
const BEFORE_WINDOW = new Date("2026-04-17T20:59:00+01:00");
// Friday 22:00:01 WAT
const AFTER_WINDOW = new Date("2026-04-17T22:00:01+01:00");

beforeEach(() => {
  (hasPermAsync as unknown as { mockReset: () => void }).mockReset();
  (hasPermAsync as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    true,
  );
});

describe("requestChange", () => {
  it("succeeds within Friday 21:00-22:00 WAT window", async () => {
    const sb = mkSb({});
    const out = await requestChange(sb as never, mkInput(), { now: IN_WINDOW });
    expect(out.id).toBe("ch-1");
  });

  it("rejects 20:59 WAT with window_closed", async () => {
    const sb = mkSb({});
    await expect(
      requestChange(sb as never, mkInput(), { now: BEFORE_WINDOW }),
    ).rejects.toThrow(/window_closed/);
  });

  it("rejects 22:00:01 WAT with window_closed", async () => {
    const sb = mkSb({});
    await expect(
      requestChange(sb as never, mkInput(), { now: AFTER_WINDOW }),
    ).rejects.toThrow(/window_closed/);
  });

  it("rejects second swap in the same week", async () => {
    const sb = mkSb({ existingChange: { id: "prior" } });
    await expect(
      requestChange(sb as never, mkInput(), { now: IN_WINDOW }),
    ).rejects.toThrow(/swap_already_used/);
  });

  it("rejects when authorizing user lacks squads.change_authorize", async () => {
    (hasPermAsync as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      false,
    );
    const sb = mkSb({});
    await expect(
      requestChange(sb as never, mkInput(), { now: IN_WINDOW }),
    ).rejects.toThrow(/squads.change_authorize/);
  });

  it("rejects when submission is not approved", async () => {
    const sb = mkSb({
      submission: {
        id: UUID_SUB,
        week_start_date: "2026-04-16",
        validation_status: "pending",
      },
    });
    await expect(
      requestChange(sb as never, mkInput(), { now: IN_WINDOW }),
    ).rejects.toThrow(/not approved/i);
  });
});
