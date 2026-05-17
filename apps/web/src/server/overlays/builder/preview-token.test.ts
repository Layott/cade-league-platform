import { describe, expect, it } from "vitest";
import { issuePreviewToken, verifyPreviewToken } from "./preview-token";

describe("preview-token", () => {
  it("issues + verifies a token for the right slug", async () => {
    const token = issuePreviewToken({ slug: "my-design", userId: "u-1", roles: ["admin"] });
    const v = await verifyPreviewToken(token, "my-design");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.actor.userId).toBe("u-1");
  });

  it("round-trip preserves roles", async () => {
    const token = issuePreviewToken({ slug: "test-slug", userId: "u-2", roles: ["admin", "design"] });
    const v = await verifyPreviewToken(token, "test-slug");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.actor.roles).toContain("admin");
      expect(v.actor.roles).toContain("design");
    }
  });

  it("rejects mismatched slug", async () => {
    const token = issuePreviewToken({ slug: "a", userId: "u-1", roles: ["admin"] });
    const v = await verifyPreviewToken(token, "b");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("wrong_slug");
  });

  it("rejects tampered signature", async () => {
    const token = issuePreviewToken({ slug: "x", userId: "u-1", roles: ["admin"] });
    const tampered = token.slice(0, -3) + "AAA";
    const v = await verifyPreviewToken(tampered, "x");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad_sig");
  });

  it("rejects token with no dot separator (malformed)", async () => {
    const v = await verifyPreviewToken("nodottoken", "x");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("malformed");
  });

  it("rejects expired token", async () => {
    const original = Date.now;
    // Issue token as if we were 16 minutes in the past (15-min window)
    const past = Date.now() - 16 * 60 * 1000;
    Date.now = () => past;
    const token = issuePreviewToken({ slug: "y", userId: "u-1", roles: ["admin"] });
    Date.now = original;
    const v = await verifyPreviewToken(token, "y");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("expired");
  });

  it("accepts token issued just inside the 15-min window", async () => {
    const original = Date.now;
    // Issue token 14 minutes ago
    const recent = Date.now() - 14 * 60 * 1000;
    Date.now = () => recent;
    const token = issuePreviewToken({ slug: "z", userId: "u-1", roles: ["admin"] });
    Date.now = original;
    const v = await verifyPreviewToken(token, "z");
    expect(v.ok).toBe(true);
  });
});
