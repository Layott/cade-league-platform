"use client";

import { PreviewStub } from "../PreviewStub";
import { layoutAnimatedBgSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A — port of `KNOWLEDGE/brand-assets/elements/11_animated_bg.html`.
 *
 * Pure ambient looped background for use behind caster cams, stat cards,
 * stingers, etc. Runs as a persistent browser-source that never mounts
 * narrative content — it's a bed. Implementation is 100% CSS
 * `@keyframes` (no framer-motion) since the motion is an infinite GPU
 * loop: `translate3d` + `transform: scale` only, `will-change: transform`
 * where each layer benefits.
 *
 * Intensity branching (from schema payload):
 *   low    — 0.30 master opacity + slow timings (15-25s)
 *   medium — 0.60 master opacity + medium timings (8-15s)  [default]
 *   high   — 1.00 master opacity + fast timings (4-8s)
 *
 * No sound — this overlay is meant to sit under other layers.
 */

type Intensity = "low" | "medium" | "high";

type IntensityBand = {
  /** Master opacity multiplier applied to the whole stage. */
  opacity: number;
  /** Grid translation loop (seconds). */
  grid: number;
  /** Diagonal stripe drift (seconds). */
  diagonal: number;
  /** Radial pulse breathe (seconds). */
  pulse: number;
  /** Green orb travel (seconds). */
  orbGreen: number;
  /** Pink orb travel (seconds). */
  orbPink: number;
  /** Primary scanline sweep (seconds). */
  scanA: number;
  /** Secondary scanline sweep (seconds). */
  scanB: number;
  /** Particle float loop (seconds). */
  particles: number;
};

const BANDS: Record<Intensity, IntensityBand> = {
  low: {
    opacity: 0.3,
    grid: 90,
    diagonal: 45,
    pulse: 18,
    orbGreen: 28,
    orbPink: 32,
    scanA: 22,
    scanB: 25,
    particles: 40,
  },
  medium: {
    opacity: 0.6,
    grid: 60,
    diagonal: 30,
    pulse: 12,
    orbGreen: 20,
    orbPink: 24,
    scanA: 14,
    scanB: 18,
    particles: 30,
  },
  high: {
    opacity: 1,
    grid: 30,
    diagonal: 15,
    pulse: 6,
    orbGreen: 10,
    orbPink: 12,
    scanA: 6,
    scanB: 8,
    particles: 16,
  },
};

export default function LayoutAnimatedBgPage() {
  return (
    <PreviewStub
      templateKey="layout_animated_bg"
      schema={layoutAnimatedBgSchema}
      position="center"
      render={(payload) => {
        const intensity: Intensity = (payload.intensity ?? "medium") as Intensity;
        const band = BANDS[intensity];
        return <AnimatedBg band={band} intensity={intensity} />;
      }}
    />
  );
}

function AnimatedBg({
  band,
  intensity,
}: {
  band: IntensityBand;
  intensity: Intensity;
}) {
  return (
    <div
      data-intensity={intensity}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        opacity: band.opacity,
      }}
    >
      <style>{KEYFRAMES}</style>

      {/* Base radial — the darkest canvas under everything. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 70% at 50% 50%, #0b1a03 0%, #030502 72%, #000 100%)",
        }}
      />

      {/* Breathing radial wash. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 60% 45% at 50% 50%, transparent 30%, rgba(107,205,6,0.06) 70%, transparent 100%)",
          animation: `cade-pulse-radial ${band.pulse}s ease-in-out infinite`,
          willChange: "transform, opacity",
        }}
      />

      {/* Scrolling grid — translate3d on background-position proxy via transform. */}
      <div
        style={{
          position: "absolute",
          inset: "-5%",
          backgroundImage:
            "linear-gradient(rgba(107,205,6,0.04) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(107,205,6,0.04) 1px, transparent 1px)",
          backgroundSize: "120px 120px",
          maskImage:
            "radial-gradient(ellipse 85% 75% at 50% 50%, black 20%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 85% 75% at 50% 50%, black 20%, transparent 100%)",
          animation: `cade-grid-drift ${band.grid}s linear infinite`,
          willChange: "transform",
        }}
      />

      {/* Diagonal stripe drift. */}
      <div
        style={{
          position: "absolute",
          inset: "-10%",
          backgroundImage:
            "repeating-linear-gradient(-22deg, transparent 0, transparent 40px, rgba(107,205,6,0.025) 40px, rgba(107,205,6,0.025) 41px)",
          animation: `cade-diagonal-drift ${band.diagonal}s linear infinite`,
          willChange: "transform",
        }}
      />

      {/* Green orb — top-left travels to bottom-right area. */}
      <div
        style={{
          position: "absolute",
          top: "-200px",
          left: "-200px",
          width: "900px",
          height: "900px",
          borderRadius: "50%",
          filter: "blur(40px)",
          mixBlendMode: "screen",
          background:
            "radial-gradient(circle, rgba(107,205,6,0.3) 0%, transparent 60%)",
          animation: `cade-float-green ${band.orbGreen}s ease-in-out infinite alternate`,
          willChange: "transform",
        }}
      />

      {/* Pink orb — bottom-right travels upward-left. */}
      <div
        style={{
          position: "absolute",
          bottom: "-200px",
          right: "-150px",
          width: "700px",
          height: "700px",
          borderRadius: "50%",
          filter: "blur(40px)",
          mixBlendMode: "screen",
          background:
            "radial-gradient(circle, rgba(254,3,109,0.25) 0%, transparent 60%)",
          animation: `cade-float-pink ${band.orbPink}s ease-in-out infinite alternate`,
          willChange: "transform",
        }}
      />

      {/* Scanline — primary green. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: "2px",
          background:
            "linear-gradient(90deg, transparent, rgba(142,255,20,0.4), transparent)",
          animation: `cade-scanline-move ${band.scanA}s linear infinite`,
          willChange: "transform, opacity",
        }}
      />

      {/* Scanline — secondary pink, offset delay. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: "1px",
          background:
            "linear-gradient(90deg, transparent, rgba(254,3,109,0.35), transparent)",
          animation: `cade-scanline-move ${band.scanB}s linear infinite`,
          animationDelay: `${Math.round(band.scanB / 3)}s`,
          willChange: "transform, opacity",
        }}
      />

      {/* Particle bed (two layers with alternating direction). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle 2px at 15% 25%, rgba(107,205,6,0.6), transparent)," +
            "radial-gradient(circle 1.5px at 85% 40%, rgba(254,3,109,0.5), transparent)," +
            "radial-gradient(circle 2px at 45% 80%, rgba(107,205,6,0.4), transparent)," +
            "radial-gradient(circle 1.5px at 65% 15%, rgba(254,3,109,0.45), transparent)," +
            "radial-gradient(circle 2px at 25% 65%, rgba(107,205,6,0.5), transparent)," +
            "radial-gradient(circle 1.5px at 90% 75%, rgba(254,3,109,0.55), transparent)",
          animation: `cade-particles-float ${band.particles}s ease-in-out infinite alternate`,
          willChange: "transform, opacity",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle 1px at 35% 35%, rgba(107,205,6,0.5), transparent)," +
            "radial-gradient(circle 1.5px at 70% 60%, rgba(254,3,109,0.4), transparent)," +
            "radial-gradient(circle 2px at 10% 85%, rgba(107,205,6,0.6), transparent)," +
            "radial-gradient(circle 1px at 55% 20%, rgba(254,3,109,0.5), transparent)",
          animation: `cade-particles-float ${Math.round(band.particles * 1.2)}s ease-in-out infinite alternate-reverse`,
          willChange: "transform, opacity",
        }}
      />
    </div>
  );
}

/**
 * Keyframes are emitted inline so the overlay is self-contained
 * (browser-source pages are consumed by vMix/OBS/Streamlabs without
 * a global CSS bundle guarantee). All transforms use `translate3d` to
 * keep the layers on the GPU compositor — zero layout-triggering
 * properties animate here.
 */
const KEYFRAMES = `
@keyframes cade-pulse-radial {
  0%, 100% { opacity: 0.6; transform: translate3d(0, 0, 0) scale(1); }
  50%      { opacity: 1;   transform: translate3d(0, 0, 0) scale(1.1); }
}
@keyframes cade-grid-drift {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(120px, 120px, 0); }
}
@keyframes cade-diagonal-drift {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-120px, 0, 0); }
}
@keyframes cade-float-green {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(400px, 300px, 0); }
}
@keyframes cade-float-pink {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-400px, -200px, 0); }
}
@keyframes cade-scanline-move {
  0%   { transform: translate3d(0, -5vh, 0); opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translate3d(0, 105vh, 0); opacity: 0; }
}
@keyframes cade-particles-float {
  from { transform: translate3d(0, 0, 0); opacity: 0.7; }
  to   { transform: translate3d(80px, -120px, 0); opacity: 1; }
}
`;
