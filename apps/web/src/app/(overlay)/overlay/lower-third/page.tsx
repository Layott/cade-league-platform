"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useOverlayChannel } from "../../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../../OverlayFrame";
import { lowerThirdSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function LowerThirdPage() {
  return (
    <Suspense fallback={null}>
      <LowerThirdInner />
    </Suspense>
  );
}

function LowerThirdInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayChannel(sessionId, "lower_third");
  const parsed = state.payload
    ? lowerThirdSchema.safeParse(state.payload)
    : null;

  return (
    <OverlayFrame state={state} debug={getDebugFlag()} position="bottom-left">
      {parsed && parsed.success ? (
        <div
          data-testid="lower-third"
          className="font-display"
          style={{
            padding: "16px 24px",
            background: "rgba(7,8,11,0.92)",
            border: "1px solid rgba(107,205,6,0.35)",
            borderLeft: "4px solid var(--primary)",
            color: "#fff",
            maxWidth: 480,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              className="tabular"
              style={{ color: "var(--primary)", fontSize: 14, fontWeight: 700 }}
            >
              #{parsed.data.jerseyNumber}
            </span>
            <span style={{ fontSize: 20, fontWeight: 700 }}>
              {parsed.data.displayName}
            </span>
          </div>
          <div style={{ color: "#a8adb8", fontSize: 13, marginTop: 2 }}>
            @{parsed.data.gamerTag}
          </div>
          {parsed.data.stats ? (
            <div
              className="tabular"
              style={{
                marginTop: 8,
                display: "flex",
                gap: 14,
                fontSize: 13,
                color: "#e8e9ec",
              }}
            >
              <span>GP {parsed.data.stats.gp}</span>
              <span>W {parsed.data.stats.w}</span>
              <span>D {parsed.data.stats.d}</span>
              <span>L {parsed.data.stats.l}</span>
              <span style={{ color: "var(--primary)", fontWeight: 700 }}>
                {parsed.data.stats.pts} PTS
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </OverlayFrame>
  );
}
