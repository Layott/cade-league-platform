"use client";

import { PreviewStub } from "../PreviewStub";
import { scoreBugSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function ScoreBugPage() {
  return (
    <PreviewStub
      templateKey="score_bug"
      schema={scoreBugSchema}
      position="bottom-left"
      render={(p) => {
        const [home, away] = p.players;
        const leader =
          home.score > away.score ? 0 : away.score > home.score ? 1 : -1;
        return (
          <div
            style={{
              display: "flex",
              gap: 0,
              background: "rgba(11,14,17,0.94)",
              border: "1px solid var(--ink-5)",
              borderRadius: 6,
              overflow: "hidden",
              color: "var(--chalk-0)",
              minWidth: 480,
            }}
          >
            {p.players.map((pl, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "12px 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background:
                    leader === i ? "var(--primary)" : "transparent",
                  color:
                    leader === i ? "var(--primary-ink)" : "var(--chalk-0)",
                }}
              >
                <span
                  className="font-broadcast-accent"
                  style={{ fontSize: 16 }}
                >
                  {pl.displayName}
                </span>
                <span
                  className="tabular"
                  style={{ fontSize: 36, fontWeight: 700 }}
                >
                  {pl.score}
                </span>
              </div>
            ))}
          </div>
        );
      }}
    />
  );
}
