import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Verifies that the builder library route calls notFound() when
 * NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED is unset.
 *
 * When the flag is true the feature-flag gate does NOT call notFound();
 * the page then proceeds to Supabase auth which will throw (no real DB
 * in unit test env) — we verify the mock was never called before that
 * throw by checking call count before the downstream failure.
 */
describe("/admin/broadcast/v2/builder feature-flag gate", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("calls notFound() when overlayBuilder.enabled is false", async () => {
    // notFound must throw so the page component actually stops execution
    // at the flag gate — matches Next.js runtime behavior.
    vi.doMock("next/navigation", () => ({
      notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
      }),
      redirect: vi.fn(),
    }));
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED;
    const { notFound } = await import("next/navigation");
    const { default: page } = await import("./page");
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("does NOT call notFound() when overlayBuilder.enabled is true", async () => {
    // notFound does NOT throw here so we can distinguish: if the flag
    // gate fires we record it, if downstream Supabase throws that is a
    // different error. We only assert notFound call count = 0.
    const notFoundSpy = vi.fn();
    vi.doMock("next/navigation", () => ({
      notFound: notFoundSpy,
      redirect: vi.fn(),
    }));
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED = "true";
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
