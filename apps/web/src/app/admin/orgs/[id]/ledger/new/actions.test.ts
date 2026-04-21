import { describe, it, expect } from "vitest";
import { recordLedgerEntryFormSchema } from "./actions";

const OID = "00000000-0000-4000-8000-000000000001";

describe("recordLedgerEntryFormSchema (Plan 13B)", () => {
  it("rejects amountCoins=0", () => {
    const r = recordLedgerEntryFormSchema.safeParse({
      orgId: OID,
      entryType: "deposit",
      amountCoins: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects adjustment without explicit direction", () => {
    const r = recordLedgerEntryFormSchema.safeParse({
      orgId: OID,
      entryType: "adjustment",
      amountCoins: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("direction"))).toBe(
        true,
      );
    }
  });

  it("accepts deposit without explicit direction (auto-derived)", () => {
    const r = recordLedgerEntryFormSchema.parse({
      orgId: OID,
      entryType: "deposit",
      amountCoins: 50_000,
      reference: "initial caution fee",
    });
    expect(r.entryType).toBe("deposit");
    expect(r.amountCoins).toBe(50_000);
  });

  it("accepts adjustment when direction provided", () => {
    const r = recordLedgerEntryFormSchema.parse({
      orgId: OID,
      entryType: "adjustment",
      direction: "credit",
      amountCoins: 500,
    });
    expect(r.direction).toBe("credit");
  });

  it("coerces amountCoins from string", () => {
    const r = recordLedgerEntryFormSchema.parse({
      orgId: OID,
      entryType: "fine_deduction",
      amountCoins: "5000",
    });
    expect(r.amountCoins).toBe(5000);
  });
});
