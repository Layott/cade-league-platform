"use client";

// TODO Plan 48 phase 2 — design parity
import { PreviewStub } from "../PreviewStub";
import { startingSoonBasicSchema } from "@/server/overlays/schemas";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

/**
 * starting_soon_basic — looped ambient pre-show overlay.
 *
 * Ported from `KNOWLEDGE/brand-assets/elements/01_starting_soon.html` (Plan 16
 * Wave A). Runs indefinitely until cleared. Pure CSS @keyframes for all loops
 * (GPU-friendly transforms/opacity); no framer-motion — this surface has no
 * discrete enter/exit states, only a sustained ambient bed.
 *
 * Keyframes preserved (11 from the reference HTML):
 *   1. drift        — diagonal stripes pan left infinitely
 *   2. breathe      — radial glow pulse (green @ center, pink reversed @ corner)
 *   3. scan         — single horizontal scanline sweeps top → bottom
 *   4. pulse        — tactical corner dot + HUD dot + status dot pulse
 *   5. cornerIn     — HUD corner brackets fade/scale in (staggered .3/.4/.5/.6s)
 *   6. slideDown    — top bar drops from above
 *   7. slideUp      — bottom bar rises from below
 *   8. fadeInUp     — kicker / hero lines / status row enter cascade
 *   9. shieldIn     — center shield iris-in with blur → drop-shadow
 *  10. shieldFloat  — center shield idle float (after shieldIn)
 *  11. heroBreathe  — "STARTING" text-shadow breathe (after hero enter)
 *
 * Plus 3 ambient micro-loops driven by the same keyframes applied to the
 * subtitle block: fadeInUp (one-shot enter) + heroBreathe-style opacity loop
 * so the subtitle sustains a slow fade-in / fade-out pulse, per spec "subtitle
 * fade-in-out loop".
 */
export default function StartingSoonBasicPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="starting_soon_basic"
        schema={startingSoonBasicSchema}
        position="fullscreen"
        render={(p) => (
          <div className="ss-stage" aria-hidden>
            {/* ---------- ATMOSPHERIC BACKGROUND ---------- */}
            <div className="ss-bg-base" />
            <div className="ss-bg-diagonal" />
            <div className="ss-bg-grid" />
            <div className="ss-bg-glow-green" />
            <div className="ss-bg-glow-pink" />
            <div className="ss-scanline" />

            {/* ---------- TACTICAL HUD CORNERS ---------- */}
            <div className="ss-corner ss-tl" />
            <div className="ss-corner ss-tr" />
            <div className="ss-corner ss-bl" />
            <div className="ss-corner ss-br" />

            <div className="ss-tick" style={{ top: 175, left: 60 }}>
              N · 06.5244
            </div>
            <div className="ss-tick" style={{ top: 175, right: 60 }}>
              E · 03.3792
            </div>
            <div className="ss-tick" style={{ bottom: 215, left: 60 }}>
              SEQ / 0023
            </div>
            <div className="ss-tick" style={{ bottom: 215, right: 60 }}>
              CH / 01
            </div>

            {/* ---------- TOP BAR ---------- */}
            <header className="ss-top-bar">
              <div className="ss-cade-mark">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logos/primary/cade.png" alt="" />
              </div>
              <div className="ss-hud-meta">
                <span className="ss-hud-tick" />
                <span className="ss-hud-dot" />
                <span>LIVE BROADCAST · STANDBY</span>
              </div>
            </header>

            {/* ---------- BOTTOM BAR ---------- */}
            <footer className="ss-bottom-bar">
              <div className="ss-bb-header">
                <span className="ss-bb-chev">◣</span>
                <span className="ss-bb-lbl">OFFICIAL PARTNERS</span>
                <span className="ss-bb-line" />
              </div>
              <div className="ss-partners">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/logos/primary/gameevo-white.png"
                  alt=""
                  className="ss-partner-img"
                />
                <span className="ss-partner-divider" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/logos/partners/esports-africa-news-white.png"
                  alt=""
                  className="ss-partner-img"
                />
                <span className="ss-partner-divider" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/logos/partners/gamepride.png"
                  alt=""
                  className="ss-partner-img"
                />
                <span className="ss-partner-divider" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/logos/partners/trace-tv.png"
                  alt=""
                  className="ss-partner-img"
                />
              </div>
            </footer>

            {/* ---------- CENTER STAGE ---------- */}
            <main className="ss-center-stage">
              <div className="ss-shield-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/logos/primary/pro-league.png"
                  alt=""
                  className="ss-shield"
                />
              </div>
              <div className="ss-kicker">NATIONAL E-SOCCER PRO LEAGUE</div>
              <span className="ss-hero ss-hero-small font-broadcast-accent">
                STREAM IS
              </span>
              <span className="ss-hero ss-hero-big font-broadcast-display">
                STARTING
              </span>
              <span className="ss-hero ss-hero-sub font-broadcast-accent">
                MOMENTARILY
              </span>
              <div className="ss-status-row">
                <span className="ss-status-dot" />
                <span className="ss-status-txt">
                  {p.subtitle ?? "PRE-MATCH SEQUENCE INITIATED"}
                </span>
              </div>
            </main>

            {/* All motion is pure CSS for GPU-friendly infinite ambience. */}
            <style jsx>{`
              .ss-stage {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                color: #fff;
                background: transparent;
              }

              /* ---------- ATMOSPHERIC BACKGROUND ---------- */
              .ss-bg-base {
                position: absolute;
                inset: 0;
                background: radial-gradient(
                  ellipse 70% 60% at 50% 50%,
                  #0b1a03 0%,
                  #030502 72%,
                  #000 100%
                );
              }
              .ss-bg-grid {
                position: absolute;
                inset: 0;
                background-image:
                  linear-gradient(
                    rgba(107, 205, 6, 0.035) 1px,
                    transparent 1px
                  ),
                  linear-gradient(
                    90deg,
                    rgba(107, 205, 6, 0.035) 1px,
                    transparent 1px
                  );
                background-size: 120px 120px;
                mask-image: radial-gradient(
                  ellipse 85% 75% at 50% 50%,
                  black 20%,
                  transparent 100%
                );
                -webkit-mask-image: radial-gradient(
                  ellipse 85% 75% at 50% 50%,
                  black 20%,
                  transparent 100%
                );
              }
              .ss-bg-diagonal {
                position: absolute;
                inset: -10%;
                background-image: repeating-linear-gradient(
                  -22deg,
                  transparent 0,
                  transparent 40px,
                  rgba(107, 205, 6, 0.02) 40px,
                  rgba(107, 205, 6, 0.02) 41px
                );
                animation: ss-drift 45s linear infinite;
                will-change: transform;
              }
              .ss-bg-glow-green {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 1400px;
                height: 1400px;
                background: radial-gradient(
                  circle,
                  rgba(107, 205, 6, 0.2) 0%,
                  transparent 55%
                );
                filter: blur(40px);
                transform: translate(-50%, -50%);
                animation: ss-breathe 6s ease-in-out infinite;
                will-change: transform, opacity;
              }
              .ss-bg-glow-pink {
                position: absolute;
                left: 15%;
                top: 85%;
                width: 600px;
                height: 600px;
                background: radial-gradient(
                  circle,
                  rgba(254, 3, 109, 0.14) 0%,
                  transparent 55%
                );
                filter: blur(60px);
                transform: translate(-50%, -50%);
                animation: ss-breathe 8s ease-in-out infinite reverse;
                will-change: transform, opacity;
              }
              .ss-scanline {
                position: absolute;
                left: 0;
                right: 0;
                height: 2px;
                background: linear-gradient(
                  90deg,
                  transparent,
                  rgba(142, 255, 20, 0.5),
                  transparent
                );
                animation: ss-scan 9s linear infinite;
                animation-delay: 3s;
              }

              /* ---------- TACTICAL HUD CORNERS ---------- */
              .ss-corner {
                position: absolute;
                width: 100px;
                height: 100px;
                border: 3px solid #6bcd06;
                filter: drop-shadow(0 0 10px #6bcd06);
                opacity: 0;
                animation: ss-corner-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.3s
                  forwards;
              }
              .ss-corner.ss-tl {
                top: 50px;
                left: 50px;
                border-right: none;
                border-bottom: none;
              }
              .ss-corner.ss-tr {
                top: 50px;
                right: 50px;
                border-left: none;
                border-bottom: none;
                animation-delay: 0.4s;
              }
              .ss-corner.ss-bl {
                bottom: 50px;
                left: 50px;
                border-right: none;
                border-top: none;
                animation-delay: 0.5s;
              }
              .ss-corner.ss-br {
                bottom: 50px;
                right: 50px;
                border-left: none;
                border-top: none;
                animation-delay: 0.6s;
              }
              .ss-corner::before {
                content: "";
                position: absolute;
                width: 8px;
                height: 8px;
                background: #fe036d;
                box-shadow: 0 0 12px #fe036d;
                animation: ss-pulse 1.5s ease-in-out infinite;
              }
              .ss-corner.ss-tl::before {
                top: -6px;
                left: -6px;
              }
              .ss-corner.ss-tr::before {
                top: -6px;
                right: -6px;
              }
              .ss-corner.ss-bl::before {
                bottom: -6px;
                left: -6px;
              }
              .ss-corner.ss-br::before {
                bottom: -6px;
                right: -6px;
              }

              /* ---------- TOP BAR ---------- */
              .ss-top-bar {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 130px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0 210px;
                transform: translateY(-100%);
                animation: ss-slide-down 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s
                  forwards;
              }
              .ss-cade-mark :global(img) {
                height: 76px;
                filter: drop-shadow(0 0 14px rgba(254, 3, 109, 0.45));
              }
              .ss-hud-meta {
                font-weight: 500;
                font-size: 13px;
                letter-spacing: 4px;
                color: #6bcd06;
                text-transform: uppercase;
                display: flex;
                align-items: center;
                gap: 16px;
              }
              .ss-hud-dot {
                width: 10px;
                height: 10px;
                background: #fe036d;
                box-shadow: 0 0 10px #fe036d;
                animation: ss-pulse 1.5s ease-in-out infinite;
              }
              .ss-hud-tick {
                width: 60px;
                height: 2px;
                background: linear-gradient(90deg, transparent, #6bcd06);
              }

              /* ---------- BOTTOM BAR ---------- */
              .ss-bottom-bar {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 150px;
                padding: 0 210px 20px;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 14px;
                transform: translateY(100%);
                animation: ss-slide-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s
                  forwards;
              }
              .ss-bb-header {
                display: flex;
                align-items: center;
                gap: 18px;
              }
              .ss-bb-chev {
                color: #fe036d;
                font-size: 10px;
              }
              .ss-bb-lbl {
                font-weight: 700;
                font-size: 11px;
                letter-spacing: 5px;
                color: #6bcd06;
                text-transform: uppercase;
              }
              .ss-bb-line {
                flex: 1;
                height: 1px;
                background: linear-gradient(90deg, #6bcd06, transparent 60%);
              }
              .ss-partners {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 80px;
                height: 64px;
              }
              .ss-partner-img {
                max-height: 56px;
                max-width: 200px;
                object-fit: contain;
                opacity: 0.92;
              }
              .ss-partner-divider {
                width: 1px;
                height: 38px;
                background: rgba(107, 205, 6, 0.35);
              }

              /* ---------- TICK MARKS ---------- */
              .ss-tick {
                position: absolute;
                font-weight: 500;
                font-size: 10px;
                letter-spacing: 2px;
                color: #6bcd06;
                opacity: 0.5;
                text-transform: uppercase;
              }

              /* ---------- CENTER STAGE ---------- */
              .ss-center-stage {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
                width: 1500px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0;
              }
              .ss-shield-wrap {
                opacity: 0;
                animation:
                  ss-shield-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.6s forwards,
                  ss-shield-float 5s ease-in-out 1.5s infinite;
              }
              .ss-shield {
                width: 230px;
                height: auto;
                display: block;
                filter: drop-shadow(0 0 30px rgba(254, 3, 109, 0.55));
              }
              .ss-kicker {
                font-weight: 700;
                font-size: 19px;
                letter-spacing: 12px;
                color: #6bcd06;
                margin: 22px 0 10px;
                text-transform: uppercase;
                opacity: 0;
                animation: ss-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1s
                  forwards;
              }
              .ss-kicker::before,
              .ss-kicker::after {
                content: "—";
                color: #fe036d;
                margin: 0 14px;
              }
              .ss-hero {
                text-transform: uppercase;
                line-height: 0.88;
                letter-spacing: -3px;
                opacity: 0;
                display: block;
              }
              .ss-hero-small {
                font-weight: 400;
                font-size: 56px;
                color: #6bcd06;
                letter-spacing: 14px;
                margin-bottom: 6px;
                animation: ss-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.1s
                  forwards;
              }
              .ss-hero-big {
                font-weight: 900;
                font-size: 200px;
                color: #fff;
                text-shadow:
                  0 0 50px rgba(107, 205, 6, 0.35),
                  3px 3px 0 rgba(254, 3, 109, 0.5);
                animation:
                  ss-fade-in-up 0.75s cubic-bezier(0.16, 1, 0.3, 1) 1.2s forwards,
                  ss-hero-breathe 4s ease-in-out 2.2s infinite;
              }
              .ss-hero-sub {
                font-weight: 700;
                font-size: 54px;
                color: #fe036d;
                letter-spacing: 10px;
                margin-top: 14px;
                text-shadow: 0 0 20px rgba(254, 3, 109, 0.4);
                animation: ss-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.4s
                  forwards;
              }
              .ss-status-row {
                display: inline-flex;
                align-items: center;
                gap: 14px;
                margin-top: 44px;
                padding: 12px 28px;
                border: 1px solid rgba(107, 205, 6, 0.35);
                background: rgba(107, 205, 6, 0.05);
                clip-path: polygon(
                  14px 0,
                  100% 0,
                  calc(100% - 14px) 100%,
                  0 100%
                );
                opacity: 0;
                animation:
                  ss-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.6s forwards,
                  ss-subtitle-loop 5s ease-in-out 3s infinite;
              }
              .ss-status-dot {
                width: 12px;
                height: 12px;
                background: #6bcd06;
                box-shadow: 0 0 16px #6bcd06;
                animation: ss-pulse 1.2s ease-in-out infinite;
              }
              .ss-status-txt {
                font-weight: 500;
                font-size: 14px;
                letter-spacing: 5px;
                color: #e8f0dc;
                text-transform: uppercase;
              }

              /* ---------- KEYFRAMES ---------- */
              @keyframes ss-drift {
                from {
                  transform: translateX(0);
                }
                to {
                  transform: translateX(-120px);
                }
              }
              @keyframes ss-breathe {
                0%,
                100% {
                  opacity: 0.6;
                  transform: translate(-50%, -50%) scale(1);
                }
                50% {
                  opacity: 1;
                  transform: translate(-50%, -50%) scale(1.08);
                }
              }
              @keyframes ss-scan {
                0% {
                  top: -5%;
                  opacity: 0;
                }
                10% {
                  opacity: 1;
                }
                90% {
                  opacity: 1;
                }
                100% {
                  top: 105%;
                  opacity: 0;
                }
              }
              @keyframes ss-pulse {
                0%,
                100% {
                  opacity: 1;
                  transform: scale(1);
                }
                50% {
                  opacity: 0.3;
                  transform: scale(0.65);
                }
              }
              @keyframes ss-corner-in {
                from {
                  opacity: 0;
                  transform: scale(0.6);
                }
                to {
                  opacity: 1;
                  transform: scale(1);
                }
              }
              @keyframes ss-slide-down {
                from {
                  transform: translateY(-100%);
                }
                to {
                  transform: translateY(0);
                }
              }
              @keyframes ss-slide-up {
                from {
                  transform: translateY(100%);
                }
                to {
                  transform: translateY(0);
                }
              }
              @keyframes ss-fade-in-up {
                from {
                  opacity: 0;
                  transform: translateY(28px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
              @keyframes ss-shield-in {
                0% {
                  opacity: 0;
                  transform: scale(0.5);
                  filter: drop-shadow(0 0 60px rgba(107, 205, 6, 0.9)) blur(20px);
                }
                60% {
                  opacity: 1;
                  transform: scale(1.08);
                  filter: drop-shadow(0 0 40px rgba(107, 205, 6, 0.6)) blur(0);
                }
                100% {
                  opacity: 1;
                  transform: scale(1);
                  filter: drop-shadow(0 0 30px rgba(254, 3, 109, 0.55));
                }
              }
              @keyframes ss-shield-float {
                0%,
                100% {
                  transform: translateY(0);
                }
                50% {
                  transform: translateY(-10px);
                }
              }
              @keyframes ss-hero-breathe {
                0%,
                100% {
                  opacity: 1;
                  text-shadow:
                    0 0 50px rgba(107, 205, 6, 0.35),
                    3px 3px 0 rgba(254, 3, 109, 0.5);
                }
                50% {
                  opacity: 0.95;
                  text-shadow:
                    0 0 70px rgba(107, 205, 6, 0.55),
                    3px 3px 0 rgba(254, 3, 109, 0.6);
                }
              }
              /* Subtitle fade-in-out loop (per spec) — sustained ambient pulse
                 layered on top of the one-shot ss-fade-in-up enter. */
              @keyframes ss-subtitle-loop {
                0%,
                100% {
                  opacity: 1;
                }
                50% {
                  opacity: 0.55;
                }
              }
            `}</style>
          </div>
        )}
      />
    </OverlayFrame>
  );
}
