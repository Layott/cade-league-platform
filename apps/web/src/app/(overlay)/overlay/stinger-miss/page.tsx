"use client";

/**
 * Plan 16 amended — Miss Stinger (2s, full-screen).
 *
 * Motion ported from `KNOWLEDGE/brand-assets/elements/04b_stinger_miss.html`.
 * Key choreography (preserved verbatim timings / easings):
 *   - `bg-show` 2s linear — dark base fade.
 *   - `glow-breathe` 2s ease-out — pink radial bloom (pulses once).
 *   - `mwipe` + `mwipe-r` 2s cubic-bezier(0.65, 0, 0.35, 1) — pink stripe
 *     left→right, green stripe right→left (delayed 0.12s), cross in
 *     centre then whip out opposite sides.
 *   - `hub-in` 2s ease-out — centre content zooms in + settles.
 *   - `strike-in` 2s ease-out (0.35s delay) — pink strike-through across
 *     the "MISS" text.
 *   - `ml-left` / `ml-right` 2s ease-out (0.2s delay) — accent lines
 *     sweep in from outside.
 *   - `reticle-in` 2s ease-out (0.4s delay) — dashed reticle crosshair.
 *
 * CSS keyframes retained for the inline ambient loops (glow + wipe);
 * framer-motion drives the enter + exit at the outer component level so
 * the shared STINGER_IN / STINGER_OUT tokens still gate session play.
 */

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerMissSchema } from "@/server/overlays/schemas";
import { STINGER_IN, STINGER_OUT } from "@/lib/motion";
import { useOverlaySound } from "@/lib/overlay-sound";

export const dynamic = "force-dynamic";

// Palette locked by CLAUDE.md — primary green / secondary pink.
const PINK = "#fe036d";
const PINK_BRIGHT = "#ff5a9e";
const GREEN = "#6bcd06";
const GREEN_BRIGHT = "#9fff2a";

export default function StingerMissPage() {
  return (
    <PreviewStub
      templateKey="stinger_miss"
      schema={stingerMissSchema}
      position="fullscreen"
      render={(p, { cycle }) => (
        <StingerMissStage cycle={cycle} payload={p} />
      )}
    />
  );
}

function StingerMissStage({
  cycle,
  payload,
}: {
  cycle: number;
  payload: { scorerDisplayName?: string; scorerPhotoUrl?: string };
}) {
  // Fire the slot resolver on every cycle — muted until an mp3 drops.
  useOverlaySound("stinger-miss", cycle);

  return (
    <motion.div
      key={cycle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ...STINGER_IN }}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "transparent",
        color: "#fff",
        fontFamily: "Quedora, sans-serif",
      }}
    >
      {/* Inline keyframes — ported verbatim from 04b_stinger_miss.html. */}
      <style>{KEYFRAMES}</style>

      {/* Layer 1 — dark base fade. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, #050303 0%, #0a0505 100%)",
          animation: "bg-show 2s linear forwards",
          opacity: 0,
        }}
      />

      {/* Layer 2 — subtle pink radial bloom (breathes once). */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 900,
          height: 900,
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle, ${hexA(PINK, 0.22)} 0%, transparent 55%)`,
          filter: "blur(30px)",
          animation: "glow-breathe 2s ease-out forwards",
          opacity: 0,
        }}
      />

      {/* Layer 3 — pink left-to-right diagonal wipe. */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          bottom: "-10%",
          left: 0,
          width: "60%",
          background: `linear-gradient(180deg, ${hexA(PINK, 0.85)}, ${PINK} 50%)`,
          transform: "skewX(-22deg) translateX(-200%)",
          boxShadow: `0 0 60px ${hexA(PINK, 0.5)}`,
          animation: "mwipe 2s cubic-bezier(0.65, 0, 0.35, 1) 0s forwards",
          willChange: "transform",
        }}
      />

      {/* Layer 4 — green right-to-left diagonal wipe (delayed). */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          bottom: "-10%",
          right: 0,
          width: "60%",
          background: `linear-gradient(180deg, ${hexA(GREEN, 0.75)}, ${GREEN} 50%)`,
          transform: "skewX(-22deg) translateX(200%)",
          boxShadow: `0 0 60px ${hexA(GREEN, 0.4)}`,
          animation: "mwipe-r 2s cubic-bezier(0.65, 0, 0.35, 1) 0.12s forwards",
          willChange: "transform",
        }}
      />

      {/* Layer 5 — central content hub (scorer + MISS title). */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          zIndex: 5,
          animation: "hub-in 2s ease-out forwards",
          opacity: 0,
        }}
      >
        {payload.scorerPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={payload.scorerPhotoUrl}
            alt={payload.scorerDisplayName ?? "Scorer"}
            style={{
              width: 160,
              height: 160,
              borderRadius: "50%",
              objectFit: "cover",
              objectPosition: "center top",
              marginBottom: 16,
              filter: `drop-shadow(0 0 30px ${hexA(PINK, 0.55)}) grayscale(0.15)`,
              border: `3px solid ${PINK}`,
            }}
          />
        ) : null}

        <div
          style={{
            position: "relative",
            fontFamily: "AghartiWide, Agharti, 'Inter Tight', sans-serif",
            fontWeight: 900,
            fontSize: 220,
            lineHeight: 0.88,
            letterSpacing: "-2px",
            textTransform: "uppercase",
            color: "#fff",
            display: "inline-block",
          }}
        >
          <span style={{ display: "inline-block" }}>MISS</span>
          {/* Strike-through bar — rotates in, holds, fades out. */}
          <div
            style={{
              position: "absolute",
              left: -10,
              right: -10,
              top: "50%",
              height: 12,
              background: PINK_BRIGHT,
              boxShadow: `0 0 14px ${PINK}, 0 0 28px ${hexA(PINK, 0.6)}`,
              transform: "rotate(-4deg) scaleX(0)",
              transformOrigin: "left center",
              animation: "strike-in 2s ease-out 0.35s forwards",
            }}
          />
        </div>

        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: 14,
            color: PINK,
            textTransform: "uppercase",
            marginTop: 8,
          }}
        >
          {payload.scorerDisplayName
            ? `— ${payload.scorerDisplayName} OFF TARGET —`
            : "— OFF TARGET —"}
        </div>
      </div>

      {/* Layer 6 — accent side lines (::before left / ::after right). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 860,
          height: 2,
          transform: "translate(-50%, -50%)",
          zIndex: 4,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "42%",
            height: 2,
            background: `linear-gradient(90deg, transparent, ${PINK_BRIGHT}, transparent)`,
            boxShadow: `0 0 12px ${PINK_BRIGHT}`,
            opacity: 0,
            transform: "translateX(50%) scaleX(0)",
            animation: "ml-left 2s ease-out 0.2s forwards",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "42%",
            height: 2,
            background: `linear-gradient(90deg, transparent, ${GREEN_BRIGHT}, transparent)`,
            boxShadow: `0 0 12px ${GREEN_BRIGHT}`,
            opacity: 0,
            transform: "translateX(-50%) scaleX(0)",
            animation: "ml-right 2s ease-out 0.2s forwards",
          }}
        />
      </div>

      {/* Layer 7 — reticle crosshair. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 520,
          height: 520,
          transform: "translate(-50%, calc(-50% - 40px)) scale(1.3)",
          zIndex: 3,
          opacity: 0,
          animation: "reticle-in 2s ease-out 0.4s forwards",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: `1px dashed ${hexA(PINK, 0.4)}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            transform: "translateX(-50%)",
            background: hexA(PINK, 0.4),
            boxShadow: `0 0 6px ${hexA(PINK, 0.4)}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: 1,
            transform: "translateY(-50%)",
            background: hexA(PINK, 0.4),
            boxShadow: `0 0 6px ${hexA(PINK, 0.4)}`,
          }}
        />
      </div>

      {/* Exit fade — framer-motion handles via outer <motion.div>. */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 1 }}
        transition={{ ...STINGER_OUT }}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "#000",
        }}
      />
    </motion.div>
  );
}

/**
 * CSS keyframes ported verbatim from `04b_stinger_miss.html`. Kept
 * inline so the component is self-contained; `AnimatePresence` restages
 * them on every new `cycle` via the parent `key` (the node unmounts +
 * remounts, so animations replay).
 */
const KEYFRAMES = `
@keyframes bg-show {
  0%   { opacity: 0; }
  30%  { opacity: 1; }
  100% { opacity: 1; }
}
@keyframes glow-breathe {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
  35%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  65%  { opacity: 0.8; transform: translate(-50%, -50%) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.15); }
}
@keyframes mwipe {
  0%   { transform: skewX(-22deg) translateX(-200%); }
  45%  { transform: skewX(-22deg) translateX(0%); }
  55%  { transform: skewX(-22deg) translateX(0%); }
  100% { transform: skewX(-22deg) translateX(400%); }
}
@keyframes mwipe-r {
  0%   { transform: skewX(-22deg) translateX(200%); }
  45%  { transform: skewX(-22deg) translateX(0%); }
  55%  { transform: skewX(-22deg) translateX(0%); }
  100% { transform: skewX(-22deg) translateX(-400%); }
}
@keyframes hub-in {
  0%   { opacity: 0; transform: translate(-50%, calc(-50% + 20px)) scale(0.7); }
  30%  { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
  45%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  65%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, calc(-50% - 10px)) scale(0.85); }
}
@keyframes strike-in {
  0%   { transform: rotate(-4deg) scaleX(0); opacity: 0; }
  15%  { transform: rotate(-4deg) scaleX(1); opacity: 1; }
  65%  { transform: rotate(-4deg) scaleX(1); opacity: 1; }
  100% { transform: rotate(-4deg) scaleX(1); opacity: 0; }
}
@keyframes ml-left {
  0%   { opacity: 0; transform: translateX(50%) scaleX(0); }
  30%  { opacity: 1; transform: translateX(0) scaleX(1); }
  70%  { opacity: 1; transform: translateX(0) scaleX(1); }
  100% { opacity: 0; transform: translateX(0) scaleX(1); }
}
@keyframes ml-right {
  0%   { opacity: 0; transform: translateX(-50%) scaleX(0); }
  30%  { opacity: 1; transform: translateX(0) scaleX(1); }
  70%  { opacity: 1; transform: translateX(0) scaleX(1); }
  100% { opacity: 0; transform: translateX(0) scaleX(1); }
}
@keyframes reticle-in {
  0%   { opacity: 0; transform: translate(-50%, calc(-50% - 40px)) scale(1.3); }
  25%  { opacity: 0.6; transform: translate(-50%, calc(-50% - 40px)) scale(1); }
  75%  { opacity: 0.6; transform: translate(-50%, calc(-50% - 40px)) scale(1); }
  100% { opacity: 0; transform: translate(-50%, calc(-50% - 40px)) scale(1); }
}
`;

/** Hex → rgba(). Only accepts `#RRGGBB`. */
function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
