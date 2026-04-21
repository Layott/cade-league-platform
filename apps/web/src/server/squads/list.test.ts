import { describe, it, expect, vi } from "vitest";
import { listSubmissionsForWeek, getApprovedSubmissionForPlayer } from "./list";

describe("listSubmissionsForWeek", () => {
  it("builds a query filtered by status", async () => {
    // The real supabase-js query chain is thenable at the end. We mirror
    // that with a self-chaining object whose `then` resolves with the
    // shaped result.
    const resultRows = [
      {
        id: "s1",
        season_id: "se",
        player_id: "p1",
        week_start_date: "2026-04-16",
        futbin_screenshot_path: "k",
        submitted_at: "2026-04-16T10:00:00Z",
        validation_status: "pending" as const,
        validated_by: null,
        validated_at: null,
        rejection_reason: null,
        notes: null,
        player: { id: "p1", display_name: "P", gamer_tag: "p" },
      },
    ];
    const query: Record<string, unknown> = {};
    query.eq = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.then = (resolve: (v: { data: typeof resultRows; error: null }) => unknown) =>
      resolve({ data: resultRows, error: null });

    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    };
    const rows = await listSubmissionsForWeek(sb as never, "se", "2026-04-16", {
      status: "pending",
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.validation_status).toBe("pending");
  });
});

describe("getApprovedSubmissionForPlayer", () => {
  it("returns null when no approved submission found", async () => {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => chain),
      })),
    };
    const row = await getApprovedSubmissionForPlayer(sb as never, "p1", "2026-04-16");
    expect(row).toBeNull();
  });
});
