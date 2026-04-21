import { describe, it, expect } from "vitest";
import { hasPerm, PERMS, PUBLIC_PERMS, ROLE_NAMES, type RoleName } from "./perms";

describe("hasPerm (seed fallback)", () => {
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

describe("seed contract (Phase 1B 12-role matrix)", () => {
  it("ROLE_NAMES contains all 12 Phase 1B roles", () => {
    const expected: RoleName[] = [
      "admin",
      "loc",
      "idc",
      "referee",
      "technical",
      "production",
      "design",
      "moderator",
      "coach",
      "team_manager",
      "player",
      "viewer",
    ];
    expect(ROLE_NAMES.length).toBe(12);
    for (const r of expected) expect(ROLE_NAMES).toContain(r);
  });

  it("PERMS keys cover every role in ROLE_NAMES", () => {
    for (const r of ROLE_NAMES) {
      expect(Object.prototype.hasOwnProperty.call(PERMS, r)).toBe(true);
    }
  });

  it("PUBLIC_PERMS is unchanged from Phase 1A", () => {
    expect(PUBLIC_PERMS).toEqual([
      "matches.read.public",
      "standings.read.public",
      "announcements.read.public",
      "players.read.public",
      "fixtures.read.public",
      "punishments.read.public",
    ]);
  });

  it("new roles (loc/idc/referee/technical/production/design/coach/team_manager/viewer) seed to empty", () => {
    const empties: RoleName[] = [
      "loc",
      "idc",
      "referee",
      "technical",
      "production",
      "design",
      "coach",
      "team_manager",
      "viewer",
    ];
    for (const r of empties) {
      expect(PERMS[r].length).toBe(0);
    }
  });

  it("admin seed is the single '*' wildcard row (do not split)", () => {
    expect(PERMS.admin).toEqual(["*"]);
  });
});
