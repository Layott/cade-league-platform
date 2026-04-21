import { describe, it, expect, vi } from "vitest";
import {
  createShoot,
  cancelShoot,
  completeShoot,
  PreseasonShootError,
} from "./shoots";

const SEASON = "11111111-1111-4111-8111-111111111111";
const SHOOT = "22222222-2222-4222-8222-222222222222";

function mkSb(opts: {
  insertRow?: Record<string, unknown> | null;
  updateRow?: Record<string, unknown> | null;
}) {
  return {
    from: vi.fn((t: string) => {
      if (t !== "preseason_shoots") throw new Error(`unexpected ${t}`);
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
      };
    }),
  } as never;
}

describe("createShoot", () => {
  it("inserts a new shoot", async () => {
    const sb = mkSb({
      insertRow: {
        id: SHOOT,
        season_id: SEASON,
        shoot_date: "2026-04-28",
        type: "photo",
        status: "scheduled",
        location: "Lekki Studios",
      },
    });
    const out = await createShoot(sb, {
      seasonId: SEASON,
      shootDate: "2026-04-28",
      type: "photo",
      location: "Lekki Studios",
      status: "scheduled",
    });
    expect(out.id).toBe(SHOOT);
    expect(out.type).toBe("photo");
  });

  it("rejects invalid date format", async () => {
    const sb = mkSb({ insertRow: {} });
    await expect(
      createShoot(sb, {
        seasonId: SEASON,
        shootDate: "28-04-2026",
        type: "photo",
        status: "scheduled",
      }),
    ).rejects.toThrow();
  });

  it("wraps DB error in PreseasonShootError", async () => {
    const sb = mkSb({ insertRow: null });
    await expect(
      createShoot(sb, {
        seasonId: SEASON,
        shootDate: "2026-04-28",
        type: "photo",
        status: "scheduled",
      }),
    ).rejects.toBeInstanceOf(PreseasonShootError);
  });
});

describe("cancel / complete", () => {
  it("cancelShoot flips status to cancelled", async () => {
    const sb = mkSb({
      updateRow: { id: SHOOT, status: "cancelled" },
    });
    const out = await cancelShoot(sb, SHOOT);
    expect(out.status).toBe("cancelled");
  });

  it("completeShoot flips status to completed", async () => {
    const sb = mkSb({
      updateRow: { id: SHOOT, status: "completed" },
    });
    const out = await completeShoot(sb, SHOOT);
    expect(out.status).toBe("completed");
  });
});
