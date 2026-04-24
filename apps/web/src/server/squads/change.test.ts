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
// Ten more item UUIDs for a full starting XI. The test doubles expose
// all 11 as live XI items so `newSlotPlan` validation passes.
const XI_ITEM_IDS = Array.from({ length: 11 }, (_, i) => {
  const hex = (i + 1).toString(16).padStart(1, "0").repeat(12);
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
});
const OUT_ITEM = XI_ITEM_IDS[0]; // swap-out anchor

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
  /** XI items the fake DB pretends to own for this submission. */
  xiItems?: Array<{ id: string; slot_index: number }>;
}) {
  const sub =
    opts.submission ?? {
      id: UUID_SUB,
      week_start_date: "2026-04-16",
      validation_status: "approved",
    };
  const xiItems =
    opts.xiItems ??
    XI_ITEM_IDS.map((id, i) => ({ id, slot_index: i }));
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
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi
                .fn()
                .mockResolvedValue({ data: xiItems, error: null }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function mkSwapInput(
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

describe("requestChange — swap intent", () => {
  it("succeeds within Friday 21:00-22:00 WAT window", async () => {
    const sb = mkSb({});
    const out = await requestChange(sb as never, mkSwapInput({ playerOutItemId: OUT_ITEM }), {
      now: IN_WINDOW,
    });
    expect(out.id).toBe("ch-1");
  });

  it("rejects 20:59 WAT with window_closed", async () => {
    const sb = mkSb({});
    await expect(
      requestChange(sb as never, mkSwapInput(), { now: BEFORE_WINDOW }),
    ).rejects.toThrow(/window_closed/);
  });

  it("rejects 22:00:01 WAT with window_closed", async () => {
    const sb = mkSb({});
    await expect(
      requestChange(sb as never, mkSwapInput(), { now: AFTER_WINDOW }),
    ).rejects.toThrow(/window_closed/);
  });

  it("rejects second swap in the same week", async () => {
    const sb = mkSb({ existingChange: { id: "prior" } });
    await expect(
      requestChange(sb as never, mkSwapInput(), { now: IN_WINDOW }),
    ).rejects.toThrow(/swap_already_used/);
  });

  it("rejects when authorizing user lacks squads.change_authorize", async () => {
    (hasPermAsync as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      false,
    );
    const sb = mkSb({});
    await expect(
      requestChange(sb as never, mkSwapInput(), { now: IN_WINDOW }),
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
      requestChange(sb as never, mkSwapInput(), { now: IN_WINDOW }),
    ).rejects.toThrow(/not approved/i);
  });
});

describe("requestChange — formation-only intent", () => {
  it("succeeds with just a formation change (no swap, no slot plan)", async () => {
    const sb = mkSb({});
    const out = await requestChange(
      sb as never,
      {
        submissionId: UUID_SUB,
        newFormation: "442",
        authorizedByRefUserId: UUID_REF,
      },
      { now: IN_WINDOW },
    );
    expect(out.id).toBe("ch-1");
  });
});

type PlanEntry =
  | { kind: "existing"; itemId: string }
  | { kind: "new" };

function mkExistingPlan(): PlanEntry[] {
  return XI_ITEM_IDS.map<PlanEntry>((id) => ({ kind: "existing", itemId: id }));
}

describe("requestChange — slot rearrangement intent", () => {
  it("succeeds with a pure rearrangement (all 11 existing items)", async () => {
    const sb = mkSb({});
    const plan = mkExistingPlan();
    const out = await requestChange(
      sb as never,
      {
        submissionId: UUID_SUB,
        newSlotPlan: plan,
        authorizedByRefUserId: UUID_REF,
      },
      { now: IN_WINDOW },
    );
    expect(out.id).toBe("ch-1");
  });

  it("rejects a plan referencing an item not in the starting XI", async () => {
    const sb = mkSb({});
    const plan = mkExistingPlan();
    // Swap in a foreign id (not in the submission).
    plan[3] = {
      kind: "existing",
      itemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    };
    await expect(
      requestChange(
        sb as never,
        {
          submissionId: UUID_SUB,
          newSlotPlan: plan,
          authorizedByRefUserId: UUID_REF,
        },
        { now: IN_WINDOW },
      ),
    ).rejects.toThrow(/not in the starting XI/i);
  });

  it("rejects a plan with duplicated existing item ids", async () => {
    const sb = mkSb({});
    const plan = mkExistingPlan();
    plan[5] = plan[4]; // duplicate
    await expect(
      requestChange(
        sb as never,
        {
          submissionId: UUID_SUB,
          newSlotPlan: plan,
          authorizedByRefUserId: UUID_REF,
        },
        { now: IN_WINDOW },
      ),
    ).rejects.toThrow(/duplicate/i);
  });
});

describe("requestChange — combined intent (formation + slot + single swap)", () => {
  it("succeeds when formation, plan, and swap are all coherent", async () => {
    const sb = mkSb({});
    const plan = mkExistingPlan();
    // Slot 0 becomes the incoming card; the existing anchor (OUT_ITEM) is
    // what's being swapped out.
    plan[0] = { kind: "new" };
    const out = await requestChange(
      sb as never,
      {
        submissionId: UUID_SUB,
        newFormation: "4231",
        newSlotPlan: plan,
        playerOutItemId: OUT_ITEM,
        playerOutName: "Out Player",
        playerIn: {
          name: "Replacement",
          itemType: "icon",
          rating: 91,
          value: 1_200_000,
          nationalityFlag: "NG",
        },
        authorizedByRefUserId: UUID_REF,
      },
      { now: IN_WINDOW },
    );
    expect(out.id).toBe("ch-1");
  });

  it("rejects more than one kind='new' slot in the plan (>1 swap)", async () => {
    const sb = mkSb({});
    const plan = mkExistingPlan();
    plan[0] = { kind: "new" };
    plan[7] = { kind: "new" };
    await expect(
      requestChange(
        sb as never,
        {
          submissionId: UUID_SUB,
          newSlotPlan: plan,
          playerOutItemId: OUT_ITEM,
          playerOutName: "Out",
          playerIn: {
            name: "In",
            itemType: "gold",
            rating: 80,
            value: 1,
          },
          authorizedByRefUserId: UUID_REF,
        },
        { now: IN_WINDOW },
      ),
    ).rejects.toThrow(/at most one slot/i);
  });
});

describe("requestChange — empty intent", () => {
  it("rejects a request with no formation, no plan, no swap", async () => {
    const sb = mkSb({});
    await expect(
      requestChange(
        sb as never,
        {
          submissionId: UUID_SUB,
          authorizedByRefUserId: UUID_REF,
        },
        { now: IN_WINDOW },
      ),
    ).rejects.toThrow(/empty|formation|slot|swap/i);
  });
});
