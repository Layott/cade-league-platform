"use client";

import { PreviewStub } from "../PreviewStub";
import { upNextBugSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function UpNextBugPage() {
  return (
    <PreviewStub
      templateKey="up_next_bug"
      schema={upNextBugSchema}
      position="top-right"
      render={(p) => (
        <div
          style={{
            padding: "14px 20px",
            background: "rgba(20,24,32,0.96)",
            border: "1px solid var(--ink-5)",
            borderRadius: 6,
            color: "var(--chalk-0)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 420,
          }}
        >
          <div
            className="font-broadcast-accent"
            style={{ fontSize: 10, color: "var(--primary)" }}
          >
            UP NEXT · {new Date(p.kickoffAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              className="font-broadcast-accent"
              style={{ fontSize: 18, flex: 1 }}
            >
              {p.home.displayName}
            </span>
            <span
              style={{
                color: "var(--secondary)",
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              VS
            </span>
            <span
              className="font-broadcast-accent"
              style={{ fontSize: 18, flex: 1, textAlign: "right" }}
            >
              {p.away.displayName}
            </span>
          </div>
        </div>
      )}
    />
  );
}
