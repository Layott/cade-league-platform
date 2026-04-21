"use client";

import { PreviewStub } from "../PreviewStub";
import { streamEndedSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function StreamEndedPage() {
  return (
    <PreviewStub
      templateKey="stream_ended"
      schema={streamEndedSchema}
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
            style={{ fontSize: 180, letterSpacing: "-0.04em" }}
          >
            STREAM ENDED
          </div>
          <div
            className="font-broadcast-accent"
            style={{ fontSize: 28, color: "var(--primary)" }}
          >
            {p.subtitle ?? "THANKS FOR WATCHING"}
          </div>
          {p.socials ? (
            <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
              {Object.entries(p.socials).map(([k, v]) =>
                v ? (
                  <span
                    key={k}
                    className="font-broadcast-accent"
                    style={{ fontSize: 14, color: "var(--chalk-2)" }}
                  >
                    {k}: {v}
                  </span>
                ) : null,
              )}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
