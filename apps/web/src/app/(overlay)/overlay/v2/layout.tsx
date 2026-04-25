import type { ReactNode } from "react";

/**
 * Plan 51 — /overlay/v2/* sub-tree.
 *
 * The parent (overlay) route-group layout already mounts
 * `OverlayBodyTransparent` so the document background goes transparent
 * for browser-source compositing. This nested layout is a pure
 * pass-through wrapper today; sibling agent UI-OV fills in the
 * individual overlay pages at /overlay/v2/<key>/page.tsx.
 *
 * Auth: routes under /overlay/v2/* are publicly readable (browser
 * sources pull without cookies); per-overlay view_token validation
 * happens inside each page against the session row. Middleware matcher
 * lists this prefix so future view_token enforcement can hook in.
 */

export default function OverlayV2Layout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
