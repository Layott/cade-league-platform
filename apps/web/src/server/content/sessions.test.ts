import { describe, it, expect, vi } from "vitest";
import { scheduleMakeup, markAttendance, ContentSessionError } from "./sessions";

const SESSION = "11111111-1111-4111-8111-111111111111";

function mkSb(opts: {
  readRow?: { id: string; attended_bool: boolean } | null;
  updateRow?: Record<string, unknown> | null;
}) {
  return {
    from: vi.fn((t: string) => {
      if (t !== "content_sessions") throw new Error(`unexpected ${t}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: opts.readRow ?? null, error: null }),
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

describe("markAttendance", () => {
  it("marks attended=true", async () => {
    const sb = mkSb({ updateRow: { id: SESSION, attended_bool: true } });
    const out = await markAttendance(sb, { sessionId: SESSION, attended: true });
    expect(out.attended_bool).toBe(true);
  });
});

describe("scheduleMakeup", () => {
  it("refuses when primary session was attended", async () => {
    const sb = mkSb({ readRow: { id: SESSION, attended_bool: true } });
    await expect(
      scheduleMakeup(sb, {
        sessionId: SESSION,
        makeupSessionScheduledAt: "2026-05-08T15:00:00Z",
      }),
    ).rejects.toBeInstanceOf(ContentSessionError);
  });

  it("schedules makeup when player missed primary", async () => {
    const sb = mkSb({
      readRow: { id: SESSION, attended_bool: false },
      updateRow: {
        id: SESSION,
        attended_bool: false,
        makeup_session_scheduled_at: "2026-05-08T15:00:00Z",
      },
    });
    const out = await scheduleMakeup(sb, {
      sessionId: SESSION,
      makeupSessionScheduledAt: "2026-05-08T15:00:00Z",
    });
    expect(out.makeup_session_scheduled_at).toBeTruthy();
  });

  it("throws on missing session", async () => {
    const sb = mkSb({ readRow: null });
    await expect(
      scheduleMakeup(sb, {
        sessionId: SESSION,
        makeupSessionScheduledAt: "2026-05-08T15:00:00Z",
      }),
    ).rejects.toThrow(/not found/);
  });
});
