"use client";

import { PreviewStub } from "../PreviewStub";
import { playerPenaltiesSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

const CHIP_COLOR: Record<string, string> = {
  point_deduction: "var(--flare)",
  gd_deduction: "var(--amber)",
  fine: "var(--primary-dim)",
  suspension: "var(--flare)",
  warning: "var(--ink-5)",
};

export default function PlayerPenaltiesPage() {
  return (
    <PreviewStub
      templateKey="player_penalties"
      schema={playerPenaltiesSchema}
      position="center"
      render={(p) => (
        <div
          style={{
            width: "min(820px, 84vw)",
            background: "rgba(5,6,7,0.95)",
            border: "1px solid var(--ink-4)",
            borderRadius: 8,
            padding: "28px 36px",
            color: "var(--chalk-0)",
          }}
        >
          <div
            className="font-broadcast-display"
            style={{ fontSize: 52, color: "var(--flare)", marginBottom: 20 }}
          >
            PENALTIES
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {p.rows.length === 0 ? (
              <div style={{ color: "var(--chalk-3)" }}>
                NO PENALTIES ISSUED
              </div>
            ) : (
              p.rows.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 60px 160px",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 14px",
                    background: "var(--ink-1)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="font-broadcast-accent"
                    style={{ fontSize: 20 }}
                  >
                    {r.displayName}
                  </span>
                  <span
                    className="tabular"
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      textAlign: "right",
                      color: "var(--chalk-0)",
                    }}
                  >
                    {r.count}
                  </span>
                  <span
                    className="tabular"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--chalk-0)",
                      background: CHIP_COLOR[r.sanctionType] ?? "var(--ink-5)",
                      padding: "4px 10px",
                      borderRadius: 3,
                      textAlign: "center",
                    }}
                  >
                    {r.sanctionType.replaceAll("_", " ")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    />
  );
}
