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

  it("admin has attendance.mark and attendance.edit", () => {
    expect(hasPerm({ userId: "u", roles: ["admin"] }, "attendance.mark")).toBe(true);
    expect(hasPerm({ userId: "u", roles: ["admin"] }, "attendance.edit")).toBe(true);
  });

  it("moderator has attendance.mark and attendance.edit", () => {
    expect(hasPerm({ userId: "u", roles: ["moderator"] }, "attendance.mark")).toBe(true);
    expect(hasPerm({ userId: "u", roles: ["moderator"] }, "attendance.edit")).toBe(true);
  });

  it("player does NOT have attendance.mark", () => {
    expect(hasPerm({ userId: "u", roles: ["player"] }, "attendance.mark")).toBe(false);
  });

  it("viewer does NOT have attendance.edit", () => {
    expect(hasPerm({ userId: null, roles: [] }, "attendance.edit")).toBe(false);
  });
});
