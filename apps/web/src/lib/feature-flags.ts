/**
 * Feature flags — env-driven, read once at module load.
 *
 * The string comparison is strict ('true' literal only) — any other
 * value (including 'TRUE', '1', 'yes') is treated as off when
 * env-gated. Hardcoded flags ignore env entirely.
 *
 * Wave 1A flags (overlay builder):
 *   - overlayBuilder.enabled              — admin route + UI visibility
 *     ALWAYS ON (2026-05-25 unlock): Wave 1A→3B shipped + verified.
 *     Hardcoded to true so producers/designers can use Builder for any
 *     event/brand without an env-var dance per environment.
 *   - overlayBuilder.publishEnabled       — allow Publish action (Wave 1A end)
 *     ALWAYS ON (2026-05-25 unlock): Publish flow is the whole point.
 *   - overlayBuilder.photopeaEnabled      — Photopea iframe route (Wave 2B)
 *     STILL ENV-GATED: Wave-2A real PSD upload deferred; only enable
 *     after PSD pipeline verified end-to-end.
 *   - overlayBuilder.sequenceModeEnabled  — multi-scene authoring + sequence runtime (Wave 3A)
 *     STILL ENV-GATED: Wave-3B timeline-keyframe-inspector regression
 *     pending; only enable after that closes.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §15
 */

const isTrue = (value: string | undefined): boolean => value === "true";

export const featureFlags = {
  overlayBuilder: {
    enabled: true,
    publishEnabled: true,
    photopeaEnabled: isTrue(
      process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED,
    ),
    sequenceModeEnabled: isTrue(
      process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED,
    ),
  },
} as const;

export type FeatureFlags = typeof featureFlags;
