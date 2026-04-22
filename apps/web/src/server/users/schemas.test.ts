import { describe, it, expect } from "vitest";
import {
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  softDeleteUserSchema,
  generateOneTimePassword,
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
  it("enforces 12-char minimum (Plan 39 raised from 8)", () => {
    expect(() =>
      resetUserPasswordSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        newPassword: "abcd1234",
      }),
    ).toThrow();
  });

  it("accepts a 12-char password", () => {
    const out = resetUserPasswordSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      newPassword: "abcd12345678",
    });
    expect(out.newPassword).toBe("abcd12345678");
  });
});

describe("softDeleteUserSchema", () => {
  it("requires uuid", () => {
    expect(() =>
      softDeleteUserSchema.parse({ id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("generateOneTimePassword (Plan 39 — replaces DEFAULT_DEV_PASSWORD)", () => {
  it("returns a base64url string at least 12 chars long", () => {
    const pw = generateOneTimePassword();
    expect(pw.length).toBeGreaterThanOrEqual(12);
    // base64url alphabet: A-Z a-z 0-9 _ -
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a different string on each call", () => {
    const a = generateOneTimePassword();
    const b = generateOneTimePassword();
    expect(a).not.toBe(b);
  });
});
