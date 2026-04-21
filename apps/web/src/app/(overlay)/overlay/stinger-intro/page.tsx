"use client";

import { PreviewStub } from "../PreviewStub";
import { stingerIntroSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StingerIntroPage() {
  return (
    <PreviewStub
      templateKey="stinger_intro"
      schema={stingerIntroSchema}
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
          }}
        >
          <div
            className="font-broadcast-accent"
            style={{ fontSize: 28, color: "var(--primary)" }}
          >
            {p.matchDayLabel ?? p.seasonLabel}
          </div>
          <div
            className="font-broadcast-display"
            style={{ fontSize: 180, color: "var(--primary)", lineHeight: 1 }}
          >
            CADE
          </div>
          <div
            className="font-broadcast-accent"
            style={{ fontSize: 18, color: "var(--chalk-2)" }}
          >
            {p.seasonLabel}
          </div>
        </div>
      )}
    />
  );
}
