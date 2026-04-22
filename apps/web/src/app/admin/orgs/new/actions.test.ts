import { describe, it, expect } from "vitest";
import { createOrgFormSchema } from "./schemas";

describe("createOrgFormSchema (Plan 31 — CAC removed)", () => {
  it("rejects empty name", () => {
    const res = createOrgFormSchema.safeParse({ name: "" });
    expect(res.success).toBe(false);
  });

  it("accepts valid FormData shape with optional fields omitted", () => {
    const res = createOrgFormSchema.parse({
      name: "Lagos Crown Esports",
      logoPath: "",
      contactRepUserId: "",
    });
    expect(res.name).toBe("Lagos Crown Esports");
    expect(res.logoPath).toBeUndefined();
    expect(res.contactRepUserId).toBeUndefined();
  });

  it("passes through populated logoPath + contactRepUserId", () => {
    const res = createOrgFormSchema.parse({
      name: "Abuja Eagles",
      logoPath: "orgs/x/logo.png",
      contactRepUserId: "00000000-0000-4000-8000-000000000001",
    });
    expect(res.logoPath).toBe("orgs/x/logo.png");
    expect(res.contactRepUserId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects malformed contactRepUserId", () => {
    const res = createOrgFormSchema.safeParse({
      name: "X",
      contactRepUserId: "not-a-uuid",
    });
    expect(res.success).toBe(false);
  });
});
