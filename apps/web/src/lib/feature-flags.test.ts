import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("featureFlags.overlayBuilder", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED;
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PUBLISH_ENABLED;
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("defaults every overlay-builder flag to false when env vars absent", async () => {
    const { featureFlags } = await import("./feature-flags");
    expect(featureFlags.overlayBuilder.enabled).toBe(false);
    expect(featureFlags.overlayBuilder.publishEnabled).toBe(false);
    expect(featureFlags.overlayBuilder.photopeaEnabled).toBe(false);
  });

  it("flips a flag to true only when the env var equals the literal string 'true'", async () => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED = "true";
    const { featureFlags } = await import("./feature-flags");
    expect(featureFlags.overlayBuilder.enabled).toBe(true);
    expect(featureFlags.overlayBuilder.publishEnabled).toBe(false);
    expect(featureFlags.overlayBuilder.photopeaEnabled).toBe(false);
  });

  it("treats any non-'true' string as false (typo guard)", async () => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED = "TRUE";
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PUBLISH_ENABLED = "1";
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "yes";
    const { featureFlags } = await import("./feature-flags");
    expect(featureFlags.overlayBuilder.enabled).toBe(false);
    expect(featureFlags.overlayBuilder.publishEnabled).toBe(false);
    expect(featureFlags.overlayBuilder.photopeaEnabled).toBe(false);
  });
});
