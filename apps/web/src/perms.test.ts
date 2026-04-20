import { describe, it, expect } from "vitest";
import { hasPerm } from "./perms";

describe("hasPerm", () => {
  it("admin matches a wildcard scope", () => {
    expect(hasPerm({ userId: null, roles: ["admin"] }, "matches.enter_score")).toBe(true);
  });

  it("moderator can publish announcements but not edit users", () => {
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "announcements.publish")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "users.delete")).toBe(false);
  });

  it("player cannot mark attendance", () => {
    expect(hasPerm({ userId: null, roles: ["player"] }, "attendance.mark")).toBe(false);
  });

  it("unauthenticated (no roles) can read public standings", () => {
    expect(hasPerm({ userId: null, roles: [] }, "standings.read.public")).toBe(true);
  });

  it("multi-role user gets union of permissions", () => {
    expect(hasPerm({ userId: null, roles: ["player", "moderator"] }, "punishments.issue")).toBe(true);
  });
});
