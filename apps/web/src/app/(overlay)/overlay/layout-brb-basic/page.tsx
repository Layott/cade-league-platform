"use client";

import { PreviewStub } from "../PreviewStub";
import { layoutBrbBasicSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function LayoutBrbBasicPage() {
  return (
    <PreviewStub
      templateKey="layout_brb_basic"
      schema={layoutBrbBasicSchema}
      position="center"
      render={(p) => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "var(--ink-0)",
            color: "var(--chalk-0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="font-broadcast-display" style={{ fontSize: 180, color: "var(--primary)" }}>
            {p.message ?? "BE RIGHT BACK"}
          </div>
        </div>
      )}
    />
  );
}
