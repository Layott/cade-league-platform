"use client";

import { PreviewStub } from "../PreviewStub";
import { stingerNormalSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StingerNormalPage() {
  return (
    <PreviewStub
      templateKey="stinger_normal"
      schema={stingerNormalSchema}
      position="center"
      render={() => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="font-broadcast-display"
            style={{ fontSize: 140, color: "var(--primary-ink)", letterSpacing: "-0.04em" }}
          >
            CADE
          </div>
        </div>
      )}
    />
  );
}
