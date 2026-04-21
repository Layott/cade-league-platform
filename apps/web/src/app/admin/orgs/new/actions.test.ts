import { describe, it, expect } from "vitest";
import { createOrgFormSchema } from "./schemas";

describe("createOrgFormSchema (Plan 13B)", () => {
  it("rejects empty name", () => {
    const res = createOrgFormSchema.safeParse({ name: "" });
    expect(res.success).toBe(false);
  });

  it("accepts valid FormData shape with optional fields omitted", () => {
    const res = createOrgFormSchema.parse({
      name: "Lagos Crown Esports",
      cacNumber: "",
      cacCertPath: "",
      contactRepUserId: "",
    });
    expect(res.name).toBe("Lagos Crown Esports");
    expect(res.cacNumber).toBeUndefined();
    expect(res.cacCertPath).toBeUndefined();
    expect(res.contactRepUserId).toBeUndefined();
  });

  it("passes through populated optional fields", () => {
    const res = createOrgFormSchema.parse({
      name: "Abuja Eagles",
      cacNumber: "RC-99",
      cacCertPath: "orgs/x/cac-cert.pdf",
      contactRepUserId: "00000000-0000-4000-8000-000000000001",
    });
    expect(res.cacNumber).toBe("RC-99");
    expect(res.cacCertPath).toBe("orgs/x/cac-cert.pdf");
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
