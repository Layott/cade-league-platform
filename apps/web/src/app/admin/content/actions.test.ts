import { describe, it, expect } from "vitest";
import { rejectPostFormSchema, verifyPostFormSchema } from "./actions";

const PID = "00000000-0000-4000-8000-000000000001";

describe("content admin action schemas (Plan 13B)", () => {
  it("rejectPostFormSchema requires reason length >= 10", () => {
    const bad = rejectPostFormSchema.safeParse({ postId: PID, reason: "nope" });
    expect(bad.success).toBe(false);
  });

  it("rejectPostFormSchema accepts reason >=10 chars", () => {
    const ok = rejectPostFormSchema.parse({
      postId: PID,
      reason: "URL does not resolve (404).",
    });
    expect(ok.reason.length).toBeGreaterThanOrEqual(10);
  });

  it("verifyPostFormSchema rejects non-uuid post id", () => {
    const r = verifyPostFormSchema.safeParse({ postId: "nope" });
    expect(r.success).toBe(false);
  });
});
