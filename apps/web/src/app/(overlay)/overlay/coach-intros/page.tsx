"use client";

// TODO Plan 48 phase 2 — design parity
import { PreviewStub } from "../PreviewStub";
import { coachIntrosSchema } from "@/server/overlays/schemas";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

export default function CoachIntrosPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="coach_intros"
        schema={coachIntrosSchema}
        position="center"
        render={(p) => (
          <div
            style={{
              width: "100vw",
              height: "100vh",
              background: "var(--ink-0)",
              color: "var(--chalk-0)",
              display: "grid",
              gridTemplateColumns: "540px 1fr",
              padding: 60,
              gap: 60,
              alignItems: "center",
            }}
          >
            <div
              style={{
                background: "var(--primary)",
                height: 720,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: 24,
              }}
            >
              <div
                className="font-broadcast-display"
                style={{ fontSize: 64, color: "var(--primary-ink)" }}
              >
                {p.coach.displayName}
              </div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <div
                className="font-broadcast-accent"
                style={{ fontSize: 14, color: "var(--primary)" }}
              >
                COACHED PLAYERS
              </div>
              {p.players.map((pl, i) => (
                <div
                  key={i}
                  style={{
                    padding: "12px 20px",
                    background: "var(--ink-2)",
                    borderLeft: "4px solid var(--primary)",
                  }}
                >
                  <span className="font-broadcast-accent" style={{ fontSize: 18 }}>
                    {pl.displayName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      />
    </OverlayFrame>
  );
}
