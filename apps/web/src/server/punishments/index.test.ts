import { describe, it, expect, vi } from "vitest";
import { update, softDelete, countPriorOffenses } from "./index";

function mkUpdateChain() {
  const eq = vi.fn().mockResolvedValue({ data: null, error: null });
  const upd = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update: upd }));
  return { sb: { from } as never, upd, eq };
}

function mkCountChain(rows: unknown[]) {
  const is = vi
    .fn()
    .mockResolvedValue({ data: rows, error: null });
  const eq2 = vi.fn(() => ({ is }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const sel = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select: sel }));
  return { sb: { from } as never, sel };
}

describe("update — edit a disciplinary_action in place", () => {
  it("writes the expected column set + keys by actionId", async () => {
    const { sb, upd, eq } = mkUpdateChain();
    await update(sb, {
      actionId: "11111111-1111-4111-8111-111111111111",
      sanctionType: "point_deduction",
      magnitude: 3,
      effectiveFrom: "2026-04-24",
      effectiveUntil: null,
      publicVisible: true,
      notes: "updated",
    });
    expect(upd).toHaveBeenCalledWith({
      sanction_type: "point_deduction",
      magnitude: 3,
      effective_from: "2026-04-24",
      effective_until: null,
      public_visible: true,
      notes: "updated",
    });
    expect(eq).toHaveBeenCalledWith(
      "id",
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("rejects ban without a complete window", async () => {
    const { sb } = mkUpdateChain();
    await expect(
      update(sb, {
        actionId: "22222222-2222-4222-8222-222222222222",
        sanctionType: "ban",
        magnitude: 0,
        effectiveFrom: "2026-04-24",
        effectiveUntil: null,
        publicVisible: true,
        notes: null,
      }),
    ).rejects.toThrow();
  });
});

describe("softDelete — marks deleted_at", () => {
  it("updates deleted_at with a timestamp", async () => {
    const { sb, upd, eq } = mkUpdateChain();
    await softDelete(sb, "33333333-3333-4333-8333-333333333333");
    const call = upd.mock.calls[0][0] as { deleted_at: string };
    expect(typeof call.deleted_at).toBe("string");
    expect(call.deleted_at.length).toBeGreaterThan(0);
    expect(eq).toHaveBeenCalledWith(
      "id",
      "33333333-3333-4333-8333-333333333333",
    );
  });
});

describe("countPriorOffenses — counts live cases per player+incident", () => {
  it("counts cases with at least one live (non-revoked, non-deleted) action", async () => {
    const { sb } = mkCountChain([
      {
        id: "c1",
        disciplinary_actions: [
          { id: "a1", revoked_at: null, deleted_at: null },
        ],
      },
      {
        id: "c2",
        disciplinary_actions: [
          { id: "a2", revoked_at: "2026-04-24", deleted_at: null },
        ],
      },
      {
        id: "c3",
        disciplinary_actions: [
          { id: "a3", revoked_at: null, deleted_at: null },
          { id: "a4", revoked_at: "2026-04-24", deleted_at: null },
        ],
      },
    ]);
    const n = await countPriorOffenses(
      sb,
      "player-1",
      "late_arrival",
    );
    expect(n).toBe(2);
  });

  it("returns 0 when no cases exist", async () => {
    const { sb } = mkCountChain([]);
    const n = await countPriorOffenses(sb, "player-x", "forfeit");
    expect(n).toBe(0);
  });
});
