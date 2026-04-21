import { describe, it, expect, vi } from "vitest";
import {
  whoMissedDeadline,
  issueAutoWarningForMissed,
  laddersAnction,
} from "./deadline";

function mkSb(opts: {
  participants?: string[];
  submitted?: string[];
  existingMarker?: { id: string } | null;
  priorCount?: number;
  caseId?: string;
  actionId?: string;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "season_participants") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({
                data: (opts.participants ?? []).map((id) => ({ player_id: id })),
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "squad_submissions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn().mockResolvedValue({
                  data: (opts.submitted ?? []).map((id) => ({ player_id: id })),
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      if (table === "disciplinary_cases") {
        return {
          select: vi.fn((_sel: string, selOpts?: { head?: boolean; count?: string }) => {
            if (selOpts?.head) {
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    is: vi.fn().mockResolvedValue({
                      count: opts.priorCount ?? 0,
                      error: null,
                    }),
                  })),
                })),
              };
            }
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  ilike: vi.fn(() => ({
                    is: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: opts.existingMarker ?? null,
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            };
          }),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: opts.caseId ?? "c-1" }, error: null }),
            })),
          })),
        };
      }
      if (table === "disciplinary_actions") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: opts.actionId ?? "a-1" }, error: null }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("whoMissedDeadline", () => {
  it("returns participants that did not submit", async () => {
    const sb = mkSb({
      participants: ["p1", "p2", "p3"],
      submitted: ["p2"],
    });
    const missed = await whoMissedDeadline(sb as never, "season", "2026-04-16");
    expect(missed.sort()).toEqual(["p1", "p3"]);
  });

  it("returns [] when no participants", async () => {
    const sb = mkSb({ participants: [], submitted: [] });
    const missed = await whoMissedDeadline(sb as never, "season", "2026-04-16");
    expect(missed).toEqual([]);
  });
});

describe("issueAutoWarningForMissed", () => {
  it("skips when marker case already exists (idempotent)", async () => {
    const sb = mkSb({ existingMarker: { id: "c-0" } });
    const out = await issueAutoWarningForMissed(sb as never, {
      playerId: "p1",
      seasonId: "season",
      weekStart: "2026-04-16",
      reporterUserId: "u-adm",
    });
    expect(out.created).toBe(false);
  });

  it("creates case + action on first offense", async () => {
    const sb = mkSb({
      existingMarker: null,
      priorCount: 0,
    });
    const out = await issueAutoWarningForMissed(sb as never, {
      playerId: "p1",
      seasonId: "season",
      weekStart: "2026-04-16",
      reporterUserId: "u-adm",
    });
    expect(out.created).toBe(true);
    expect(out.caseId).toBe("c-1");
    expect(out.actionId).toBe("a-1");
  });
});

describe("laddersAnction ladder progression", () => {
  it("1st → warning magnitude 0", () => {
    expect(laddersAnction(1)).toEqual({ sanction_type: "warning", magnitude: 0 });
  });
  it("2nd → warning magnitude 0", () => {
    expect(laddersAnction(2)).toEqual({ sanction_type: "warning", magnitude: 0 });
  });
  it("3rd → -3 points", () => {
    expect(laddersAnction(3)).toEqual({
      sanction_type: "point_deduction",
      magnitude: 3,
    });
  });
});
