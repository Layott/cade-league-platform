"use client";

// TODO Plan 48 phase 2 — design parity
import { PreviewStub } from "../PreviewStub";
import { layout2PipSchema } from "@/server/overlays/schemas";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

export default function Layout2PipPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="layout_2pip"
        schema={layout2PipSchema}
        position="center"
        render={(p) => (
          <div
            style={{
              width: "100vw",
              height: "100vh",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              background: "var(--primary)",
            }}
          >
            {p.cells.map((c, i) => (
              <div
                key={i}
                style={{
                  background: "var(--ink-1)",
                  color: "var(--chalk-0)",
                  display: "flex",
                  alignItems: "flex-end",
                  padding: 32,
                }}
              >
                <div
                  className="font-broadcast-accent"
                  style={{ fontSize: 28 }}
                >
                  {c.displayName}
                </div>
              </div>
            ))}
          </div>
        )}
      />
    </OverlayFrame>
  );
}
