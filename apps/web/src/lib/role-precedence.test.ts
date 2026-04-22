import { describe, it, expect } from "vitest";
import { ROLE_PRECEDENCE, highestRole } from "./role-precedence";

describe("ROLE_PRECEDENCE", () => {
  it("orders admin first and viewer last", () => {
    expect(ROLE_PRECEDENCE[0]).toBe("admin");
    expect(ROLE_PRECEDENCE[ROLE_PRECEDENCE.length - 1]).toBe("viewer");
  });

  it("contains every role exactly once", () => {
    const set = new Set(ROLE_PRECEDENCE);
    expect(set.size).toBe(ROLE_PRECEDENCE.length);
    expect(ROLE_PRECEDENCE.length).toBe(12);
  });
});

describe("highestRole", () => {
  it("returns null for empty input", () => {
    expect(highestRole([])).toBeNull();
  });

  it("returns the single role when only one is present", () => {
    expect(highestRole(["player"])).toBe("player");
    expect(highestRole(["referee"])).toBe("referee");
  });

  it("picks admin over player when both are present", () => {
    expect(highestRole(["player", "admin"])).toBe("admin");
    expect(highestRole(["admin", "player"])).toBe("admin");
  });

  it("picks moderator over team_manager over player", () => {
    expect(highestRole(["player", "team_manager", "moderator"])).toBe(
      "moderator",
    );
    expect(highestRole(["team_manager", "player"])).toBe("team_manager");
  });

  it("prefers loc over referee (both staff tiers)", () => {
    expect(highestRole(["referee", "loc"])).toBe("loc");
  });

  it("ignores unknown role strings", () => {
    expect(highestRole(["not-a-real-role", "player"])).toBe("player");
    expect(highestRole(["not-a-real-role"])).toBeNull();
  });

  it("returns viewer when only viewer is present", () => {
    expect(highestRole(["viewer"])).toBe("viewer");
  });

  it("returns the highest even with duplicates", () => {
    expect(highestRole(["player", "player", "referee", "player"])).toBe(
      "referee",
    );
  });
});
