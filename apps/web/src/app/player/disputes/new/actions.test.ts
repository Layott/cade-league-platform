import { describe, it, expect } from "vitest";
import { submitDisputeFormSchema } from "./actions";

describe("submitDisputeFormSchema (Plan 13B)", () => {
  it("rejects description < 20 chars", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "match",
      description: "too short",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a normal grievance", () => {
    const r = submitDisputeFormSchema.parse({
      subjectType: "match",
      description: "The referee awarded the match wrongly — missed offside.",
    });
    expect(r.description.length).toBeGreaterThanOrEqual(20);
  });

  it("rejects malformed subjectId", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "match",
      subjectId: "not-uuid",
      description: "A very long well-formed complaint body here.",
    });
    expect(r.success).toBe(false);
  });

  it("caps evidencePaths at 3", () => {
    const paths = ["a", "b", "c", "d"];
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "other",
      description: "This must be at least twenty characters long…",
      evidencePaths: paths,
    });
    expect(r.success).toBe(false);
  });
});
