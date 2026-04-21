"use client";

import { PreviewStub } from "../PreviewStub";
import { stingerGoalSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StingerGoalPage() {
  return (
    <PreviewStub
      templateKey="stinger_goal"
      schema={stingerGoalSchema}
      position="center"
      render={(p) => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "var(--primary)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--primary-ink)",
          }}
        >
          <div
            className="font-broadcast-display"
            style={{ fontSize: 220, lineHeight: 1 }}
          >
            GOAL!
          </div>
          {p.scorerDisplayName ? (
            <div
              className="font-broadcast-accent"
              style={{ fontSize: 32, marginTop: 16 }}
            >
              {p.scorerDisplayName}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
