"use client";

import { PreviewStub } from "../PreviewStub";
import { orgsRosterSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

export default function OrgsRosterPage() {
  return (
    <PreviewStub
      templateKey="orgs_roster"
      schema={orgsRosterSchema}
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
            padding: 40,
            gap: 24,
          }}
        >
          <div
            className="font-broadcast-display"
            style={{ fontSize: 56, color: "var(--primary)" }}
          >
            {p.org.name}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              maxWidth: 1000,
            }}
          >
            {p.players.map((pl, i) => (
              <div
                key={i}
                style={{
                  padding: 16,
                  background: "var(--ink-2)",
                  border: "1px solid var(--ink-4)",
                  textAlign: "center",
                }}
              >
                <span
                  className="font-broadcast-accent"
                  style={{ fontSize: 18 }}
                >
                  {pl.displayName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    />
  );
}
