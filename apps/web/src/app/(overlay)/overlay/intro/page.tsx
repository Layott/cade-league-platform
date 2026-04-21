"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useOverlayChannel } from "../../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../../OverlayFrame";
import { introSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function IntroPage() {
  return (
    <Suspense fallback={null}>
      <IntroInner />
    </Suspense>
  );
}

function IntroInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayChannel(sessionId, "intro");
  const parsed = state.payload
    ? introSchema.safeParse(state.payload)
    : null;

  return (
    <OverlayFrame state={state} debug={getDebugFlag()} position="center">
      {parsed && parsed.success ? (
        <div
          data-testid="intro-card"
          className="font-display"
          style={{
            padding: "40px 60px",
            background: "rgba(7,8,11,0.95)",
            border: "2px solid var(--primary)",
            color: "#fff",
            textAlign: "center",
            minWidth: 520,
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: "var(--primary)",
              textTransform: "uppercase",
              letterSpacing: "0.28em",
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            {parsed.data.seasonLabel}
          </div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {parsed.data.matchDayLabel}
          </div>
        </div>
      ) : null}
    </OverlayFrame>
  );
}
