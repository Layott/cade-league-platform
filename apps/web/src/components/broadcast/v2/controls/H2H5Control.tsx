"use client";

import { H2HControl } from "./H2HControl";
import type { SimpleControlProps } from "./BrbControl";

export function H2H5Control({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <H2HControl
      sessionId={sessionId}
      viewToken={viewToken}
      overlayKey="06-h2h-5"
      count={5}
      defaultSlugs={[
        "baji_jnr",
        "king_nonex",
        "faruk",
        "kaykay",
        "guru",
      ]}
      active={active}
    />
  );
}
