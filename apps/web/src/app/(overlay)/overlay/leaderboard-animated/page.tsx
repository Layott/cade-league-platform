"use client";

import { PreviewStub } from "../PreviewStub";
import { leaderboardAnimatedSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function LeaderboardAnimatedPage() {
  return (
    <PreviewStub
      templateKey="leaderboard_animated"
      schema={leaderboardAnimatedSchema}
      position="top-right"
      render={(p) => (
        <div
          style={{
            width: 520,
            background: "rgba(11,14,17,0.94)",
            border: "1px solid var(--ink-5)",
            borderRadius: 6,
            color: "var(--chalk-0)",
            padding: "20px 24px",
          }}
        >
          <div
            className="font-broadcast-accent"
            style={{ fontSize: 12, color: "var(--primary)", marginBottom: 14 }}
          >
            LEADERBOARD
          </div>
          {p.rows.slice(0, p.topN).map((r) => (
            <div
              key={r.rank}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid var(--ink-4)",
                background: r.rank === 1 ? "var(--primary-glow)" : "transparent",
              }}
            >
              <span
                className="tabular"
                style={{ width: 32, color: "var(--chalk-2)" }}
              >
                {r.rank}
              </span>
              <span style={{ flex: 1 }}>{r.displayName}</span>
              <span
                className="tabular"
                style={{ width: 60, textAlign: "right", color: "var(--chalk-2)" }}
              >
                {r.gd >= 0 ? "+" : ""}
                {r.gd}
              </span>
              <span
                className="tabular"
                style={{ width: 60, textAlign: "right", color: "var(--primary)" }}
              >
                {r.pts}
              </span>
            </div>
          ))}
        </div>
      )}
    />
  );
}
