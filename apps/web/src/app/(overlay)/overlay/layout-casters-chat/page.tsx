"use client";

// TODO Plan 48 phase 2 — design parity
import { PreviewStub } from "../PreviewStub";
import { layoutCastersChatSchema } from "@/server/overlays/schemas";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

export default function LayoutCastersChatPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="layout_casters_chat"
        schema={layoutCastersChatSchema}
        position="center"
        render={(p) => (
          <div
            style={{
              width: "100vw",
              height: "100vh",
              display: "grid",
              gridTemplateColumns: "1fr 420px",
              gridTemplateRows: "1fr 60px",
              background: "var(--ink-0)",
              color: "var(--chalk-0)",
            }}
          >
            <div style={{ background: "var(--ink-1)" }} />
            <div
              style={{
                background: "rgba(11,14,17,0.96)",
                borderLeft: "1px solid var(--ink-4)",
                padding: "16px 20px",
                overflow: "hidden",
              }}
            >
              {(p.chat ?? []).slice(-10).map((m, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <span
                    className="font-broadcast-accent"
                    style={{ fontSize: 14, color: "var(--primary)" }}
                  >
                    {m.user}
                  </span>
                  <span style={{ fontSize: 14, marginLeft: 8, color: "var(--chalk-1)" }}>
                    {m.msg}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="tabular"
              style={{
                gridColumn: "1 / span 2",
                background: "var(--ink-2)",
                padding: "16px 32px",
                fontSize: 14,
                color: "var(--chalk-1)",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {p.ticker ?? ""}
            </div>
          </div>
        )}
      />
    </OverlayFrame>
  );
}
