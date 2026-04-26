import type { ReactNode } from "react";
import { OverlayBodyTransparent } from "./OverlayBodyTransparent";

/**
 * Plan 12 — (overlay) route group layout.
 *
 * Composites: root `layout.tsx` still provides `<html>` + `<body>` +
 * `<SiteChrome>`, but SiteChromeClient's HIDDEN_PREFIXES skips /overlay
 * so no nav/footer render. The OverlayBodyTransparent mount effect
 * tacks `.overlay-mode` onto `<html>` + `<body>` so the `!important`
 * overrides in globals.css kick in and the backgrounds go transparent.
 *
 * Overlay pages must render bare markup — browser sources (OBS, vMix,
 * Streamlabs, etc.) composite them onto the video output, so any stray
 * background or chrome will bleed.
 */
export default function OverlayLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html:
            "html,body{background:transparent!important;background-image:none!important;background-color:rgba(0,0,0,0)!important;color-scheme:normal!important}",
        }}
      />
      <OverlayBodyTransparent />
      {children}
    </>
  );
}
