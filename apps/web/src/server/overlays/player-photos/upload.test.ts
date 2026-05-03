import { describe, it, expect, vi } from "vitest";
import {
  requestPlayerPhotoUploadUrls,
  finalizePlayerPhotoUpload,
  MAX_TOTAL_BYTES,
} from "./upload";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn(async () => undefined),
}));

function mkSb() {
  const calls: string[] = [];
  return {
    calls,
    from: vi.fn((table: string) => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn(async () => ({
            data: { id: "UPL-1" },
            error: null,
          })),
        }),
      }),
      update: vi.fn(() => ({
        eq: vi.fn(async () => {
          calls.push(`update:${table}`);
          return { error: null };
        }),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { player_id: "P", upload_mode: "single" },
            error: null,
          })),
          not: vi.fn(async () => ({
            data: [],
            error: null,
          })),
        })),
      })),
    })),
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn(async () => ({
          data: { signedUrl: "https://put", token: "tk" },
          error: null,
        })),
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: "https://pub" },
        })),
      })),
    },
  } as never;
}

const ACTOR = { userId: "A", roles: ["admin"] as readonly string[] };

describe("upload module", () => {
  it("requestPlayerPhotoUploadUrls validates total size", async () => {
    const sb = mkSb();
    await expect(
      requestPlayerPhotoUploadUrls({
        sb,
        actor: ACTOR,
        playerId: "P",
        mode: "multi",
        files: [
          { filename: "headshot_100.png", bytes: MAX_TOTAL_BYTES + 1 },
        ],
      }),
    ).rejects.toThrow(/too_large/);
  });

  it("requestPlayerPhotoUploadUrls returns one signed URL per file", async () => {
    const sb = mkSb();
    const result = await requestPlayerPhotoUploadUrls({
      sb,
      actor: ACTOR,
      playerId: "P",
      mode: "single",
      files: [
        { filename: "headshot_100.png", bytes: 100_000 },
        { filename: "headshot_100_nobg.png", bytes: 100_000 },
      ],
    });
    expect(result.uploads.length).toBe(2);
    expect(result.uploadId).toBe("UPL-1");
  });

  it("finalizePlayerPhotoUpload flips status to ready + records variants", async () => {
    const sb = mkSb();
    await finalizePlayerPhotoUpload({
      sb,
      actor: ACTOR,
      uploadId: "UPL-1",
      variants: { headshot: "p1.png", headshot_nobg: "p2.png" },
    });
    expect(
      (sb as unknown as { calls: string[] }).calls.some((c) =>
        c.startsWith("update:"),
      ),
    ).toBe(true);
  });
});
