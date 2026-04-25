"use client";

import { H2HControl } from "./H2HControl";
import type { SimpleControlProps } from "./BrbControl";

export function H2H3Control({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <H2HControl
      sessionId={sessionId}
      viewToken={viewToken}
      overlayKey="05-h2h-3"
      count={3}
      defaultSlugs={["baji_jnr", "king_nonex", "faruk"]}
      active={active}
    />
  );
}
