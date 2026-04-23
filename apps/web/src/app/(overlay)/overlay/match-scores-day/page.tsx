"use client";

// TODO Plan 48 phase 2 — design parity
import { PreviewStub } from "../PreviewStub";
import { matchScoresDaySchema } from "@/server/overlays/schemas";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

export default function MatchScoresDayPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="match_scores_day"
        schema={matchScoresDaySchema}
        position="center"
        render={(p) => (
          <div
            style={{
              width: "min(1200px, 92vw)",
              background: "rgba(5,6,7,0.96)",
              border: "1px solid var(--ink-4)",
              borderRadius: 8,
              padding: "28px 36px",
              color: "var(--chalk-0)",
            }}
          >
            <div
              className="font-broadcast-display"
              style={{ fontSize: 48, color: "var(--primary)", marginBottom: 20 }}
            >
              {p.matchDayLabel} — SCORES
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {p.rows.length === 0 ? (
                <div style={{ color: "var(--chalk-3)" }}>
                  NO MATCHES COMPLETED YET
                </div>
              ) : (
                p.rows.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 120px 1fr",
                      alignItems: "center",
                      padding: "10px 14px",
                      background:
                        r.status === "in_progress"
                          ? "rgba(255,176,32,0.1)"
                          : "var(--ink-1)",
                      borderRadius: 4,
                    }}
                  >
                    <span
                      className="font-broadcast-accent"
                      style={{ fontSize: 18 }}
                    >
                      {r.home}
                    </span>
                    <span
                      className="tabular"
                      style={{
                        fontSize: 24,
                        fontWeight: 700,
                        textAlign: "center",
                        color: "var(--primary)",
                      }}
                    >
                      {r.homeScore ?? "-"} — {r.awayScore ?? "-"}
                    </span>
                    <span
                      className="font-broadcast-accent"
                      style={{ fontSize: 18, textAlign: "right" }}
                    >
                      {r.away}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      />
    </OverlayFrame>
  );
}
