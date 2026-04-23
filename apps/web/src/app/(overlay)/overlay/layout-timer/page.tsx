"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useMatchClock, formatClock } from "../../useMatchClock";
import { ENTER } from "@/lib/motion";
import { useOverlaySound } from "@/lib/overlay-sound";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

/**
 * Plan 37 + Plan 48 — match-clock-driven timer overlay.
 *
 * Plan 48 parity pass against `KNOWLEDGE/brand-assets/elements/10_timer.html`:
 *   - 1920×1080 OverlayFrame root; positioning switched to absolute so
 *     `?preview=1` scales the timer along with the frame.
 *   - 78 px AghartiWide value, 12 px Quedora label, 16 px chamfer on
 *     clip-path polygon — match reference exactly.
 *   - Panel padding tightened to 14/32/18 (matches ref), box-shadow adds
 *     inset green glow + outer pink accent when at 0 s / finalFlash.
 *
 * Plan 16 Wave A details preserved:
 *   - Position variants via ?pos=tl/tr/bl/br/top/bottom (default: tr).
 *   - Tick pulse — subtle scale bump on each second change.
 *   - Final-3s red flash — CSS keyframe `final-flash` on <= 3s.
 *   - Digit flip on second change via AnimatePresence.
 *   - useOverlaySound("tick-1s") per tick + ("timer-end") at 0.
 */

export const dynamic = "force-dynamic";

type PosKey = "tl" | "tr" | "bl" | "br" | "top" | "bottom";

const POS_STYLES: Record<PosKey, React.CSSProperties> = {
  tl: { top: "60px", left: "60px", bottom: "auto", right: "auto" },
  tr: { top: "60px", right: "60px", bottom: "auto", left: "auto" },
  bl: { bottom: "60px", left: "60px", top: "auto", right: "auto" },
  br: { bottom: "60px", right: "60px", top: "auto", left: "auto" },
  top: {
    top: "60px",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "auto",
    right: "auto",
  },
  bottom: {
    bottom: "60px",
    left: "50%",
    transform: "translateX(-50%)",
    top: "auto",
    right: "auto",
  },
};

const ENTER_BY_POS: Record<PosKey, { x?: number; y?: number }> = {
  tl: { x: -60 },
  tr: { x: 60 },
  bl: { x: -60 },
  br: { x: 60 },
  top: { y: -40 },
  bottom: { y: 40 },
};

function parsePos(raw: string | null): PosKey {
  if (
    raw === "tl" ||
    raw === "tr" ||
    raw === "bl" ||
    raw === "br" ||
    raw === "top" ||
    raw === "bottom"
  ) {
    return raw;
  }
  return "tr";
}

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
  const pos = parsePos(sp?.get("pos") ?? null);
  const clock = useMatchClock(sessionId);

  return (
    <OverlayFrame>
      <AnimatePresence>
        {clock && clock.mode !== "stopped" ? (
          <motion.div
            key="timer-panel"
            initial={{
              opacity: 0,
              x: ENTER_BY_POS[pos].x ?? 0,
              y: ENTER_BY_POS[pos].y ?? 0,
            }}
            animate={{
              opacity: 1,
              x: pos === "top" || pos === "bottom" ? "-50%" : 0,
              y: 0,
            }}
            exit={{
              opacity: 0,
              x: ENTER_BY_POS[pos].x ?? 0,
              y: ENTER_BY_POS[pos].y ?? 0,
            }}
            transition={{ ...ENTER, duration: 0.6 }}
            style={{
              position: "absolute",
              minWidth: "280px",
              padding: "14px 32px 18px",
              background: "var(--panel-strong)",
              border: "2px solid var(--primary)",
              clipPath:
                "polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px)",
              boxShadow:
                "0 0 0 1px rgba(107, 205, 6, 0.3), inset 0 0 30px rgba(107, 205, 6, 0.12), 0 10px 40px rgba(0, 0, 0, 0.6)",
              pointerEvents: "auto",
              textAlign: "center",
              ...POS_STYLES[pos],
            }}
            data-testid="layout-timer"
            data-pos={pos}
          >
            <ClockBody
              displaySeconds={clock.displaySeconds}
              label={clock.label}
              mode={clock.mode}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </OverlayFrame>
  );
}

function ClockBody({
  displaySeconds,
  label,
  mode,
}: {
  displaySeconds: number;
  label: string | null;
  mode: "countdown" | "countup" | "paused" | "stopped";
}) {
  const wholeSeconds = Math.max(0, Math.floor(displaySeconds));
  // Final-3s red flash only applies to countdown mode.
  const finalFlash = mode === "countdown" && wholeSeconds <= 3;
  const expired = mode === "countdown" && wholeSeconds === 0;
  const color = finalFlash ? "var(--secondary)" : "var(--primary)";
  const valueColor = finalFlash ? "var(--secondary)" : "var(--chalk-0)";
  const shadowColor = finalFlash
    ? "rgba(254, 3, 109, 0.7)"
    : "rgba(107, 205, 6, 0.5)";

  // Tick sound on each whole-second change during active countdown/up.
  // timer-end sound when countdown hits zero (whole seconds).
  const isActive = mode === "countdown" || mode === "countup";
  useOverlaySound(
    "tick-1s",
    isActive && !expired ? `tick:${wholeSeconds}` : null,
  );
  useOverlaySound("timer-end", expired ? `end:${Math.floor(Date.now() / 1000)}` : null);

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
          marginBottom: "4px",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 8px ${color}`,
            animation: "timer-dot-pulse 1.4s ease-in-out infinite",
          }}
        />
        <span>{label ?? "Timer"}</span>
      </div>
      <motion.div
        key={`tick-${wholeSeconds}`}
        initial={{ scale: 1 }}
        animate={{ scale: [1.06, 1] }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="tabular"
        style={{
          fontFamily: "AghartiWide, sans-serif",
          fontWeight: 900,
          fontSize: "78px",
          lineHeight: 0.9,
          letterSpacing: "2px",
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
          textShadow: `0 0 24px ${shadowColor}`,
          animation: finalFlash ? "final-flash 0.5s ease-in-out infinite" : "none",
          display: "inline-flex",
          justifyContent: "center",
          alignItems: "baseline",
          minWidth: "1ch",
        }}
        data-testid="timer-value"
      >
        <DigitFlipRow text={formatClock(wholeSeconds)} />
      </motion.div>
      <style>{`
        @keyframes timer-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.6); }
        }
        @keyframes final-flash {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(0.94); opacity: 0.55; }
        }
      `}</style>
    </>
  );
}

/**
 * Digit-level AnimatePresence so only the changing digit flips, not the
 * whole mm:ss number. Keeps the static digits pixel-stable while giving
 * the ticking second a subtle slide.
 */
function DigitFlipRow({ text }: { text: string }) {
  const chars = Array.from(text);
  return (
    <span style={{ display: "inline-flex" }}>
      {chars.map((ch, i) => {
        // Non-numeric separators (":") don't animate.
        if (!/[0-9]/.test(ch)) {
          return (
            <span key={`sep-${i}`} style={{ display: "inline-block" }}>
              {ch}
            </span>
          );
        }
        return (
          <span
            key={`pos-${i}`}
            style={{
              display: "inline-block",
              position: "relative",
              width: "0.62ch",
              overflow: "hidden",
              height: "1em",
              verticalAlign: "baseline",
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={`${i}-${ch}`}
                initial={{ y: "-60%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: "60%", opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  display: "inline-block",
                  width: "100%",
                  textAlign: "center",
                }}
              >
                {ch}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}
