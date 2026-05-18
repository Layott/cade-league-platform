import Link from "next/link";
import type { JSX } from "react";

/**
 * Wave 2B — entry point into the Photopea iframe page.
 *
 * Renders only on PSD-type assets AND only when the parent surface
 * has confirmed the photopea flag is on. The flag is passed as a
 * prop rather than read here so server components decide visibility
 * once at render time (no client-side flag flicker).
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2
 */
export type OpenInPhotopeaButtonProps = {
  designSlug: string;
  assetId: string;
  assetType: "image" | "psd" | "font" | string;
  photopeaEnabled: boolean;
};

export function OpenInPhotopeaButton({
  designSlug,
  assetId,
  assetType,
  photopeaEnabled,
}: OpenInPhotopeaButtonProps): JSX.Element | null {
  if (assetType !== "psd" || !photopeaEnabled) return null;
  const href = `/admin/broadcast/v2/builder/${designSlug}/psd?assetId=${assetId}`;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ink-4)] px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--chalk-2)] hover:bg-[var(--ink-2)]"
    >
      Open in Photopea
    </Link>
  );
}
