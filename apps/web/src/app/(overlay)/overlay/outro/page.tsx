"use client";

// TODO Plan 48 phase 2 — design parity
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useOverlayChannel } from "../../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../../OverlayFrame";
import { outroSchema } from "@/server/overlays/schemas";
import { OverlayFrame as Frame1920 } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

export default function OutroPage() {
  return (
    <Frame1920>
  <Suspense fallback={null}>
        <OutroInner />
      </Suspense>
    </Frame1920>
  );
}

function OutroInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayChannel(sessionId, "outro");
  const parsed = state.payload
    ? outroSchema.safeParse(state.payload)
    : null;

  return (
    <OverlayFrame state={state} debug={getDebugFlag()} position="center">
      {parsed && parsed.success ? (
        <div
          data-testid="outro-card"
          className="font-display"
          style={{
            padding: "40px 60px",
            background: "rgba(7,8,11,0.96)",
            border: "2px solid var(--primary)",
            color: "#fff",
            textAlign: "center",
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
            Match day complete
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {parsed.data.matchDayLabel}
          </div>
          {parsed.data.footer ? (
            <div
              style={{
                marginTop: 14,
                color: "#a8adb8",
                fontSize: 14,
              }}
            >
              {parsed.data.footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </OverlayFrame>
  );
}
