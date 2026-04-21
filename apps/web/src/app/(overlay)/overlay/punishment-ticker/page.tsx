"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useOverlayChannel } from "../../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../../OverlayFrame";
import { punishmentTickerSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function PunishmentTickerPage() {
  return (
    <Suspense fallback={null}>
      <PunishmentTickerInner />
    </Suspense>
  );
}

function PunishmentTickerInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayChannel(sessionId, "punishment_ticker");
  const parsed = state.payload
    ? punishmentTickerSchema.safeParse(state.payload)
    : null;

  return (
    <OverlayFrame state={state} debug={getDebugFlag()} position="bottom-center">
      {parsed && parsed.success ? (
        <div
          data-testid="punishment-ticker"
          style={{
            padding: "10px 18px",
            background: "rgba(7,8,11,0.94)",
            border: "1px solid rgba(255,91,59,0.4)",
            borderLeft: "4px solid #ff5b3b",
            color: "#fff",
            display: "flex",
            gap: 24,
            alignItems: "center",
            overflow: "hidden",
            maxWidth: "80vw",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#ff5b3b",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.22em",
            }}
          >
            Discipline
          </span>
          <div
            style={{
              display: "flex",
              gap: 18,
              whiteSpace: "nowrap",
              fontSize: 13,
            }}
          >
            {parsed.data.items.map((it, i) => (
              <span key={i}>
                <b>{it.playerName}</b>{" "}
                <span style={{ color: "#ffb020" }}>· {it.sanction}</span>{" "}
                {it.magnitude ? (
                  <span style={{ color: "#6b7280" }}>{it.magnitude}</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </OverlayFrame>
  );
}
