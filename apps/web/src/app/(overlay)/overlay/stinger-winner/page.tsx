"use client";

// TODO Plan 48 phase 2 — design parity
import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import {
  stingerWinnerSchema,
  type StingerWinnerPayload,
} from "@/server/overlays/schemas";
import { SCORE_FLIP, STINGER_IN } from "@/lib/motion";
import { useOverlaySound } from "@/lib/overlay-sound";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A — motion port of
 * `KNOWLEDGE/brand-assets/elements/05_stinger_winner.html`.
 *
 * 2-second sequence (preserves all HTML keyframes):
 *   1. Champion photo iris-in         (frame-in: clip-path + slide + scale)
 *   2. "WINNER" title slam            (info-in + SCORE_FLIP on the name)
 *   3. Confetti sweep                 (green + pink diagonal wipes =
 *                                      wwipe / wwipe-r, plus particle loop)
 *   4. Final-score flip               (SCORE_FLIP digit block)
 *
 * Glow halo + horizontal accent hairlines (wl-left / wl-right) + background
 * show (bg-show / glow-fade) all re-rendered as CSS @keyframes so the
 * browser GPU drives the background noise — framer-motion only narrates
 * the 4 storytelling steps above.
 */
export default function StingerWinnerPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="stinger_winner"
        schema={stingerWinnerSchema}
        position="fullscreen"
        render={(p, { cycle }) => <WinnerStage payload={p} cycle={cycle} />}
      />
    </OverlayFrame>
  );
}

function WinnerStage({
  payload,
  cycle,
}: {
  payload: StingerWinnerPayload;
  cycle: number;
}) {
  // Default to stinger-winner if caller omitted the slot — this template
  // is a celebratory stinger and should always punch with sound.
  useOverlaySound(payload.soundSlot ?? "stinger-winner", cycle);

  const name = (payload.winnerDisplayName || "CHAMPION").toUpperCase();
  const photo = payload.winnerPhotoUrl;
  const score = payload.finalScore;

  return (
    <motion.div
      key={cycle}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        fontFamily: "var(--font-broadcast-accent)",
        color: "#fff",
      }}
    >
      {/* Background gradient fade (bg-show) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, #040603 0%, #080a05 60%, #030502 100%)",
          animation: "sw-bg-show 2s linear forwards",
        }}
      />

      {/* Centre-left green halo (glow-fade) */}
      <div
        style={{
          position: "absolute",
          left: "40%",
          top: "50%",
          width: 900,
          height: 900,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(107, 205, 6, 0.22) 0%, transparent 55%)",
          filter: "blur(30px)",
          mixBlendMode: "screen",
          animation: "sw-glow-fade 2s ease-out forwards",
        }}
      />

      {/* Diagonal confetti-sweep wipes (wwipe + wwipe-r, HTML keyframes) */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          left: "-38%",
          width: "38%",
          height: "140%",
          background:
            "linear-gradient(180deg, rgba(107,205,6,0.85), #6bcd06 50%)",
          boxShadow: "0 0 60px rgba(107, 205, 6, 0.5)",
          animation:
            "sw-wwipe 2s cubic-bezier(0.65, 0, 0.35, 1) 0s forwards",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "-20%",
          right: "-38%",
          width: "18%",
          height: "140%",
          background:
            "linear-gradient(180deg, rgba(254,3,109,0.7), #fe036d 50%)",
          boxShadow: "0 0 60px rgba(254, 3, 109, 0.5)",
          animation:
            "sw-wwipe-r 2s cubic-bezier(0.65, 0, 0.35, 1) 0.12s forwards",
        }}
      />

      {/* Confetti particle sweep — 24 specks flung across the frame on loop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 3,
        }}
      >
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${c.x}%`,
              top: "-8%",
              width: c.w,
              height: c.h,
              background: c.color,
              opacity: 0,
              transform: `rotate(${c.r}deg)`,
              animation: `sw-confetti ${c.dur}s cubic-bezier(0.4, 0, 0.2, 1) ${c.delay}s forwards`,
              boxShadow: `0 0 8px ${c.color}`,
            }}
          />
        ))}
      </div>

      {/* Champion photo frame — iris-in via frame-in keyframes */}
      <motion.div
        initial={{ opacity: 0, x: -60, scale: 0.92 }}
        animate={{
          opacity: [0, 1, 1, 0],
          x: [-60, 0, 0, -30],
          scale: [0.92, 1, 1, 0.95],
        }}
        transition={{
          ease: STINGER_IN.ease,
          duration: 2,
          times: [0, 0.3, 0.75, 1],
        }}
        style={{
          position: "absolute",
          left: "12%",
          top: "50%",
          transform: "translateY(-50%)",
          width: 420,
          height: 560,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(107, 205, 6, 0.15) 0%, rgba(5, 8, 5, 0.95) 100%)",
          clipPath:
            "polygon(22px 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%, 0 22px)",
          zIndex: 5,
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={name}
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              height: "110%",
              objectFit: "cover",
              objectPosition: "center 0%",
              WebkitMaskImage:
                "linear-gradient(180deg, black 85%, transparent 100%)",
              maskImage:
                "linear-gradient(180deg, black 85%, transparent 100%)",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-broadcast-display)",
              fontWeight: 900,
              fontSize: 160,
              color: "rgba(107, 205, 6, 0.5)",
              letterSpacing: "-0.05em",
            }}
          >
            {name.slice(0, 1)}
          </div>
        )}
        {/* Photo frame border */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "3px solid #6bcd06",
            clipPath:
              "polygon(22px 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%, 0 22px)",
            boxShadow:
              "0 0 30px rgba(107, 205, 6, 0.35), inset 0 0 40px rgba(107, 205, 6, 0.08)",
            pointerEvents: "none",
          }}
        />
      </motion.div>

      {/* Info block — kicker + WINNER name + stats */}
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: [0, 1, 1, 0], x: [40, 0, 0, 30] }}
        transition={{
          duration: 2,
          times: [0, 0.3, 0.75, 1],
          ease: "easeOut",
          delay: 0.3,
        }}
        style={{
          position: "absolute",
          left: "calc(12% + 470px)",
          top: "50%",
          transform: "translateY(-50%)",
          maxWidth: 720,
          zIndex: 6,
        }}
      >
        {/* Kicker line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: "var(--font-broadcast-accent)",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "12px",
            color: "#6bcd06",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          <span
            style={{
              width: 40,
              height: 2,
              background:
                "linear-gradient(90deg, transparent, #6bcd06)",
            }}
          />
          <span>MATCH WINNER</span>
        </div>

        {/* WINNER title slam */}
        <motion.div
          initial={{ scale: 0.6, opacity: 0, y: -10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ ...SCORE_FLIP, delay: 0.35 }}
          className="font-broadcast-display"
          style={{
            fontFamily: "var(--font-broadcast-display)",
            fontWeight: 900,
            fontSize: 130,
            lineHeight: 0.9,
            color: "#fff",
            letterSpacing: "-1px",
            textTransform: "uppercase",
            textShadow: "0 0 40px rgba(107, 205, 6, 0.4)",
            marginBottom: 28,
          }}
        >
          {name}
        </motion.div>

        {/* Final-score flip row — or generic GOALS stat when score absent */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 30,
            paddingTop: 20,
            borderTop: "1px solid rgba(107, 205, 6, 0.35)",
          }}
        >
          {score ? (
            <>
              <ScoreDigit value={score.home} delay={0.7} label="HOME" />
              <span
                style={{
                  width: 1,
                  height: 96,
                  background:
                    "linear-gradient(180deg, transparent, rgba(107, 205, 6, 0.4), transparent)",
                }}
              />
              <ScoreDigit value={score.away} delay={0.85} label="AWAY" />
            </>
          ) : (
            <ScoreDigit value={"★"} delay={0.7} label="CHAMPION" />
          )}
        </div>
      </motion.div>

      {/* Horizontal accent hairlines (wl-left / wl-right) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          width: "50%",
          height: 2,
          background:
            "linear-gradient(90deg, transparent, #8eff14, transparent)",
          boxShadow: "0 0 10px #8eff14",
          opacity: 0,
          transformOrigin: "right center",
          animation: "sw-wl-left 2s ease-out 0.2s forwards",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "50%",
          height: 2,
          background:
            "linear-gradient(90deg, transparent, #ff3b91, transparent)",
          boxShadow: "0 0 10px #ff3b91",
          opacity: 0,
          transformOrigin: "left center",
          animation: "sw-wl-right 2s ease-out 0.2s forwards",
          pointerEvents: "none",
        }}
      />

      {/* CSS keyframes ported 1:1 from 05_stinger_winner.html */}
      <style>{KEYFRAMES_CSS}</style>
    </motion.div>
  );
}

const KEYFRAMES_CSS = `
@keyframes sw-bg-show {
  0%   { opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes sw-glow-fade {
  0%   { opacity: 0; }
  30%  { opacity: 1; }
  75%  { opacity: 0.9; }
  100% { opacity: 0; }
}
@keyframes sw-wwipe {
  0%   { transform: skewX(-22deg) translateX(-200%); }
  45%  { transform: skewX(-22deg) translateX(0%); }
  55%  { transform: skewX(-22deg) translateX(0%); }
  100% { transform: skewX(-22deg) translateX(400%); }
}
@keyframes sw-wwipe-r {
  0%   { transform: skewX(-22deg) translateX(200%); }
  45%  { transform: skewX(-22deg) translateX(0%); }
  55%  { transform: skewX(-22deg) translateX(0%); }
  100% { transform: skewX(-22deg) translateX(-400%); }
}
@keyframes sw-wl-left {
  0%   { opacity: 0; transform: translateX(50%) scaleX(0); }
  30%  { opacity: 1; transform: translateX(0) scaleX(1); }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes sw-wl-right {
  0%   { opacity: 0; transform: translateX(-50%) scaleX(0); }
  30%  { opacity: 1; transform: translateX(0) scaleX(1); }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes sw-confetti {
  0%   { opacity: 0; transform: translate3d(0, 0, 0) rotate(0deg); }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { opacity: 0; transform: translate3d(120px, 110vh, 0) rotate(720deg); }
}
`;

/**
 * One digit / label in the final-score row. Flips in with the shared
 * SCORE_FLIP spring so the home + away numbers ding like the score bug.
 */
function ScoreDigit({
  value,
  delay,
  label,
}: {
  value: number | string;
  delay: number;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: -30, rotateX: -90 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ ...SCORE_FLIP, delay }}
        className="font-broadcast-display tabular"
        style={{
          fontFamily: "var(--font-broadcast-display)",
          fontWeight: 900,
          fontSize: 96,
          lineHeight: 0.9,
          color: "#8eff14",
          letterSpacing: 1,
          textShadow: "0 0 24px rgba(107, 205, 6, 0.45)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </motion.div>
      <div
        style={{
          fontFamily: "var(--font-broadcast-accent)",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "8px",
          color: "#6bcd06",
          textTransform: "uppercase",
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Deterministic confetti speck definitions — seeded so SSR markup matches
 * client hydration (no `Math.random` at render time).
 */
const CONFETTI_COLORS = [
  "#6bcd06",
  "#8eff14",
  "#fe036d",
  "#ff3b91",
  "#f5c518",
  "#ffffff",
];
const CONFETTI = Array.from({ length: 28 }, (_, i) => {
  // Cheap hash — keeps positions stable between renders.
  const s = Math.sin(i * 12.9898) * 43758.5453;
  const r1 = s - Math.floor(s);
  const s2 = Math.sin(i * 78.233) * 43758.5453;
  const r2 = s2 - Math.floor(s2);
  const s3 = Math.sin(i * 39.425) * 43758.5453;
  const r3 = s3 - Math.floor(s3);
  return {
    x: Math.round(r1 * 100),
    w: 6 + Math.round(r2 * 8),
    h: 12 + Math.round(r3 * 10),
    r: Math.round(r1 * 360),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: +(0.15 + r2 * 0.6).toFixed(2),
    dur: +(1.4 + r3 * 0.6).toFixed(2),
  };
});
