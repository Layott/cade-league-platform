"use client";

// TODO Plan 48 phase 2 — design parity
import { PreviewStub } from "../PreviewStub";
import { h2h2Schema } from "@/server/overlays/schemas";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

export default function H2H2Page() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="h2h_2"
        schema={h2h2Schema}
        position="center"
        render={(p) => (
          <div
            style={{
              width: "100vw",
              height: "100vh",
              background: "var(--ink-0)",
              color: "var(--chalk-0)",
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              justifyItems: "center",
              padding: "0 80px",
            }}
          >
            {[p.players[0], null, p.players[1]].map((pl, i) => {
              if (pl == null) {
                return (
                  <div
                    key={i}
                    className="font-broadcast-display"
                    style={{ fontSize: 96, color: "var(--primary)" }}
                  >
                    VS
                  </div>
                );
              }
              return (
                <div key={i} style={{ textAlign: "center" }}>
                  <div
                    className="font-broadcast-display"
                    style={{ fontSize: 56, color: "var(--chalk-0)" }}
                  >
                    {pl.displayName}
                  </div>
                  {pl.h2hStats ? (
                    <div
                      className="tabular"
                      style={{ fontSize: 18, color: "var(--chalk-2)" }}
                    >
                      W{pl.h2hStats.w} · D{pl.h2hStats.d} · L{pl.h2hStats.l}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      />
    </OverlayFrame>
  );
}
