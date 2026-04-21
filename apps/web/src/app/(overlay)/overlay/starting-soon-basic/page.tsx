"use client";

import { PreviewStub } from "../PreviewStub";
import { startingSoonBasicSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StartingSoonBasicPage() {
  return (
    <PreviewStub
      templateKey="starting_soon_basic"
      schema={startingSoonBasicSchema}
      position="center"
      render={(p) => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "var(--ink-0)",
            color: "var(--chalk-0)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div
            className="font-broadcast-display"
            style={{ fontSize: 180, color: "var(--chalk-0)", letterSpacing: "-0.04em" }}
          >
            STARTING SOON
          </div>
          {p.subtitle ? (
            <div
              className="font-broadcast-accent"
              style={{ fontSize: 28, color: "var(--primary)" }}
            >
              {p.subtitle}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
