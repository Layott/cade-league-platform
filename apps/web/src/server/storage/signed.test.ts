import { describe, it, expect, vi } from "vitest";
import {
  createSignedUpload,
  createSignedRead,
  trySignedRead,
  SignedStorageError,
} from "./signed";

function mkClient(opts?: { failUpload?: boolean; failRead?: boolean }) {
  return {
    storage: {
      from: vi.fn((_bucket: string) => ({
        createSignedUploadUrl: vi.fn(async (path: string) =>
          opts?.failUpload
            ? { data: null, error: { message: "boom-upload" } }
            : {
                data: { path, signedUrl: `https://cdn/${path}?u=1`, token: "t" },
                error: null,
              },
        ),
        createSignedUrl: vi.fn(async (path: string, ttl: number) =>
          opts?.failRead
            ? { data: null, error: { message: "boom-read" } }
            : { data: { signedUrl: `https://cdn/${path}?ttl=${ttl}` }, error: null },
        ),
      })),
    },
  };
}

describe("signed storage helpers (Plan 13B)", () => {
  it("createSignedUpload happy path returns path + url", async () => {
    const sb = mkClient();
    const out = await createSignedUpload(sb as never, "org-cac-certs", "orgs/x/cac-cert.pdf");
    expect(out.path).toBe("orgs/x/cac-cert.pdf");
    expect(out.signedUrl).toContain("https://cdn/");
    expect(out.token).toBe("t");
  });

  it("createSignedUpload surfaces Supabase error as SignedStorageError", async () => {
    const sb = mkClient({ failUpload: true });
    await expect(
      createSignedUpload(sb as never, "dispute-evidence", "disputes/d/f.png"),
    ).rejects.toThrow(SignedStorageError);
  });

  it("createSignedRead defaults to 300s TTL", async () => {
    const sb = mkClient();
    const url = await createSignedRead(sb as never, "appeal-evidence", "appeals/a/f.png");
    expect(url).toContain("ttl=300");
  });

  it("trySignedRead returns null on failure instead of throwing", async () => {
    const sb = mkClient({ failRead: true });
    const out = await trySignedRead(sb as never, "org-contracts", "orgs/x/contracts/c.pdf");
    expect(out).toBeNull();
  });

  it("trySignedRead returns null for empty path without calling storage", async () => {
    const sb = mkClient();
    const out = await trySignedRead(sb as never, "org-cac-certs", null);
    expect(out).toBeNull();
  });
});
