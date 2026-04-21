import { describe, it, expect } from "vitest";
import { submitAppealFormSchema } from "./schemas";

const CID = "00000000-0000-4000-8000-00000000aaaa";

describe("submitAppealFormSchema (Plan 13B)", () => {
  it("requires a caseId in uuid form", () => {
    const r = submitAppealFormSchema.safeParse({
      caseId: "not-uuid",
      grounds: "a".repeat(60),
    });
    expect(r.success).toBe(false);
  });

  it("rejects grounds < 40 chars", () => {
    const r = submitAppealFormSchema.safeParse({
      caseId: CID,
      grounds: "too short",
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid caseId + grounds", () => {
    const r = submitAppealFormSchema.parse({
      caseId: CID,
      grounds:
        "I believe the sanction was applied in error because the incident was misidentified on replay.",
    });
    expect(r.caseId).toBe(CID);
    expect(r.grounds.length).toBeGreaterThanOrEqual(40);
  });

  it("caps evidencePaths at 3", () => {
    const r = submitAppealFormSchema.safeParse({
      caseId: CID,
      grounds: "x".repeat(50),
      evidencePaths: ["a", "b", "c", "d"],
    });
    expect(r.success).toBe(false);
  });
});
