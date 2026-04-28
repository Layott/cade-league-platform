import { describe, it, expect } from "vitest";
import {
  assignPanelFormSchema,
  ruleAppealFormSchema,
  undoRulingFormSchema,
} from "./schemas";

const AID = "00000000-0000-4000-8000-00000000eeee";
const U1 = "00000000-0000-4000-8000-000000000011";
const U2 = "00000000-0000-4000-8000-000000000022";
const U3 = "00000000-0000-4000-8000-000000000033";

describe("appeals action schemas (Plan 13B)", () => {
  it("assignPanelFormSchema rejects duplicate user ids", () => {
    const r = assignPanelFormSchema.safeParse({
      appealId: AID,
      member1: U1,
      member2: U1,
      member3: U2,
    });
    expect(r.success).toBe(false);
  });

  it("assignPanelFormSchema rejects missing members (<3)", () => {
    const r = assignPanelFormSchema.safeParse({
      appealId: AID,
      member1: U1,
      member2: U2,
      member3: "",
    });
    expect(r.success).toBe(false);
  });

  it("assignPanelFormSchema accepts 3 distinct uuids", () => {
    const r = assignPanelFormSchema.parse({
      appealId: AID,
      member1: U1,
      member2: U2,
      member3: U3,
    });
    expect(r.member1).toBe(U1);
  });

  it("ruleAppealFormSchema requires non-empty ruling", () => {
    const r = ruleAppealFormSchema.safeParse({
      appealId: AID,
      ruling: "  ",
      outcome: "upheld",
    });
    expect(r.success).toBe(false);
  });

  it("ruleAppealFormSchema requires outcome in {upheld, dismissed} (Plan 50)", () => {
    const upheld = ruleAppealFormSchema.safeParse({
      appealId: AID,
      ruling: "panel agrees with appellant",
      outcome: "upheld",
    });
    expect(upheld.success).toBe(true);

    const dismissed = ruleAppealFormSchema.safeParse({
      appealId: AID,
      ruling: "panel stands by sanction",
      outcome: "dismissed",
    });
    expect(dismissed.success).toBe(true);

    const bogus = ruleAppealFormSchema.safeParse({
      appealId: AID,
      ruling: "x",
      outcome: "approved",
    });
    expect(bogus.success).toBe(false);

    const missing = ruleAppealFormSchema.safeParse({
      appealId: AID,
      ruling: "x",
    });
    expect(missing.success).toBe(false);
  });

  it("undoRulingFormSchema requires a uuid appealId (Plan 50)", () => {
    expect(
      undoRulingFormSchema.safeParse({ appealId: AID }).success,
    ).toBe(true);
    expect(
      undoRulingFormSchema.safeParse({ appealId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(undoRulingFormSchema.safeParse({}).success).toBe(false);
  });
});
