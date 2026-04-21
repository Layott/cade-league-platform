import { describe, it, expect, vi } from "vitest";
import { submitPost, verify, reject, ContentPostError } from "./posts";

const PLAYER = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const MOD = "33333333-3333-4333-8333-333333333333";

function mkSb(opts: {
  existing?: Record<string, unknown> | null;
  insertRow?: Record<string, unknown> | null;
  updateRow?: Record<string, unknown> | null;
}) {
  return {
    from: vi.fn((t: string) => {
      if (t !== "content_posts") throw new Error(`unexpected ${t}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: opts.existing ?? null,
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          })),
        })),
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

describe("submitPost", () => {
  it("rejects non-Monday week_start", async () => {
    const sb = mkSb({ insertRow: {} });
    await expect(
      submitPost(sb, {
        playerId: PLAYER,
        weekStart: "2026-05-05", // Tuesday
        platform: "instagram",
        postUrl: "https://www.instagram.com/p/abc",
      }),
    ).rejects.toBeInstanceOf(ContentPostError);
  });

  it("accepts Monday week_start and inserts", async () => {
    const sb = mkSb({
      existing: null,
      insertRow: {
        id: "p-1",
        player_id: PLAYER,
        week_start: "2026-05-04",
        platform: "instagram",
        post_url: "https://www.instagram.com/p/abc",
        verification_status: "pending",
      },
    });
    const out = await submitPost(sb, {
      playerId: PLAYER,
      weekStart: "2026-05-04",
      platform: "instagram",
      postUrl: "https://www.instagram.com/p/abc",
    });
    expect(out.id).toBe("p-1");
  });

  it("is idempotent — returns existing row for same (player, week, platform, url)", async () => {
    const existing = {
      id: "p-old",
      player_id: PLAYER,
      week_start: "2026-05-04",
      platform: "twitter",
      post_url: "https://twitter.com/x/status/1",
      verification_status: "verified",
    };
    const sb = mkSb({ existing });
    const out = await submitPost(sb, {
      playerId: PLAYER,
      weekStart: "2026-05-04",
      platform: "twitter",
      postUrl: "https://twitter.com/x/status/1",
    });
    expect(out.id).toBe("p-old");
  });
});

describe("verify", () => {
  it("flips status to verified", async () => {
    const sb = mkSb({
      updateRow: {
        id: POST,
        verification_status: "verified",
        verified_by_user_id: MOD,
      },
    });
    const out = await verify(sb, { postId: POST, verifiedByUserId: MOD });
    expect(out.verification_status).toBe("verified");
  });
});

describe("reject", () => {
  it("requires rejection_reason (schema enforces)", async () => {
    const sb = mkSb({ updateRow: {} });
    await expect(
      reject(sb, { postId: POST, verifiedByUserId: MOD, reason: "" }),
    ).rejects.toThrow();
  });

  it("flips status to rejected with a reason", async () => {
    const sb = mkSb({
      updateRow: {
        id: POST,
        verification_status: "rejected",
        rejection_reason: "blurry",
      },
    });
    const out = await reject(sb, {
      postId: POST,
      verifiedByUserId: MOD,
      reason: "blurry",
    });
    expect(out.verification_status).toBe("rejected");
    expect(out.rejection_reason).toBe("blurry");
  });
});
