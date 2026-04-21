import { describe, it, expect } from "vitest";
import { saveAttendanceFormSchema } from "./actions";

const SID = "00000000-0000-4000-8000-000000000001";
const P1 = "00000000-0000-4000-8000-000000000002";
const P2 = "00000000-0000-4000-8000-000000000003";

describe("saveAttendanceFormSchema (Plan 13B)", () => {
  it("validates uuid array for player ids", () => {
    const r = saveAttendanceFormSchema.parse({
      shootId: SID,
      playerIds: [P1, P2],
    });
    expect(r.playerIds).toHaveLength(2);
  });

  it("rejects non-uuid shootId", () => {
    const r = saveAttendanceFormSchema.safeParse({
      shootId: "bad",
      playerIds: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-uuid player ids", () => {
    const r = saveAttendanceFormSchema.safeParse({
      shootId: SID,
      playerIds: ["nope"],
    });
    expect(r.success).toBe(false);
  });

  it("accepts empty player array (no-op save)", () => {
    const r = saveAttendanceFormSchema.parse({
      shootId: SID,
      playerIds: [],
    });
    expect(r.playerIds).toHaveLength(0);
  });
});
