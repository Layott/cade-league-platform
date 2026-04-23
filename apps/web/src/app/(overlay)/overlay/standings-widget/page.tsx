"use client";

// TODO Plan 48 phase 2 — design parity
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useOverlayChannel } from "../../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../../OverlayFrame";
import { standingsWidgetSchema } from "@/server/overlays/schemas";
import { OverlayFrame as Frame1920 } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

export default function StandingsWidgetPage() {
  return (
    <Frame1920>
  <Suspense fallback={null}>
        <StandingsWidgetInner />
      </Suspense>
    </Frame1920>
  );
}

function StandingsWidgetInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayChannel(sessionId, "standings_widget");
  const parsed = state.payload
    ? standingsWidgetSchema.safeParse(state.payload)
    : null;

  return (
    <OverlayFrame state={state} debug={getDebugFlag()} position="top-right">
      {parsed && parsed.success ? (
        <div
          data-testid="standings-widget"
          style={{
            padding: "14px 18px",
            background: "rgba(7,8,11,0.93)",
            border: "1px solid rgba(107,205,6,0.35)",
            borderTop: "4px solid var(--primary)",
            color: "#fff",
            minWidth: 280,
          }}
        >
          <div
            className="font-display"
            style={{
              fontSize: 12,
              color: "var(--primary)",
              textTransform: "uppercase",
              letterSpacing: "0.22em",
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            Top {parsed.data.topN}
          </div>
          <table
            className="tabular"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
          >
            <tbody>
              {parsed.data.rows.map((r) => (
                <tr key={r.rank}>
                  <td
                    style={{
                      color: "#6b7280",
                      padding: "2px 4px",
                      width: 26,
                    }}
                  >
                    {r.rank}
                  </td>
                  <td style={{ color: "#fff", padding: "2px 4px" }}>
                    {r.displayName}
                  </td>
                  <td
                    style={{
                      color: "var(--primary)",
                      fontWeight: 700,
                      padding: "2px 4px",
                      textAlign: "right",
                    }}
                  >
                    {r.pts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </OverlayFrame>
  );
}
