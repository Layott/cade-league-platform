import { describe, it, expect } from "vitest";
import { ruleDisputeFormSchema, assignDisputeFormSchema } from "./actions";

const DID = "00000000-0000-4000-8000-00000000dddd";
const UID = "00000000-0000-4000-8000-00000000aaaa";

describe("disputes action schemas (Plan 13B)", () => {
  it("ruleDisputeFormSchema requires non-empty ruling", () => {
    const r = ruleDisputeFormSchema.safeParse({
      disputeId: DID,
      ruling: "   ",
    });
    expect(r.success).toBe(false);
  });

  it("ruleDisputeFormSchema accepts real ruling text", () => {
    const r = ruleDisputeFormSchema.parse({
      disputeId: DID,
      ruling: "After review of evidence, the complaint is upheld.",
    });
    expect(r.disputeId).toBe(DID);
  });

  it("assignDisputeFormSchema requires uuid assignee", () => {
    const bad = assignDisputeFormSchema.safeParse({
      disputeId: DID,
      assignedToUserId: "not-uuid",
    });
    expect(bad.success).toBe(false);

    const ok = assignDisputeFormSchema.parse({
      disputeId: DID,
      assignedToUserId: UID,
    });
    expect(ok.assignedToUserId).toBe(UID);
  });
});
