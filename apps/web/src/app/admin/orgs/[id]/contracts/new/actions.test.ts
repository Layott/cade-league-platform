import { describe, it, expect } from "vitest";
import { createContractFormSchema } from "./actions";

const OID = "00000000-0000-4000-8000-000000000001";
const PID = "00000000-0000-4000-8000-000000000002";
const SID = "00000000-0000-4000-8000-000000000003";

describe("createContractFormSchema (Plan 13B)", () => {
  it("rejects validUntil < validFrom", () => {
    const r = createContractFormSchema.safeParse({
      organizationId: OID,
      playerId: PID,
      seasonId: SID,
      contractPath: "orgs/o/contracts/c.pdf",
      validFrom: "2026-10-01",
      validUntil: "2026-09-01",
      status: "draft",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("validUntil"))).toBe(
        true,
      );
    }
  });

  it("accepts equal from/until (same-day window allowed)", () => {
    const r = createContractFormSchema.parse({
      organizationId: OID,
      playerId: PID,
      seasonId: SID,
      contractPath: "orgs/o/contracts/c.pdf",
      validFrom: "2026-10-01",
      validUntil: "2026-10-01",
    });
    expect(r.validFrom).toBe("2026-10-01");
  });

  it("requires contract path", () => {
    const r = createContractFormSchema.safeParse({
      organizationId: OID,
      playerId: PID,
      seasonId: SID,
      contractPath: "",
      validFrom: "2026-10-01",
      validUntil: "2026-12-31",
    });
    expect(r.success).toBe(false);
  });
});
