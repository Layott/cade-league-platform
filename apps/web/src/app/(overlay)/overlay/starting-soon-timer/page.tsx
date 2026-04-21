"use client";

import { useEffect, useState } from "react";
import { PreviewStub } from "../PreviewStub";
import { startingSoonTimerSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

function fmt(ms: number): string {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function StartingSoonTimerPage() {
  return (
    <PreviewStub
      templateKey="starting_soon_timer"
      schema={startingSoonTimerSchema}
      position="center"
      render={(p) => <Inner startsAt={p.startsAt} />}
    />
  );
}

function Inner({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remaining = new Date(startsAt).getTime() - now;
  const flare = remaining < 10_000;
  return (
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
        gap: 24,
      }}
    >
      <div
        className="font-broadcast-display"
        style={{ fontSize: 140, color: "var(--primary)" }}
      >
        STARTING SOON
      </div>
      <div
        className="tabular"
        style={{
          fontSize: 120,
          color: flare ? "var(--secondary)" : "var(--chalk-0)",
          fontWeight: 700,
        }}
      >
        {fmt(remaining)}
      </div>
    </div>
  );
}
