import { describe, it, expect } from "vitest";
import { submitDisputeFormSchema } from "./schemas";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("submitDisputeFormSchema (Plan 13B rework)", () => {
  it("rejects description < 20 chars", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "match",
      subjectId: UUID,
      title: "Bad call",
      description: "too short",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a normal match-scoped grievance with a uuid", () => {
    const r = submitDisputeFormSchema.parse({
      subjectType: "match",
      subjectId: UUID,
      title: "Referee missed offside",
      description: "The referee awarded the match wrongly — missed offside.",
    });
    expect(r.description.length).toBeGreaterThanOrEqual(20);
    expect(r.subjectId).toBe(UUID);
  });

  it("rejects malformed subjectId", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "match",
      subjectId: "not-uuid",
      title: "Bad call",
      description: "A very long well-formed complaint body here.",
    });
    expect(r.success).toBe(false);
  });

  it("requires a subjectId for subjectType='match'", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "match",
      subjectId: "",
      title: "Bad call",
      description: "A very long well-formed complaint body here.",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("subjectId"))).toBe(
        true,
      );
    }
  });

  it("requires a subjectId for subjectType='sanction'", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "sanction",
      subjectId: "",
      title: "Unfair warning",
      description: "A very long well-formed complaint body here.",
    });
    expect(r.success).toBe(false);
  });

  it("allows empty subjectId for subjectType='other'", () => {
    const r = submitDisputeFormSchema.parse({
      subjectType: "other",
      subjectId: "",
      title: "General grievance",
      description: "A very long well-formed complaint body here.",
    });
    expect(r.subjectId).toBeUndefined();
  });

  it("allows empty subjectId for subjectType='registration'", () => {
    const r = submitDisputeFormSchema.parse({
      subjectType: "registration",
      subjectId: "",
      title: "Registration problem",
      description: "A very long well-formed complaint body here.",
    });
    expect(r.subjectId).toBeUndefined();
  });

  it("requires title at least 3 chars", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "other",
      title: "hi",
      description: "A very long well-formed complaint body here.",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("title"))).toBe(true);
    }
  });

  it("rejects title longer than 200 chars", () => {
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "other",
      title: "x".repeat(201),
      description: "A very long well-formed complaint body here.",
    });
    expect(r.success).toBe(false);
  });

  it("caps evidencePaths at 3", () => {
    const paths = ["a", "b", "c", "d"];
    const r = submitDisputeFormSchema.safeParse({
      subjectType: "other",
      title: "Some issue",
      description: "This must be at least twenty characters long…",
      evidencePaths: paths,
    });
    expect(r.success).toBe(false);
  });
});
