"use client";

import Image from "next/image";
import { PreviewStub } from "../PreviewStub";
import { stingerIntroSchema } from "@/server/overlays/schemas";
import { useOverlaySound } from "@/lib/overlay-sound";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A — `stinger_intro` motion port from
 * `KNOWLEDGE/brand-assets/elements/01_long_intro.html`.
 *
 * 10-second full-screen intro sequence. Timing, easings, and layer order
 * mirror the reference HTML one-to-one. Because the sequence is tightly
 * choreographed via percentage-based `@keyframes`, the ambient + narrative
 * layers are authored as CSS keyframes rather than framer-motion
 * descriptors — recreating 14 synchronised keyframe tracks via JS-driven
 * tweens would drift against the reference. The OverlayFrame's
 * `AnimatePresence` still handles the mount/unmount enter/exit.
 *
 * Data bindings:
 *   - `matchDayLabel` → `.li-sub` row ("PRO LEAGUE · DIVISION 2" fallback)
 *   - `seasonLabel` → `.s-main` row ("MATCHWEEK 7 · DAY 1" fallback)
 *
 * Sound: `useOverlaySound("stinger-intro")` fires on each event/cycle via
 * the PreviewStub `cycle` trigger — mirrors the reference which expects
 * audio to kick simultaneously with the sequence.
 */
export default function StingerIntroPage() {
  return (
    <PreviewStub
      templateKey="stinger_intro"
      schema={stingerIntroSchema}
      position="fullscreen"
      render={(p, { cycle }) => <StingerIntroStage payload={p} cycle={cycle} />}
    />
  );
}

type Payload = {
  seasonLabel: string;
  matchDayLabel?: string;
};

function StingerIntroStage({ payload, cycle }: { payload: Payload; cycle: number }) {
  // Fire the stinger-intro sound exactly once per mount / re-cycle.
  useOverlaySound("stinger-intro", cycle);

  const subLabel = payload.matchDayLabel ?? "PRO LEAGUE · DIVISION 2";
  const seasonLabel = payload.seasonLabel ?? "MATCHWEEK 7 · DAY 1";

  return (
    <div key={cycle} className="stinger-intro-stage" data-testid="stinger-intro-stage">
      <style>{STINGER_INTRO_CSS}</style>

      {/* ambient background layers */}
      <div className="si-bg-build" />
      <div className="si-bg-grid" />

      {/* 3 staggered pre-flashes */}
      <div className="si-pre-flash si-p1" />
      <div className="si-pre-flash si-p2" />
      <div className="si-pre-flash si-p3" />

      {/* spinning rays (ambient) */}
      <div className="si-rays" />

      {/* shield (central logo) + 3 concentric burst rings */}
      <div className="si-shield-wrap">
        <Image
          src="/brand/logos/primary/cade.png"
          alt="CADE Esports"
          width={260}
          height={260}
          priority
          className="si-shield"
        />
        <div className="si-burst si-r1" />
        <div className="si-burst si-r2" />
        <div className="si-burst si-r3" />
      </div>

      {/* title block */}
      <div className="si-title">
        <div className="si-kicker font-broadcast-accent">— NATIONAL —</div>
        <div className="si-main font-broadcast-display">E-SOCCER</div>
        <div className="si-sub font-broadcast-display">{subLabel}</div>
      </div>

      {/* lower season badge */}
      <div className="si-season">
        <div className="s-kicker font-broadcast-accent">SEASON 2025 / 26</div>
        <div className="s-main font-broadcast-display">{seasonLabel}</div>
      </div>

      {/* top-left CADE lockup */}
      <Image
        src="/brand/logos/primary/cade.png"
        alt=""
        aria-hidden
        width={90}
        height={90}
        className="si-cade"
      />

      {/* top-right tagline */}
      <div className="si-tagline font-broadcast-accent">
        BROADCAST · LIVE · OFFICIAL
      </div>

      {/* scanline sweep + final flash */}
      <div className="si-scan" />
      <div className="si-flash-final" />
    </div>
  );
}

/**
 * Keyframe timings locked to `01_long_intro.html`. Percentages are of the
 * same 10 s duration; easings preserved verbatim.
 *
 * The `.stinger-intro-stage` class scopes every selector so the CSS cannot
 * leak out of this overlay route. `@keyframes` identifiers are prefixed
 * `si-*` to avoid clashing with sibling overlays' keyframes.
 */
const STINGER_INTRO_CSS = `
.stinger-intro-stage {
  --si-green: #6bcd06;
  --si-pink: #fe036d;
  --si-pink-bright: #ff4da0;
  --si-white: #ffffff;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  color: var(--si-white);
  font-family: var(--font-quedora), "Quedora", sans-serif;
}
.stinger-intro-stage * { box-sizing: border-box; }

/* --- ambient background layers --------------------------------- */
.stinger-intro-stage .si-bg-build {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 80% 70% at 50% 50%, #0b1a03 0%, #030502 72%, #000 100%);
  opacity: 0;
  animation: si-bg 10s linear forwards;
}
@keyframes si-bg {
  0%   { opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { opacity: 0; }
}
.stinger-intro-stage .si-bg-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(107, 205, 6, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(107, 205, 6, 0.05) 1px, transparent 1px);
  background-size: 100px 100px;
  mask-image: radial-gradient(ellipse 85% 75% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 85% 75% at 50% 50%, black 20%, transparent 100%);
  opacity: 0;
  animation: si-grid 10s linear forwards;
}
@keyframes si-grid {
  0%   { opacity: 0; background-size: 10px 10px; }
  20%  { opacity: 1; background-size: 100px 100px; }
  92%  { opacity: 1; }
  100% { opacity: 0; }
}

/* --- pre-flashes (3 staggered radial bursts) ------------------- */
.stinger-intro-stage .si-pre-flash {
  position: absolute; inset: 0;
  background: radial-gradient(circle, rgba(107, 205, 6, 0.6) 0%, transparent 70%);
  opacity: 0;
  z-index: 2;
}
.stinger-intro-stage .si-p1 { animation: si-preflash 10s linear forwards; }
.stinger-intro-stage .si-p2 { animation: si-preflash2 10s linear forwards; }
.stinger-intro-stage .si-p3 {
  background: radial-gradient(circle, rgba(254, 3, 109, 0.55) 0%, transparent 70%);
  animation: si-preflash3 10s linear forwards;
}
@keyframes si-preflash  { 0%, 4% {opacity:0;} 5% {opacity:0.9;} 7% {opacity:0;} 100% {opacity:0;} }
@keyframes si-preflash2 { 0%, 10% {opacity:0;} 11% {opacity:0.9;} 13% {opacity:0;} 100% {opacity:0;} }
@keyframes si-preflash3 { 0%, 16% {opacity:0;} 17% {opacity:1;} 19% {opacity:0;} 100% {opacity:0;} }

/* --- central shield + burst rings ------------------------------ */
.stinger-intro-stage .si-shield-wrap {
  position: absolute;
  left: 50%; top: 36%;
  transform: translate(-50%, -50%);
  z-index: 5;
  opacity: 0;
  width: 260px; height: 260px;
  animation: si-shield-seq 10s ease-out forwards;
}
@keyframes si-shield-seq {
  0%, 18% { opacity: 0; transform: translate(-50%, -50%) scale(0.1) rotate(-20deg); }
  22%     { opacity: 1; transform: translate(-50%, -50%) scale(1.3) rotate(5deg); }
  25%     { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0); }
  72%     { opacity: 1; transform: translate(-50%, -50%) scale(1.05) rotate(0); }
  92%     { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0); }
  100%    { opacity: 0; transform: translate(-50%, -50%) scale(1.2) rotate(0); }
}
.stinger-intro-stage .si-shield {
  width: 260px; height: auto;
  filter: drop-shadow(0 0 40px rgba(254, 3, 109, 0.8)) drop-shadow(0 0 100px rgba(107, 205, 6, 0.5));
}
.stinger-intro-stage .si-burst {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 280px; height: 280px;
  border: 4px solid var(--si-green);
  border-radius: 50%;
  box-shadow: 0 0 40px var(--si-green);
  opacity: 0;
  pointer-events: none;
}
.stinger-intro-stage .si-r1 { animation: si-burst-pulse 10s ease-out 2.0s forwards; }
.stinger-intro-stage .si-r2 {
  animation: si-burst-pulse 10s ease-out 2.15s forwards;
  border-color: var(--si-pink);
  box-shadow: 0 0 40px var(--si-pink);
}
.stinger-intro-stage .si-r3 {
  animation: si-burst-pulse 10s ease-out 2.3s forwards;
  border-color: var(--si-white);
  box-shadow: 0 0 40px var(--si-white);
}
@keyframes si-burst-pulse {
  0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.5); border-width: 8px; }
  5%   { opacity: 0; transform: translate(-50%, -50%) scale(3); border-width: 0px; }
  100% { opacity: 0; }
}

/* --- title block ------------------------------------------------ */
.stinger-intro-stage .si-title {
  position: absolute;
  left: 0; right: 0; top: 62%;
  transform: translateY(-50%);
  text-align: center;
  z-index: 6;
  opacity: 0;
  animation: si-title-seq 10s ease-out forwards;
}
@keyframes si-title-seq {
  0%, 30%  { opacity: 0; transform: translateY(calc(-50% + 40px)); }
  35%      { opacity: 1; transform: translateY(-50%); }
  85%      { opacity: 1; }
  92%      { opacity: 0; transform: translateY(calc(-50% - 20px)); }
  100%     { opacity: 0; }
}
.stinger-intro-stage .si-kicker {
  font-weight: 700;
  font-size: 22px; letter-spacing: 14px;
  color: var(--si-green); text-transform: uppercase;
  margin-bottom: 8px;
}
.stinger-intro-stage .si-main {
  font-weight: 900;
  font-size: 180px; line-height: 0.9;
  color: var(--si-white); letter-spacing: -3px;
  text-transform: uppercase;
  text-shadow:
    0 0 50px rgba(107, 205, 6, 0.6),
    4px 4px 0 var(--si-pink);
}
.stinger-intro-stage .si-sub {
  font-weight: 400;
  font-size: 28px; letter-spacing: 14px;
  color: var(--si-pink-bright); text-transform: uppercase;
  margin-top: 6px;
  text-shadow: 0 0 16px rgba(254, 3, 109, 0.5);
}

/* --- lower season badge ---------------------------------------- */
.stinger-intro-stage .si-season {
  position: absolute;
  left: 50%; bottom: 18%;
  transform: translateX(-50%);
  text-align: center;
  padding: 16px 50px;
  border: 2px solid var(--si-green);
  background: rgba(107, 205, 6, 0.08);
  clip-path: polygon(16px 0, 100% 0, calc(100% - 16px) 100%, 0 100%);
  opacity: 0;
  animation: si-season-seq 10s ease-out forwards;
  z-index: 6;
}
@keyframes si-season-seq {
  0%, 60% { opacity: 0; transform: translateX(-50%) translateY(20px); }
  65%     { opacity: 1; transform: translateX(-50%) translateY(0); }
  88%     { opacity: 1; }
  95%     { opacity: 0; transform: translateX(-50%) translateY(-20px); }
  100%    { opacity: 0; }
}
.stinger-intro-stage .s-kicker {
  font-weight: 700;
  font-size: 13px; letter-spacing: 8px;
  color: var(--si-green); text-transform: uppercase;
  margin-bottom: 4px;
}
.stinger-intro-stage .s-main {
  font-weight: 900;
  font-size: 32px; letter-spacing: 3px;
  color: var(--si-white); text-transform: uppercase;
}

/* --- top-left CADE lockup -------------------------------------- */
.stinger-intro-stage .si-cade {
  position: absolute;
  top: 50px; left: 60px;
  height: 90px; width: auto;
  opacity: 0;
  filter: drop-shadow(0 0 12px rgba(254, 3, 109, 0.5));
  animation: si-cade-seq 10s ease-out forwards;
  z-index: 6;
}
@keyframes si-cade-seq {
  0%, 7% { opacity: 0; transform: translateX(-40px); }
  10%    { opacity: 1; transform: translateX(0); }
  90%    { opacity: 1; }
  100%   { opacity: 0; }
}

/* --- top-right tagline ----------------------------------------- */
.stinger-intro-stage .si-tagline {
  position: absolute;
  top: 65px; right: 60px;
  display: flex; align-items: center; gap: 14px;
  font-weight: 700;
  font-size: 14px; letter-spacing: 6px;
  color: var(--si-green); text-transform: uppercase;
  opacity: 0;
  animation: si-tag-seq 10s ease-out forwards;
  z-index: 6;
}
@keyframes si-tag-seq {
  0%, 8% { opacity: 0; transform: translateX(40px); }
  12%    { opacity: 1; transform: translateX(0); }
  90%    { opacity: 1; }
  100%   { opacity: 0; }
}

/* --- spinning conic rays (ambient) ----------------------------- */
.stinger-intro-stage .si-rays {
  position: absolute;
  left: 50%; top: 50%;
  width: 200vmax; height: 200vmax;
  transform: translate(-50%, -50%);
  background: conic-gradient(
    from 0deg,
    rgba(107, 205, 6, 0.15) 0deg, transparent 30deg,
    rgba(254, 3, 109, 0.12) 60deg, transparent 90deg,
    rgba(107, 205, 6, 0.15) 120deg, transparent 150deg,
    rgba(254, 3, 109, 0.12) 180deg, transparent 210deg,
    rgba(107, 205, 6, 0.15) 240deg, transparent 270deg,
    rgba(254, 3, 109, 0.12) 300deg, transparent 330deg
  );
  opacity: 0;
  mix-blend-mode: screen;
  animation: si-rays-slow 10s linear forwards;
  z-index: 1;
  pointer-events: none;
}
@keyframes si-rays-slow {
  0%   { opacity: 0; transform: translate(-50%, -50%) rotate(0); }
  25%  { opacity: 0.6; }
  75%  { opacity: 0.6; }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(270deg); }
}

/* --- scanline (two-pass sweep) --------------------------------- */
.stinger-intro-stage .si-scan {
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(142, 255, 20, 0.7), transparent);
  animation: si-scan-twice 10s linear forwards;
  z-index: 7;
  pointer-events: none;
}
@keyframes si-scan-twice {
  0%   { top: -5%; opacity: 0; }
  5%   { opacity: 1; }
  45%  { top: 105%; opacity: 1; }
  48%  { top: -5%; opacity: 0; }
  52%  { opacity: 1; top: -5%; }
  95%  { top: 105%; opacity: 0; }
  100% { top: 105%; opacity: 0; }
}

/* --- final climax flash ---------------------------------------- */
.stinger-intro-stage .si-flash-final {
  position: absolute; inset: 0;
  background: white;
  opacity: 0;
  animation: si-flash-final 10s linear forwards;
  z-index: 20;
  pointer-events: none;
}
@keyframes si-flash-final {
  0%, 94% { opacity: 0; }
  95%     { opacity: 0.7; }
  98%     { opacity: 0; }
  100%    { opacity: 0; }
}
`;
