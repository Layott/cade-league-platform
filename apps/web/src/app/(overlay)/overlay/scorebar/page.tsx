"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useOverlayChannel } from "../../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../../OverlayFrame";
import { scorebarSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function ScorebarPage() {
  return (
    <Suspense fallback={null}>
      <ScorebarInner />
    </Suspense>
  );
}

function ScorebarInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayChannel(sessionId, "scorebar");

  // Defensive client-side re-validation of payload shape.
  let scored: ReturnType<typeof scorebarSchema.safeParse> | null = null;
  if (state.payload) scored = scorebarSchema.safeParse(state.payload);

  return (
    <OverlayFrame state={state} debug={getDebugFlag()} position="bottom-center">
      {scored && scored.success ? (
        <div
          data-testid="scorebar"
          className="font-display"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "14px 28px",
            background: "rgba(7,8,11,0.9)",
            border: "1px solid rgba(0,255,136,0.45)",
            borderLeft: "4px solid #00ff88",
            color: "#fff",
            fontSize: 22,
            letterSpacing: "-0.01em",
            boxShadow: "0 0 24px -4px rgba(0,255,136,0.22)",
          }}
        >
          <span data-testid="scorebar-home-name" style={{ fontWeight: 600 }}>
            {scored.data.homeName}
          </span>
          <span
            data-testid="scorebar-score"
            className="tabular"
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: "#00ff88",
              minWidth: 100,
              textAlign: "center",
            }}
          >
            {scored.data.homeScore}&nbsp;–&nbsp;{scored.data.awayScore}
          </span>
          <span data-testid="scorebar-away-name" style={{ fontWeight: 600 }}>
            {scored.data.awayName}
          </span>
        </div>
      ) : null}
    </OverlayFrame>
  );
}
