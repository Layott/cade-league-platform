import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("featureFlags.overlayBuilder", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED;
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PUBLISH_ENABLED;
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED;
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("hardcodes overlay-builder enabled + publishEnabled to true (2026-05-25 unlock)", async () => {
    const { featureFlags } = await import("./feature-flags");
    expect(featureFlags.overlayBuilder.enabled).toBe(true);
    expect(featureFlags.overlayBuilder.publishEnabled).toBe(true);
    expect(featureFlags.overlayBuilder.photopeaEnabled).toBe(false);
    expect(featureFlags.overlayBuilder.sequenceModeEnabled).toBe(false);
  });

  it("env vars cannot turn off the hardcoded enabled/publishEnabled flags", async () => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED = "false";
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PUBLISH_ENABLED = "false";
    const { featureFlags } = await import("./feature-flags");
    expect(featureFlags.overlayBuilder.enabled).toBe(true);
    expect(featureFlags.overlayBuilder.publishEnabled).toBe(true);
  });

  it("treats any non-'true' string as false for env-gated flags (typo guard)", async () => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "yes";
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED = "1";
    const { featureFlags } = await import("./feature-flags");
    expect(featureFlags.overlayBuilder.photopeaEnabled).toBe(false);
    expect(featureFlags.overlayBuilder.sequenceModeEnabled).toBe(false);
  });

  it("turns on sequenceModeEnabled only when its env var is 'true'", async () => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED = "true";
    const { featureFlags } = await import("./feature-flags");
    expect(featureFlags.overlayBuilder.sequenceModeEnabled).toBe(true);
    expect(featureFlags.overlayBuilder.photopeaEnabled).toBe(false);
  });
});
