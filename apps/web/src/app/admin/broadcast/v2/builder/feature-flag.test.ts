import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Verifies the builder library page no longer notFound()'s on the
 * overlay-builder flag (hardcoded ON 2026-05-25). Downstream Supabase
 * auth still throws in unit-test env — we only assert that notFound
 * was NOT the cause.
 */
describe("/admin/broadcast/v2/builder feature-flag gate", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("does NOT call notFound() — builder enabled is hardcoded true", async () => {
    const notFoundSpy = vi.fn();
    vi.doMock("next/navigation", () => ({
      notFound: notFoundSpy,
      redirect: vi.fn(),
    }));
    try {
      const { default: page } = await import("./page");
      await page();
    } catch {
      // Expected: Supabase / auth helpers throw in unit test env.
      // We only care that notFound was not the reason.
    }
    expect(notFoundSpy).not.toHaveBeenCalled();
  });
});
