"use client";

import { H2HControl } from "./H2HControl";
import type { SimpleControlProps } from "./BrbControl";

export function H2H2Control({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <H2HControl
      sessionId={sessionId}
      viewToken={viewToken}
      overlayKey="04-h2h-2"
      count={2}
      defaultSlugs={["baji_jnr", "king_nonex"]}
      active={active}
    />
  );
}
