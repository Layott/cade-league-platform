"use client";

import { PreviewStub } from "../PreviewStub";
import { layoutBrbFullSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function LayoutBrbFullPage() {
  return (
    <PreviewStub
      templateKey="layout_brb_full"
      schema={layoutBrbFullSchema}
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
            gap: 24,
          }}
        >
          <div className="font-broadcast-display" style={{ fontSize: 140, color: "var(--primary)" }}>
            BRB
          </div>
          <div
            className="tabular"
            style={{ fontSize: 48, color: "var(--chalk-0)" }}
          >
            {p.resumeAt
              ? new Date(p.resumeAt).toLocaleTimeString()
              : "00:00"}
          </div>
          {p.message ? (
            <div
              className="font-broadcast-accent"
              style={{ fontSize: 18, color: "var(--chalk-2)" }}
            >
              {p.message}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
