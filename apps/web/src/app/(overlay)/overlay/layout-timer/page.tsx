"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useMatchClock, formatClock } from "../../useMatchClock";
import { ENTER } from "@/lib/motion";

/**
 * Plan 37 — match-clock-driven timer overlay.
 *
 * Falls back to nothing when no clock row exists for the session.
 * Chrome from `KNOWLEDGE/brand-assets/elements/10_timer.html`:
 * corner-clipped panel, 2 px green border, AghartiWide tabular numerals,
 * pink expired-state.
 */

export const dynamic = "force-dynamic";

export default function LayoutTimerPage() {
  return (
    <Suspense fallback={null}>
      <TimerInner />
    </Suspense>
  );
}

function TimerInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const clock = useMatchClock(sessionId);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        background: "transparent",
      }}
      data-testid="overlay-root"
    >
      <AnimatePresence>
        {clock && clock.mode !== "stopped" ? (
          <motion.div
            key="timer-panel"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ ...ENTER, duration: 0.6 }}
            style={{
              position: "fixed",
              top: "60px",
              right: "60px",
              minWidth: "280px",
              padding: "16px 28px",
              background: "rgba(5, 8, 5, 0.96)",
              border: "2px solid var(--primary)",
              clipPath:
                "polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px)",
              boxShadow:
                "0 0 0 1px var(--primary-glow), inset 0 0 40px var(--primary-glow)",
              pointerEvents: "auto",
              textAlign: "center",
            }}
            data-testid="layout-timer"
          >
            <ClockBody
              displaySeconds={clock.displaySeconds}
              label={clock.label}
              urgent={
                clock.mode === "countdown" && clock.displaySeconds <= 5
              }
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ClockBody({
  displaySeconds,
  label,
  urgent,
}: {
  displaySeconds: number;
  label: string | null;
  urgent: boolean;
}) {
  const color = urgent ? "var(--secondary)" : "var(--primary)";
  const valueColor = urgent ? "var(--secondary)" : "var(--chalk-0)";
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          fontFamily: "Quedora, sans-serif",
          fontWeight: 700,
          fontSize: "12px",
          letterSpacing: "5px",
          textTransform: "uppercase",
          color,
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 8px ${color}`,
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        />
        <span>{label ?? "Timer"}</span>
      </div>
      <div
        className="tabular"
        style={{
          marginTop: "6px",
          fontFamily: "AghartiWide, sans-serif",
          fontWeight: 900,
          fontSize: "78px",
          lineHeight: 1,
          letterSpacing: "2px",
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
          textShadow: `0 0 24px ${color}`,
          animation: urgent ? "tpulse 0.5s infinite" : "none",
        }}
      >
        {formatClock(displaySeconds)}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.6); }
        }
        @keyframes tpulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(0.92); }
        }
      `}</style>
    </>
  );
}
