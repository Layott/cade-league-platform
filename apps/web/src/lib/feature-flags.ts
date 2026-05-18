/**
 * Feature flags — env-driven, read once at module load.
 *
 * Every flag defaults to `false` so a missing or typo'd env var
 * never accidentally turns a half-shipped feature on in production.
 * The string comparison is strict ('true' literal only) — any other
 * value (including 'TRUE', '1', 'yes') is treated as off.
 *
 * Wave 1A flags (overlay builder):
 *   - overlayBuilder.enabled              — admin route + UI visibility
 *   - overlayBuilder.publishEnabled       — allow Publish action (Wave 1A end)
 *   - overlayBuilder.photopeaEnabled      — Photopea iframe route (Wave 2B)
 *   - overlayBuilder.sequenceModeEnabled  — multi-scene authoring + sequence runtime (Wave 3A)
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §15
 */

const isTrue = (value: string | undefined): boolean => value === "true";

export const featureFlags = {
  overlayBuilder: {
    enabled: isTrue(process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED),
    publishEnabled: isTrue(
      process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PUBLISH_ENABLED,
    ),
    photopeaEnabled: isTrue(
      process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED,
    ),
    sequenceModeEnabled: isTrue(
      process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED,
    ),
  },
} as const;

export type FeatureFlags = typeof featureFlags;
