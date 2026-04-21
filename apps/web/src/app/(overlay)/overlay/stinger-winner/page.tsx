"use client";

import { PreviewStub } from "../PreviewStub";
import { stingerWinnerSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StingerWinnerPage() {
  return (
    <PreviewStub
      templateKey="stinger_winner"
      schema={stingerWinnerSchema}
      position="center"
      render={(p) => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "var(--ink-0)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--chalk-0)",
            gap: 16,
          }}
        >
          <div
            className="font-broadcast-accent"
            style={{ fontSize: 24, color: "var(--primary)" }}
          >
            WINNER
          </div>
          <div
            className="font-broadcast-display"
            style={{ fontSize: 140, color: "var(--primary)" }}
          >
            {p.winnerDisplayName}
          </div>
          {p.finalScore ? (
            <div
              className="tabular"
              style={{ fontSize: 48, color: "var(--chalk-2)" }}
            >
              {p.finalScore.home} — {p.finalScore.away}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
