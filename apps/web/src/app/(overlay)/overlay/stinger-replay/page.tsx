"use client";

import { PreviewStub } from "../PreviewStub";
import { stingerReplaySchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StingerReplayPage() {
  return (
    <PreviewStub
      templateKey="stinger_replay"
      schema={stingerReplaySchema}
      position="center"
      render={() => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(135deg, var(--primary) 0 50%, var(--secondary) 50% 100%)",
          }}
        >
          <div
            className="font-broadcast-display"
            style={{ fontSize: 160, color: "var(--chalk-0)" }}
          >
            REPLAY
          </div>
        </div>
      )}
    />
  );
}
