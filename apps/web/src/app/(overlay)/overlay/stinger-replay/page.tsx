"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerReplaySchema } from "@/server/overlays/schemas";
import { useOverlaySound } from "@/lib/overlay-sound";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A — motion port of
 * `KNOWLEDGE/brand-assets/elements/03_stinger_replay.html`.
 *
 * 2-second sequence, preserved keyframes:
 *   - bg-show           (2s linear)   — dark background fade in/out
 *   - tape-fade         (2s linear)   — scanline/tape noise overlay
 *   - rwipe / rwipe-r   (2s cubic-bezier) — skewed pink→green stripes
 *   - content-in        (2s ease-out) — "REPLAY" title slam with bounce
 *   - replay-shake      (0.3s steps(2) × 3) — title judder after slam
 *   - rewind-pulse      (0.4s steps(2) ∞) — strobing ◀◀ rewind marks
 *   - glitch-show       (2s linear) — strobe flicker of scanlines
 *   - flash             (2s linear) — mid-sequence white flash
 *
 * Slam + clip-path reveal driven by framer-motion; strobe/flash/wipes
 * stay as CSS keyframes so the rhythm is bit-for-bit identical to the
 * brand HTML reference.
 */

function Stage({ cycle }: { cycle: number }) {
  useOverlaySound("stinger-replay", cycle);
  return (
    <motion.div
      key={cycle}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <style>{KEYFRAMES_CSS}</style>

      {/* bg-show */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, #050503 0%, #0a0a05 100%)",
          opacity: 0,
          animation: "sr-bg-show 2s linear forwards",
        }}
      />

      {/* tape-noise */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: [
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px)",
            "repeating-linear-gradient(90deg, rgba(254,3,109,0.05) 0px, rgba(254,3,109,0.05) 2px, transparent 2px, transparent 8px)",
          ].join(","),
          opacity: 0,
          animation: "sr-tape-fade 2s linear forwards",
          mixBlendMode: "screen",
        }}
      />

      {/* green wipe stripe (pink→green hue transition via layered wipes) */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          height: "140%",
          width: "40%",
          left: "-40%",
          background:
            "linear-gradient(180deg, rgba(107,205,6,0.8), #6bcd06 50%)",
          boxShadow: "0 0 60px rgba(107,205,6,0.5)",
          transform: "skewX(22deg) translateX(-200%)",
          animation: "sr-rwipe 2s cubic-bezier(0.65,0,0.35,1) 0s forwards",
        }}
      />

      {/* pink wipe stripe */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          height: "140%",
          width: "25%",
          right: "-40%",
          background:
            "linear-gradient(180deg, rgba(254,3,109,0.8), #fe036d 50%)",
          boxShadow: "0 0 60px rgba(254,3,109,0.5)",
          transform: "skewX(22deg) translateX(200%)",
          animation: "sr-rwipe-r 2s cubic-bezier(0.65,0,0.35,1) 0.1s forwards",
        }}
      />

      {/* Content hub — slam enter + clip-path reveal on title */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          zIndex: 5,
        }}
      >
        {/* rewind marks ◀◀◀◀ — infinite strobe pulse */}
        <div
          style={{
            position: "relative",
            display: "flex",
            gap: 12,
            color: "#fe036d",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 6,
            marginBottom: 8,
            animation: "sr-rewind-pulse 0.4s steps(2) infinite",
          }}
        >
          <span>◀◀</span>
          <span>◀◀</span>
        </div>

        {/* REPLAY title: slam (scale bounce + translate) + clip-path reveal */}
        <motion.div
          initial={{
            scale: 0.6,
            opacity: 0,
            clipPath: "inset(0 100% 0 0)",
          }}
          animate={{
            scale: [0.6, 1.08, 1, 1, 0.7],
            opacity: [0, 1, 1, 1, 0],
            clipPath: [
              "inset(0 100% 0 0)",
              "inset(0 0% 0 0)",
              "inset(0 0% 0 0)",
              "inset(0 0% 0 0)",
              "inset(0 0% 0 0)",
            ],
          }}
          transition={{
            duration: 2,
            times: [0, 0.35, 0.5, 0.65, 1],
            ease: [0.22, 1, 0.36, 1],
          }}
          className="font-broadcast-display"
          style={{
            fontSize: 180,
            lineHeight: 0.9,
            color: "#ffffff",
            letterSpacing: "-2px",
            textTransform: "uppercase",
            fontWeight: 900,
            textShadow:
              "0 0 60px rgba(107,205,6,0.6), 4px 4px 0 #fe036d",
            // shake runs 3× after the slam settles
            animation: "sr-replay-shake 0.3s steps(2) 0.4s 3",
          }}
        >
          REPLAY
        </motion.div>

        {/* subtitle */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: [0, 1, 1, 0], y: 0 }}
          transition={{
            duration: 2,
            times: [0, 0.35, 0.75, 1],
            ease: "easeOut",
          }}
          className="font-broadcast-accent"
          style={{
            fontFamily: "Quedora, sans-serif",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 14,
            color: "#6bcd06",
            textTransform: "uppercase",
          }}
        >
          INSTANT · REVIEW
        </motion.div>
      </div>

      {/* glitch-bars strobe (pink→green implied via adjacent wipes) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(0deg, transparent 0, transparent 40px, rgba(254,3,109,0.1) 40px, rgba(254,3,109,0.1) 42px)",
          opacity: 0,
          animation: "sr-glitch-show 2s linear forwards",
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />

      {/* flash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#ffffff",
          opacity: 0,
          animation: "sr-flash 2s linear forwards",
          zIndex: 10,
          pointerEvents: "none",
        }}
      />

    </motion.div>
  );
}

const KEYFRAMES_CSS = `
@keyframes sr-bg-show {
  0%   { opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes sr-tape-fade {
  0%   { opacity: 0; }
  15%  { opacity: 0.6; }
  85%  { opacity: 0.6; }
  100% { opacity: 0; }
}
@keyframes sr-rwipe {
  0%   { transform: skewX(22deg) translateX(-200%); }
  45%  { transform: skewX(22deg) translateX(0%); }
  55%  { transform: skewX(22deg) translateX(0%); }
  100% { transform: skewX(22deg) translateX(400%); }
}
@keyframes sr-rwipe-r {
  0%   { transform: skewX(22deg) translateX(200%); }
  45%  { transform: skewX(22deg) translateX(0%); }
  55%  { transform: skewX(22deg) translateX(0%); }
  100% { transform: skewX(22deg) translateX(-400%); }
}
@keyframes sr-replay-shake {
  0%   { filter: hue-rotate(0deg); }
  50%  { filter: hue-rotate(-40deg); }
  100% { filter: hue-rotate(0deg); }
}
@keyframes sr-rewind-pulse {
  0%, 50%   { opacity: 0.3; }
  51%, 100% { opacity: 1; }
}
@keyframes sr-glitch-show {
  0%, 30%, 42%, 54%, 100% { opacity: 0; }
  34%, 38%, 46%, 50%      { opacity: 1; }
}
@keyframes sr-flash {
  0%, 40% { opacity: 0; }
  46%     { opacity: 0.55; }
  50%     { opacity: 0; }
}
`;

export default function StingerReplayPage() {
  return (
    <PreviewStub
      templateKey="stinger_replay"
      schema={stingerReplaySchema}
      position="fullscreen"
      render={(_p, { cycle }) => <Stage cycle={cycle} />}
    />
  );
}
