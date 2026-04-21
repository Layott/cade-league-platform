"use client";

import { PreviewStub } from "../PreviewStub";
import { h2h3Schema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function H2H3Page() {
  return (
    <PreviewStub
      templateKey="h2h_3"
      schema={h2h3Schema}
      position="center"
      render={(p) => (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "var(--ink-0)",
            color: "var(--chalk-0)",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            alignItems: "center",
            justifyItems: "center",
            gap: 40,
            padding: 80,
          }}
        >
          {p.players.map((pl, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div
                className="font-broadcast-display"
                style={{ fontSize: 48, color: "var(--primary)" }}
              >
                {pl.displayName}
              </div>
            </div>
          ))}
        </div>
      )}
    />
  );
}
