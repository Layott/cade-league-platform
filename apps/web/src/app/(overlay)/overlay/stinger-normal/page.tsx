"use client";

import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { stingerNormalSchema } from "@/server/overlays/schemas";
import { useOverlaySound } from "@/lib/overlay-sound";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A — motion port of
 * `KNOWLEDGE/brand-assets/elements/02_stinger_normal.html`.
 *
 * 2-second tempo, 5 preserved keyframes:
 *   1. `bg-dark` — black frame fades in (0→15%) then out (85→100%)
 *   2. `wipe-across` — three skew(-22deg) stripes (green/pink/green)
 *      staggered 0.0s / 0.1s / 0.2s, enter from left, hold center, exit right
 *   3. `st-n-burst` — shield/logo thump: scale 0 → 1.2 overshoot → 1 settle → 0.3 exit
 *   4. `burst-expand` — two border rings expand outward at t≈0.7s and t≈0.85s
 *   5. `flash` — white flash at t≈0.94s to punch the impact frame
 *
 * Sound slot `stinger-normal` fires on mount / on each cycle change.
 */
export default function StingerNormalPage() {
  return (
    <PreviewStub
      templateKey="stinger_normal"
      schema={stingerNormalSchema}
      position="fullscreen"
      render={(_p, { cycle }) => <StingerNormalScene cycle={cycle} />}
    />
  );
}

function StingerNormalScene({ cycle }: { cycle: number | string }) {
  useOverlaySound("stinger-normal", cycle);

  return (
    <motion.div
      key={cycle}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Quedora, sans-serif",
      }}
    >
      {/* 1. bg-dark: black underlay fades in/out over 2s */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 2, times: [0, 0.15, 0.85, 1], ease: "linear" }}
        style={{
          position: "absolute",
          inset: 0,
          background: "#000",
        }}
      />

      {/* 2. wipe-across stripes — 3 skewed bars sweep across, staggered */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {[
          {
            key: "s1",
            delay: 0,
            widthPct: 60,
            gradient:
              "linear-gradient(180deg, rgba(107, 205, 6, 0.9), #6bcd06 50%, rgba(107, 205, 6, 0.7))",
          },
          {
            key: "s2",
            delay: 0.1,
            widthPct: 25,
            gradient:
              "linear-gradient(180deg, rgba(254, 3, 109, 0.8), #fe036d 50%, rgba(254, 3, 109, 0.7))",
          },
          {
            key: "s3",
            delay: 0.2,
            widthPct: 50,
            gradient:
              "linear-gradient(180deg, rgba(107, 205, 6, 0.9), #6bcd06 50%, rgba(107, 205, 6, 0.7))",
          },
        ].map((s) => (
          <motion.div
            key={s.key}
            initial={{ x: "-200%" }}
            animate={{ x: ["-200%", "0%", "0%", "300%"] }}
            transition={{
              duration: 2,
              delay: s.delay,
              times: [0, 0.45, 0.55, 1],
              ease: [0.65, 0, 0.35, 1],
            }}
            style={{
              position: "absolute",
              top: "-10%",
              left: "-60%",
              height: "120%",
              width: `${s.widthPct}%`,
              background: s.gradient,
              transform: "skewX(-22deg)",
              transformOrigin: "center",
            }}
          />
        ))}
      </div>

      {/* 3. st-n-burst: shield/logo thump — scale 0 → 1.2 → 1 → 0.3 */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 1, 1, 1, 0], scale: [0, 1.2, 1, 1, 0.3] }}
        transition={{
          duration: 2,
          times: [0, 0.35, 0.5, 0.65, 1],
          ease: [0.16, 1, 0.3, 1],
        }}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          translate: "-50% -50%",
          width: 420,
          height: 420,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        {/* 4. burst rings expanding outward */}
        <motion.div
          initial={{ opacity: 1, scale: 0.5, borderWidth: 8 }}
          animate={{ opacity: [1, 0], scale: [0.5, 2.8], borderWidth: [8, 1] }}
          transition={{
            duration: 1,
            delay: 0.7,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderColor: "#6bcd06",
            borderRadius: "50%",
          }}
        />
        <motion.div
          initial={{ opacity: 1, scale: 0.5, borderWidth: 8 }}
          animate={{ opacity: [1, 0], scale: [0.5, 2.8], borderWidth: [8, 1] }}
          transition={{
            duration: 1.2,
            delay: 0.85,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderColor: "#fe036d",
            borderRadius: "50%",
          }}
        />

        {/* Shield / logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logos/primary/cade.png"
          alt="CADE"
          style={{
            width: "72%",
            height: "72%",
            objectFit: "contain",
            filter: "drop-shadow(0 0 30px rgba(107, 205, 6, 0.55))",
            position: "relative",
            zIndex: 1,
          }}
        />
      </motion.div>

      {/* 5. flash — white impact punch at ~t=0.94s */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 0.6, 0, 0] }}
        transition={{
          duration: 2,
          times: [0, 0.4, 0.47, 0.5, 1],
          ease: "linear",
        }}
        style={{
          position: "absolute",
          inset: 0,
          background: "#fff",
          pointerEvents: "none",
          zIndex: 3,
        }}
      />
    </motion.div>
  );
}
