import { describe, it, expect } from "vitest";
import {
  assignPanelFormSchema,
  ruleAppealFormSchema,
} from "./actions";

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
    });
    expect(r.success).toBe(false);
  });
});
