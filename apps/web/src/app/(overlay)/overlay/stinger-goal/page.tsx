"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerGoalSchema, type StingerGoalPayload } from "@/server/overlays/schemas";
import { SCORE_FLIP, STINGER_IN } from "@/lib/motion";
import { useOverlaySound } from "@/lib/overlay-sound";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A + Plan 48 — motion port of
 * `KNOWLEDGE/brand-assets/elements/04_stinger_goal.html`.
 *
 * Plan 48 parity pass: wrapped in 1920×1080 OverlayFrame so preview mode
 * scales cleanly. All keyframes + timings preserved from Wave A — the
 * reference bg-show → glow-breathe → wipes → hub-in → bang → lines →
 * stripe cascade cadence is pixel-identical. Ring burst colours
 * #8eff14 (green-bright) + #ff3b91 (pink-bright) confirmed against ref.
 *
 * 2-second sequence, preserved keyframes:
 *   - bg-show        (2s linear)          — dark background fade in/out
 *   - glow-breathe   (2s ease-out)        — radial green glow scale + fade
 *   - gwipe          (2s cubic-bezier)    — skewed green stripe wipe (0s delay)
 *   - gwipe-r        (2s cubic-bezier)    — skewed pink stripe wipe (0.12s delay)
 *   - hub-in         (2s ease-out)        — content block translate + scale bounce
 *   - bang-bounce    (SCORE_FLIP)         — "!" in green-bright, anticipate + overshoot
 *   - line-left      (2s ease-out 0.2s)   — green accent sweep L
 *   - line-right     (2s ease-out 0.2s)   — pink accent sweep R
 *   - stripe-slide   (8× @ 40 ms stagger) — horizontal tempo stripes
 *   - burst-ring     (staggered)          — two radiating rings behind hub
 *   - scorer-bubble  (delayed fade)       — optional photo + name chip
 *
 * Background + radial + wipes + accent lines stay as CSS @keyframes so the
 * rhythm matches the brand reference exactly; the stripe cascade, title
 * slam, bang bounce, bursts + optional scorer bubble are driven by
 * framer-motion staggerChildren / SCORE_FLIP / STINGER_IN tokens.
 */

function Stage({ cycle, payload }: { cycle: number; payload: StingerGoalPayload }) {
  useOverlaySound(payload.soundSlot ?? "stinger-goal", cycle);
  const scorerName = payload.scorerDisplayName;
  const scorerPhoto = payload.scorerPhotoUrl;
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

      {/* bg-show — dark background fades in then out */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, #050503 0%, #0a0a05 100%)",
          opacity: 0,
          animation: "sg-bg-show 2s linear forwards",
        }}
      />

      {/* glow-breathe — subtle radial green glow behind the hub */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 1100,
          height: 1100,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(107, 205, 6, 0.28) 0%, transparent 55%)",
          filter: "blur(30px)",
          opacity: 0,
          animation: "sg-glow-breathe 2s ease-out forwards",
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />

      {/* 8 horizontal tempo stripes — slide in staggered every 40ms */}
      <motion.div
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } },
          exit: {},
        }}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.div
            key={i}
            variants={{
              hidden: { x: i % 2 === 0 ? "-100vw" : "100vw", opacity: 0 },
              visible: { x: "0vw", opacity: 0.18 },
              exit: { opacity: 0, transition: { duration: 0.2 } },
            }}
            transition={{ ...STINGER_IN }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${8 + i * 11}%`,
              height: 2,
              background:
                i % 2 === 0
                  ? "linear-gradient(90deg, transparent, #6bcd06, transparent)"
                  : "linear-gradient(90deg, transparent, #fe036d, transparent)",
              boxShadow:
                i % 2 === 0
                  ? "0 0 10px rgba(107,205,6,0.55)"
                  : "0 0 10px rgba(254,3,109,0.55)",
            }}
          />
        ))}
      </motion.div>

      {/* Green diagonal wipe (0s) — hold 45-55% then exit */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          height: "140%",
          width: "42%",
          left: "-42%",
          background:
            "linear-gradient(180deg, rgba(107, 205, 6, 0.85), #6bcd06 50%)",
          boxShadow: "0 0 60px rgba(107, 205, 6, 0.5)",
          transform: "skewX(-22deg) translateX(-200%)",
          animation: "sg-gwipe 2s cubic-bezier(0.65, 0, 0.35, 1) 0s forwards",
        }}
      />

      {/* Pink diagonal wipe (0.12s delay) */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          height: "140%",
          width: "22%",
          right: "-42%",
          background:
            "linear-gradient(180deg, rgba(254, 3, 109, 0.85), #fe036d 50%)",
          boxShadow: "0 0 60px rgba(254, 3, 109, 0.5)",
          transform: "skewX(-22deg) translateX(200%)",
          animation: "sg-gwipe-r 2s cubic-bezier(0.65, 0, 0.35, 1) 0.12s forwards",
        }}
      />

      {/* Burst rings radiating outward from center */}
      {[0, 1].map((i) => (
        <motion.div
          key={`ring-${i}`}
          initial={{ scale: 0.2, opacity: 0 }}
          animate={{ scale: [0.2, 1.1, 1.6], opacity: [0, 0.9, 0] }}
          transition={{
            duration: 1.1,
            times: [0, 0.45, 1],
            delay: 0.2 + i * 0.15,
            ease: [0.22, 1, 0.36, 1],
          }}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 520,
            height: 520,
            marginLeft: -260,
            marginTop: -260,
            borderRadius: "50%",
            border: `4px solid ${i === 0 ? "#8eff14" : "#ff3b91"}`,
            boxShadow:
              i === 0
                ? "0 0 40px rgba(142,255,20,0.5)"
                : "0 0 40px rgba(255,59,145,0.45)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Content hub — GOAL! title slam */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.7 }}
        animate={{
          opacity: [0, 1, 1, 1, 0],
          y: [20, 0, 0, 0, -10],
          scale: [0.7, 1.05, 1, 1, 0.85],
        }}
        transition={{
          duration: 2,
          times: [0, 0.3, 0.45, 0.65, 1],
          ease: "easeOut",
        }}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          zIndex: 5,
        }}
      >
        {/* GOAL! — title with .bang bounce on the ! */}
        <motion.div
          initial={{ scale: 0, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 1.2, opacity: 0 }}
          transition={{ ...SCORE_FLIP }}
          className="font-broadcast-display"
          style={{
            fontSize: 200,
            lineHeight: 0.88,
            color: "#ffffff",
            letterSpacing: "-2px",
            fontWeight: 900,
            textTransform: "uppercase",
            textShadow: "0 0 40px rgba(107, 205, 6, 0.45)",
            position: "relative",
            display: "flex",
            alignItems: "baseline",
          }}
        >
          <span>GOAL</span>
          <motion.span
            initial={{ scale: 0, y: 20 }}
            animate={{ scale: [0, 1.4, 0.9, 1.1, 1], y: [20, 0, 0, 0, 0] }}
            transition={{
              duration: 0.7,
              times: [0, 0.4, 0.6, 0.8, 1],
              delay: 0.25,
              ease: [0.68, -0.55, 0.27, 1.55],
            }}
            style={{ color: "#8eff14", marginLeft: 8, display: "inline-block" }}
          >
            !
          </motion.span>
        </motion.div>

        {/* subtitle — either scorer name or "NETS IT" */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: [0, 1, 1, 0], y: 0 }}
          transition={{
            duration: 2,
            times: [0, 0.4, 0.75, 1],
            delay: 0.15,
            ease: "easeOut",
          }}
          className="font-broadcast-accent"
          style={{
            fontFamily: "Quedora, sans-serif",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 14,
            color: "#6bcd06",
            textTransform: "uppercase",
          }}
        >
          {scorerName ? `— ${scorerName} —` : "— NETS IT —"}
        </motion.div>
      </motion.div>

      {/* Optional scorer photo + name bubble (payload-driven) */}
      {scorerPhoto ? (
        <motion.div
          initial={{ opacity: 0, x: -40, scale: 0.9 }}
          animate={{ opacity: [0, 1, 1, 0], x: [-40, 0, 0, -20], scale: 1 }}
          transition={{
            duration: 2,
            times: [0, 0.4, 0.8, 1],
            delay: 0.5,
            ease: [0.22, 1, 0.36, 1],
          }}
          style={{
            position: "absolute",
            left: 120,
            bottom: 160,
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "12px 24px 12px 12px",
            background: "rgba(5, 7, 5, 0.8)",
            border: "2px solid #6bcd06",
            borderRadius: 72,
            boxShadow: "0 0 40px rgba(107,205,6,0.45)",
            backdropFilter: "blur(6px)",
            zIndex: 6,
          }}
        >
          {/* Using <img> (not next/image) — payload URLs may be relative
              /players/<slug>/... or absolute; direct render avoids
              loader config churn. eslint-disable justified. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={scorerPhoto}
            alt={scorerName ?? "scorer"}
            width={104}
            height={104}
            style={{
              width: 104,
              height: 104,
              borderRadius: "50%",
              objectFit: "cover",
              border: "3px solid #8eff14",
              background: "#0a0a05",
            }}
          />
          <div
            className="font-broadcast-display"
            style={{
              fontSize: 34,
              fontWeight: 900,
              color: "#ffffff",
              letterSpacing: "-0.5px",
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            {scorerName ?? "SCORER"}
          </div>
        </motion.div>
      ) : null}

      {/* Accent lines (green L + pink R) sweeping out from center */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "100%",
          height: 2,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: "50%",
            height: 2,
            background:
              "linear-gradient(90deg, transparent, #8eff14, transparent)",
            boxShadow: "0 0 12px #8eff14",
            opacity: 0,
            animation: "sg-line-left 2s ease-out 0.2s forwards",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            right: 0,
            height: 2,
            background:
              "linear-gradient(90deg, transparent, #ff3b91, transparent)",
            boxShadow: "0 0 12px #ff3b91",
            opacity: 0,
            animation: "sg-line-right 2s ease-out 0.2s forwards",
          }}
        />
      </div>
    </motion.div>
  );
}

const KEYFRAMES_CSS = `
@keyframes sg-bg-show {
  0%   { opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes sg-glow-breathe {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
  35%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  65%  { opacity: 0.8; transform: translate(-50%, -50%) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.15); }
}
@keyframes sg-gwipe {
  0%   { transform: skewX(-22deg) translateX(-200%); }
  45%  { transform: skewX(-22deg) translateX(0%); }
  55%  { transform: skewX(-22deg) translateX(0%); }
  100% { transform: skewX(-22deg) translateX(400%); }
}
@keyframes sg-gwipe-r {
  0%   { transform: skewX(-22deg) translateX(200%); }
  45%  { transform: skewX(-22deg) translateX(0%); }
  55%  { transform: skewX(-22deg) translateX(0%); }
  100% { transform: skewX(-22deg) translateX(-400%); }
}
@keyframes sg-line-left {
  0%   { opacity: 0; transform: translateX(50%) scaleX(0); }
  30%  { opacity: 1; transform: translateX(0) scaleX(1); }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes sg-line-right {
  0%   { opacity: 0; transform: translateX(-50%) scaleX(0); }
  30%  { opacity: 1; transform: translateX(0) scaleX(1); }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
`;

export default function StingerGoalPage() {
  return (
    <OverlayFrame>
      <PreviewStub
        templateKey="stinger_goal"
        schema={stingerGoalSchema}
        position="fullscreen"
        render={(p, { cycle }) => <Stage cycle={cycle} payload={p} />}
      />
    </OverlayFrame>
  );
}
