"use client";

import { useEffect, useState } from "react";
import { PreviewStub } from "../PreviewStub";
import { layoutTimerSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

function fmt(ms: number): string {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function LayoutTimerPage() {
  return (
    <PreviewStub
      templateKey="layout_timer"
      schema={layoutTimerSchema}
      position="top-right"
      render={(p) => <TimerDisplay expiresAt={p.expiresAt} label={p.label} />}
    />
  );
}

function TimerDisplay({ expiresAt, label }: { expiresAt: string; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remaining = new Date(expiresAt).getTime() - now;
  const urgent = remaining < 5000;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 28px",
        background: "rgba(11,14,17,0.92)",
        border: "1px solid var(--ink-5)",
        borderRadius: 6,
        color: urgent ? "var(--secondary)" : "var(--chalk-0)",
      }}
    >
      {label ? (
        <div
          className="font-broadcast-accent"
          style={{ fontSize: 10, color: "var(--chalk-3)" }}
        >
          {label}
        </div>
      ) : null}
      <div className="tabular" style={{ fontSize: 56, fontWeight: 700 }}>
        {fmt(remaining)}
      </div>
    </div>
  );
}
