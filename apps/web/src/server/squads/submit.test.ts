import { describe, it, expect, vi } from "vitest";
import { createSubmission } from "./submit";

const UUID_S = "11111111-1111-4111-8111-111111111111";
const UUID_P = "22222222-2222-4222-8222-222222222222";

function mkSb(opts: {
  existing?: { id: string; validation_status?: string } | null;
  insertedId?: string;
  itemsErr?: { message: string } | null;
  leagueOverride?: { state: "force_open" | "force_close" } | null;
  playerOverride?: { state: "ban" | "force_open" } | null;
}) {
  const insertedId = opts.insertedId ?? "sub-1";
  const deleteFromSubmissions = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));
  const itemsInsert = vi.fn(() => ({ error: opts.itemsErr ?? null }));
  const existing = opts.existing
    ? { id: opts.existing.id, validation_status: opts.existing.validation_status ?? "pending" }
    : null;
  const submissionsUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  const itemsUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({ is: vi.fn().mockResolvedValue({ error: null }) })),
  }));

  return {
    itemsInsert,
    deleteFromSubmissions,
    from: vi.fn((table: string) => {
      if (table === "squad_submissions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: existing, error: null }),
                })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: insertedId },
                error: null,
              }),
            })),
          })),
          update: submissionsUpdate,
          delete: deleteFromSubmissions,
        };
      }
      if (table === "squad_player_items") {
        return {
          insert: (rows: unknown[]) => itemsInsert(rows),
          update: itemsUpdate,
        };
      }
      if (table === "squad_window_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: opts.leagueOverride
                    ? {
                        week_start_date: "2026-04-16",
                        state: opts.leagueOverride.state,
                        note: null,
                        set_by: "u",
                        set_at: new Date().toISOString(),
                      }
                    : null,
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      if (table === "squad_validation_rules") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
        };
      }
      if (table === "player_squad_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.playerOverride
                      ? {
                          id: "po-1",
                          player_id: "p",
                          week_start_date: "2026-04-16",
                          state: opts.playerOverride.state,
                          note: null,
                          set_by: "u",
                          set_at: new Date().toISOString(),
                        }
                      : null,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function mkInput(over: Partial<Parameters<typeof createSubmission>[1]> = {}) {
  return {
    seasonId: UUID_S,
    playerId: UUID_P,
    weekStartDate: "2026-04-16",
    futbinScreenshotPath: "seasons/s/players/p/weeks/2026-04-16/a.png",
    items: [
      {
        name: "Maddison",
        rating: 84,
        position: "CAM",
        value: 100_000,
        itemType: "gold" as const,
        nationalityFlag: "GB",
        slotIndex: 0,
      },
    ],
    ...over,
  };
}

describe("createSubmission", () => {
  it("happy path inserts submission + items and returns the id", async () => {
    const sb = mkSb({});
    const out = await createSubmission(sb as never, mkInput(), {
      now: new Date("2026-04-16T08:00:00+01:00"),
    });
    expect(out.id).toBe("sub-1");
    expect(sb.itemsInsert).toHaveBeenCalledTimes(1);
  });

  it("throws ConflictError when an approved submission exists (only reopen can flip that)", async () => {
    const sb = mkSb({ existing: { id: "existing", validation_status: "approved" } });
    await expect(
      createSubmission(sb as never, mkInput(), {
        now: new Date("2026-04-16T08:00:00+01:00"),
      }),
    ).rejects.toThrow(/submission already exists/i);
  });

  it("replaces an existing pending submission when still pre-deadline", async () => {
    const sb = mkSb({
      existing: { id: "existing", validation_status: "pending" },
      insertedId: "sub-2",
    });
    const out = await createSubmission(sb as never, mkInput(), {
      now: new Date("2026-04-16T08:00:00+01:00"),
    });
    expect(out.id).toBe("sub-2");
    // The old submission + items should be soft-deleted before insert.
    expect(sb.itemsInsert).toHaveBeenCalledTimes(1);
  });

  it("rejects when the player has a per-player ban", async () => {
    const sb = mkSb({ playerOverride: { state: "ban" } });
    await expect(
      createSubmission(sb as never, mkInput(), {
        now: new Date("2026-04-16T08:00:00+01:00"),
      }),
    ).rejects.toThrow(/banned from submitting/i);
  });

  it("rejects when the league window is force-closed and no player override", async () => {
    const sb = mkSb({ leagueOverride: { state: "force_close" } });
    await expect(
      createSubmission(sb as never, mkInput(), {
        now: new Date("2026-04-16T08:00:00+01:00"),
      }),
    ).rejects.toThrow(/window is closed/i);
  });

  it("allows submission past deadline when player has force_open override", async () => {
    const sb = mkSb({ playerOverride: { state: "force_open" } });
    const out = await createSubmission(sb as never, mkInput(), {
      now: new Date("2026-04-17T12:00:00+01:00"), // day after deadline
    });
    expect(out.id).toBe("sub-1");
  });

  it("rejects when past deadline with no submission and no override", async () => {
    const sb = mkSb({});
    await expect(
      createSubmission(sb as never, mkInput(), {
        now: new Date("2026-04-17T12:00:00+01:00"), // day after deadline
      }),
    ).rejects.toThrow(/window has closed/i);
  });

  it("rejects weekStartDate that doesn't match the current Thursday anchor", async () => {
    const sb = mkSb({});
    await expect(
      createSubmission(
        sb as never,
        mkInput({ weekStartDate: "2026-04-09" }),
        { now: new Date("2026-04-16T08:00:00+01:00") },
      ),
    ).rejects.toThrow(/does not match current week anchor/i);
  });

  it("rolls back the submission if item insert fails", async () => {
    const sb = mkSb({ itemsErr: { message: "boom" } });
    await expect(
      createSubmission(sb as never, mkInput(), {
        now: new Date("2026-04-16T08:00:00+01:00"),
      }),
    ).rejects.toThrow(/failed to insert items/i);
    expect(sb.deleteFromSubmissions).toHaveBeenCalledTimes(1);
  });
});
