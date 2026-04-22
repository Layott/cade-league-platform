import { describe, it, expect } from "vitest";
import {
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  softDeleteUserSchema,
  DEFAULT_DEV_PASSWORD,
} from "./schemas";

describe("createUserSchema", () => {
  it("accepts the minimal valid input (email + displayName)", () => {
    const out = createUserSchema.parse({
      email: "new@cade.local",
      displayName: "Newbie",
    });
    expect(out.email).toBe("new@cade.local");
    expect(out.displayName).toBe("Newbie");
    expect(out.gamerTag).toBeUndefined();
  });

  it("rejects an invalid email", () => {
    expect(() =>
      createUserSchema.parse({ email: "not-an-email", displayName: "x" }),
    ).toThrow();
  });

  it("rejects empty displayName", () => {
    expect(() =>
      createUserSchema.parse({ email: "a@b.co", displayName: "" }),
    ).toThrow();
  });

  it("rejects jersey 0 or > 99", () => {
    expect(() =>
      createUserSchema.parse({
        email: "a@b.co",
        displayName: "x",
        jerseyNumber: 0,
      }),
    ).toThrow();
    expect(() =>
      createUserSchema.parse({
        email: "a@b.co",
        displayName: "x",
        jerseyNumber: 100,
      }),
    ).toThrow();
  });

  it("rejects unknown role", () => {
    expect(() =>
      createUserSchema.parse({
        email: "a@b.co",
        displayName: "x",
        roles: ["super-saiyan"],
      }),
    ).toThrow();
  });
});

describe("updateUserSchema", () => {
  it("requires an id", () => {
    expect(() =>
      updateUserSchema.parse({ displayName: "X" }),
    ).toThrow();
  });

  it("accepts a partial body", () => {
    const out = updateUserSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "X",
    });
    expect(out.displayName).toBe("X");
    expect(out.gamerTag).toBeUndefined();
  });
});

describe("resetUserPasswordSchema", () => {
  it("enforces 8-char minimum", () => {
    expect(() =>
      resetUserPasswordSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        newPassword: "short",
      }),
    ).toThrow();
  });

  it("accepts an 8-char password", () => {
    const out = resetUserPasswordSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      newPassword: "abcd1234",
    });
    expect(out.newPassword).toBe("abcd1234");
  });
});

describe("softDeleteUserSchema", () => {
  it("requires uuid", () => {
    expect(() =>
      softDeleteUserSchema.parse({ id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("DEFAULT_DEV_PASSWORD", () => {
  it("is the documented dev placeholder", () => {
    expect(DEFAULT_DEV_PASSWORD).toBe("dev-temp-2026");
  });
});
