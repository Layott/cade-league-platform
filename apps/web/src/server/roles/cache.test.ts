import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRolePerms, invalidate, __test } from "./cache";

type FromChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
};

function mkSb(data: { permission: string }[]) {
  const chain: FromChain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => Promise.resolve({ data, error: null })),
  };
  return { from: vi.fn(() => chain), _chain: chain } as unknown as {
    from: ReturnType<typeof vi.fn>;
    _chain: FromChain;
  };
}

describe("role perm cache", () => {
  beforeEach(() => {
    __test.clearAll();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches within the TTL — second call does not re-query the DB", async () => {
    const sb = mkSb([{ permission: "foo.bar" }, { permission: "baz.qux" }]);
    const a = await getRolePerms(sb as never, "moderator");
    expect(a).toEqual(["foo.bar", "baz.qux"]);
    // second call within TTL
    vi.setSystemTime(new Date("2026-04-28T00:00:10Z"));
    const b = await getRolePerms(sb as never, "moderator");
    expect(b).toEqual(["foo.bar", "baz.qux"]);
    expect(sb.from).toHaveBeenCalledTimes(1);
  });

  it("re-queries after the 30s TTL expires", async () => {
    const sb = mkSb([{ permission: "foo.bar" }]);
    await getRolePerms(sb as never, "player");
    vi.setSystemTime(new Date("2026-04-28T00:00:31Z")); // past 30s
    await getRolePerms(sb as never, "player");
    expect(sb.from).toHaveBeenCalledTimes(2);
  });

  it("invalidate(role) clears one entry but leaves others", async () => {
    const sb = mkSb([{ permission: "x.y" }]);
    await getRolePerms(sb as never, "admin");
    await getRolePerms(sb as never, "player");
    expect(__test.size()).toBe(2);
    invalidate("player");
    expect(__test.size()).toBe(1);
    // admin still cached — another call should not hit DB again.
    const before = sb.from.mock.calls.length;
    await getRolePerms(sb as never, "admin");
    expect(sb.from.mock.calls.length).toBe(before);
  });

  it("invalidate() with no arg clears all entries", async () => {
    const sb = mkSb([{ permission: "x.y" }]);
    await getRolePerms(sb as never, "admin");
    await getRolePerms(sb as never, "moderator");
    expect(__test.size()).toBe(2);
    invalidate();
    expect(__test.size()).toBe(0);
  });
});
