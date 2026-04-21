"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useOverlayChannel } from "../../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../../OverlayFrame";
import { playerCardSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function PlayerCardPage() {
  return (
    <Suspense fallback={null}>
      <PlayerCardInner />
    </Suspense>
  );
}

function PlayerCardInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayChannel(sessionId, "player_card");
  const parsed = state.payload
    ? playerCardSchema.safeParse(state.payload)
    : null;

  return (
    <OverlayFrame state={state} debug={getDebugFlag()} position="center">
      {parsed && parsed.success ? (
        <div
          data-testid="player-card"
          style={{
            padding: "22px 32px",
            background: "rgba(7,8,11,0.94)",
            border: "1px solid rgba(0,255,136,0.45)",
            borderLeft: "6px solid #00ff88",
            color: "#fff",
            minWidth: 360,
            boxShadow: "0 0 32px -6px rgba(0,255,136,0.28)",
          }}
        >
          <div
            className="font-display"
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            {parsed.data.displayName}
          </div>
          <div style={{ color: "#a8adb8", fontSize: 13 }}>
            @{parsed.data.gamerTag}
          </div>
          <div
            className="tabular"
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 10,
              fontSize: 13,
            }}
          >
            {(
              [
                ["GP", parsed.data.seasonStats.gp],
                ["W", parsed.data.seasonStats.w],
                ["D", parsed.data.seasonStats.d],
                ["L", parsed.data.seasonStats.l],
                ["GF", parsed.data.seasonStats.gf],
                ["GA", parsed.data.seasonStats.ga],
                ["PTS", parsed.data.seasonStats.pts],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <div
                  style={{
                    fontSize: 10,
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.18em",
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: k === "PTS" ? "#00ff88" : "#fff",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </OverlayFrame>
  );
}
