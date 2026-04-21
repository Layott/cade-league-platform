"use client";

import { PreviewStub } from "../PreviewStub";
import { topScorersSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function TopScorersPage() {
  return (
    <PreviewStub
      templateKey="top_scorers"
      schema={topScorersSchema}
      position="center"
      render={(p) => (
        <div
          style={{
            width: "min(820px, 80vw)",
            background: "rgba(5,6,7,0.95)",
            border: "1px solid var(--ink-4)",
            padding: "32px 48px",
            color: "var(--chalk-0)",
            borderRadius: 8,
          }}
        >
          <div
            className="font-broadcast-display"
            style={{ fontSize: 56, color: "var(--primary)", marginBottom: 24 }}
          >
            TOP 10 · GOLDEN PAD
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {p.rows.length === 0 ? (
              <div style={{ color: "var(--chalk-3)" }}>NO SCORERS YET</div>
            ) : (
              p.rows.map((r) => (
                <div
                  key={r.rank}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "48px 1fr 80px",
                    alignItems: "center",
                    padding: "10px 14px",
                    background:
                      r.rank === 1 ? "var(--primary-glow)" : "var(--ink-1)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="tabular"
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: r.rank === 1 ? "#ffd24a" : "var(--chalk-2)",
                    }}
                  >
                    {r.rank}
                  </span>
                  <span
                    className="font-broadcast-accent"
                    style={{ fontSize: 20 }}
                  >
                    {r.displayName}
                  </span>
                  <span
                    className="tabular"
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "var(--primary)",
                      textAlign: "right",
                    }}
                  >
                    {r.goals}
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
