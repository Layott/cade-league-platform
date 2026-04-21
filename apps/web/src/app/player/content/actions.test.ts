import { describe, it, expect } from "vitest";
import { submitPostFormSchema } from "./actions";

const PID = "00000000-0000-4000-8000-000000000001";

describe("submitPostFormSchema (Plan 13B)", () => {
  it("rejects non-https URLs", () => {
    const bad = submitPostFormSchema.safeParse({
      playerId: PID,
      weekStart: "2026-05-04",
      platform: "instagram",
      postUrl: "http://instagram.com/p/abc",
    });
    expect(bad.success).toBe(false);
  });

  it("accepts https URLs", () => {
    const ok = submitPostFormSchema.parse({
      playerId: PID,
      weekStart: "2026-05-04",
      platform: "instagram",
      postUrl: "https://www.instagram.com/p/abcdef/",
    });
    expect(ok.postUrl).toContain("https://");
  });

  it("rejects weekStart not in YYYY-MM-DD", () => {
    const r = submitPostFormSchema.safeParse({
      playerId: PID,
      weekStart: "May 4",
      platform: "tiktok",
      postUrl: "https://tiktok.com/x",
    });
    expect(r.success).toBe(false);
  });

  it("restricts platform enum", () => {
    const r = submitPostFormSchema.safeParse({
      playerId: PID,
      weekStart: "2026-05-04",
      platform: "facebook",
      postUrl: "https://facebook.com/x",
    });
    expect(r.success).toBe(false);
  });
});
