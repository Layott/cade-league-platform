"use client";

import Image from "next/image";
import { PreviewStub } from "../PreviewStub";
import { layoutBrbBasicSchema } from "@/server/overlays/schemas";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A — `layout_brb_basic`
 *
 * Motion port from `KNOWLEDGE/brand-assets/elements/02_be_right_back.html`.
 * All 11 reference @keyframes preserved:
 *   1. drift         — diagonal texture slow horizontal drift (45s linear loop)
 *   2. breathe       — radial glow scale/opacity breath (6s/8s loops)
 *   3. scan          — vertical scanline sweep top→bottom (9s linear loop)
 *   4. pulse         — indicator-dot opacity+scale pulse (1.2s/1.5s ease loop)
 *   5. cornerIn      — tactical HUD corners fade+scale entrance
 *   6. slideDown     — top bar slides in from above
 *   7. slideUp       — bottom partner bar slides in from below
 *   8. fadeInUp      — kicker / hero / status row stagger entrance
 *   9. shieldIn      — CADE shield iris-in + blur-to-sharp entrance
 *  10. shieldFloat   — shield idle levitation after entrance (5s loop)
 *  11. heroBreathe   — "BE RIGHT" headline glow breathing (4s loop)
 *
 * All motion is pure CSS @keyframes — zero JS timers. No sound.
 */
export default function LayoutBrbBasicPage() {
  return (
    <PreviewStub
      templateKey="layout_brb_basic"
      schema={layoutBrbBasicSchema}
      position="fullscreen"
      render={(p) => <BrbBasic message={p.message} />}
    />
  );
}

function BrbBasic({ message }: { message?: string }) {
  const crawlMessage = message?.trim() || null;

  return (
    <div className="brb-root">
      <style jsx>{`
        .brb-root {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
          color: #ffffff;
          font-family: var(--font-broadcast-accent), "Quedora", sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        /* ---------- ATMOSPHERIC BACKGROUND ---------- */
        .bg-base {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            ellipse 70% 60% at 50% 50%,
            #0b1a03 0%,
            #030502 72%,
            #000 100%
          );
        }
        .bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(107, 205, 6, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(107, 205, 6, 0.035) 1px, transparent 1px);
          background-size: 120px 120px;
          -webkit-mask-image: radial-gradient(
            ellipse 85% 75% at 50% 50%,
            black 20%,
            transparent 100%
          );
          mask-image: radial-gradient(
            ellipse 85% 75% at 50% 50%,
            black 20%,
            transparent 100%
          );
        }
        .bg-diagonal {
          position: absolute;
          inset: -10%;
          background-image: repeating-linear-gradient(
            -22deg,
            transparent 0,
            transparent 40px,
            rgba(107, 205, 6, 0.02) 40px,
            rgba(107, 205, 6, 0.02) 41px
          );
          animation: brb-drift 45s linear infinite;
        }
        .bg-glow-green {
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
          animation: brb-breathe 6s ease-in-out infinite;
        }
        .bg-glow-pink {
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
          animation: brb-breathe 8s ease-in-out infinite reverse;
        }
        .scanline {
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
          animation: brb-scan 9s linear infinite;
          animation-delay: 3s;
        }

        /* ---------- TACTICAL HUD CORNERS ---------- */
        .corner {
          position: absolute;
          width: 100px;
          height: 100px;
          border: 3px solid #6bcd06;
          filter: drop-shadow(0 0 10px #6bcd06);
          opacity: 0;
          animation: brb-corner-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.3s forwards;
        }
        .corner.tl {
          top: 50px;
          left: 50px;
          border-right: none;
          border-bottom: none;
        }
        .corner.tr {
          top: 50px;
          right: 50px;
          border-left: none;
          border-bottom: none;
          animation-delay: 0.4s;
        }
        .corner.bl {
          bottom: 50px;
          left: 50px;
          border-right: none;
          border-top: none;
          animation-delay: 0.5s;
        }
        .corner.br {
          bottom: 50px;
          right: 50px;
          border-left: none;
          border-top: none;
          animation-delay: 0.6s;
        }
        .corner::before {
          content: "";
          position: absolute;
          width: 8px;
          height: 8px;
          background: #fe036d;
          box-shadow: 0 0 12px #fe036d;
          animation: brb-pulse 1.5s ease-in-out infinite;
        }
        .corner.tl::before {
          top: -6px;
          left: -6px;
        }
        .corner.tr::before {
          top: -6px;
          right: -6px;
        }
        .corner.bl::before {
          bottom: -6px;
          left: -6px;
        }
        .corner.br::before {
          bottom: -6px;
          right: -6px;
        }

        .tick-mark {
          position: absolute;
          font-family: var(--font-broadcast-accent), "Quedora", sans-serif;
          font-weight: 500;
          font-size: 10px;
          letter-spacing: 2px;
          color: #6bcd06;
          opacity: 0.5;
          text-transform: uppercase;
        }

        /* ---------- TOP BAR ---------- */
        .top-bar {
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
          animation: brb-slide-down 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s
            forwards;
        }
        .cade-mark :global(img) {
          height: 76px;
          filter: drop-shadow(0 0 14px rgba(254, 3, 109, 0.45));
        }
        .hud-meta {
          font-family: var(--font-broadcast-accent), "Quedora", sans-serif;
          font-weight: 500;
          font-size: 13px;
          letter-spacing: 4px;
          color: #6bcd06;
          text-transform: uppercase;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .hud-meta .dot {
          width: 10px;
          height: 10px;
          background: #fe036d;
          box-shadow: 0 0 10px #fe036d;
          animation: brb-pulse 1.5s ease-in-out infinite;
        }
        .hud-meta .tick {
          width: 60px;
          height: 2px;
          background: linear-gradient(90deg, transparent, #6bcd06);
        }

        /* ---------- BOTTOM BAR ---------- */
        .bottom-bar {
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
          animation: brb-slide-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards;
        }
        .bb-header {
          display: flex;
          align-items: center;
          gap: 18px;
        }
        .bb-header .chev {
          color: #fe036d;
          font-size: 10px;
        }
        .bb-header .lbl {
          font-family: var(--font-broadcast-accent), "Quedora", sans-serif;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 5px;
          color: #6bcd06;
          text-transform: uppercase;
        }
        .bb-header .line {
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, #6bcd06, transparent 60%);
        }
        .partners {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 80px;
          height: 64px;
        }
        .partners .pitem {
          display: flex;
          align-items: center;
          height: 56px;
        }
        .partners :global(img) {
          max-height: 56px;
          max-width: 200px;
          object-fit: contain;
          opacity: 0.92;
        }
        .partner-divider {
          width: 1px;
          height: 38px;
          background: rgba(107, 205, 6, 0.35);
        }

        /* ---------- CENTER STAGE ---------- */
        .center-stage {
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
        .shield-wrap {
          opacity: 0;
          animation:
            brb-shield-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.6s forwards,
            brb-shield-float 5s ease-in-out 1.5s infinite;
        }
        .shield-wrap :global(img) {
          width: 230px;
          height: auto;
          display: block;
          filter: drop-shadow(0 0 30px rgba(254, 3, 109, 0.55));
        }
        .kicker {
          font-family: var(--font-broadcast-accent), "Quedora", sans-serif;
          font-weight: 700;
          font-size: 19px;
          letter-spacing: 12px;
          color: #6bcd06;
          margin: 22px 0 10px;
          text-transform: uppercase;
          opacity: 0;
          animation: brb-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1s
            forwards;
        }
        .kicker::before,
        .kicker::after {
          content: "—";
          color: #fe036d;
          margin: 0 14px;
        }
        .hero {
          font-family: var(--font-broadcast-display), "Agharti", sans-serif;
          text-transform: uppercase;
          line-height: 0.88;
          letter-spacing: -3px;
          opacity: 0;
          display: block;
        }
        .hero-small {
          font-weight: 400;
          font-size: 56px;
          color: #6bcd06;
          letter-spacing: 14px;
          margin-bottom: 6px;
          animation: brb-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.1s
            forwards;
        }
        .hero-big {
          font-weight: 900;
          font-size: 200px;
          color: #ffffff;
          text-shadow:
            0 0 50px rgba(107, 205, 6, 0.35),
            3px 3px 0 rgba(254, 3, 109, 0.5);
          animation:
            brb-fade-in-up 0.75s cubic-bezier(0.16, 1, 0.3, 1) 1.2s forwards,
            brb-hero-breathe 4s ease-in-out 2.2s infinite;
        }
        .hero-sub {
          font-weight: 700;
          font-size: 54px;
          color: #fe036d;
          letter-spacing: 10px;
          margin-top: 14px;
          text-shadow: 0 0 20px rgba(254, 3, 109, 0.4);
          animation: brb-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.4s
            forwards;
        }
        .status-row {
          display: flex;
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
          animation: brb-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.6s
            forwards;
        }
        .status-dot {
          width: 12px;
          height: 12px;
          background: #fe036d;
          box-shadow: 0 0 16px #fe036d;
          animation: brb-pulse 1.2s ease-in-out infinite;
        }
        .status-txt {
          font-family: var(--font-broadcast-accent), "Quedora", sans-serif;
          font-weight: 500;
          font-size: 14px;
          letter-spacing: 5px;
          color: #e8f0dc;
          text-transform: uppercase;
        }

        /* ---------- OPTIONAL MESSAGE CRAWL ---------- */
        .crawl {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 175px;
          height: 36px;
          overflow: hidden;
          pointer-events: none;
          opacity: 0;
          animation: brb-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.8s
            forwards;
        }
        .crawl-track {
          display: inline-block;
          white-space: nowrap;
          padding-left: 100%;
          font-family: var(--font-broadcast-accent), "Quedora", sans-serif;
          font-weight: 500;
          font-size: 18px;
          letter-spacing: 6px;
          color: #e8f0dc;
          text-transform: uppercase;
          animation: brb-crawl 28s linear infinite;
        }
        .crawl-track .sep {
          color: #fe036d;
          margin: 0 28px;
        }

        /* ---------- 11 KEYFRAMES (port from reference HTML) ---------- */
        @keyframes brb-drift {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-120px);
          }
        }
        @keyframes brb-breathe {
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
        @keyframes brb-scan {
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
        @keyframes brb-pulse {
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
        @keyframes brb-corner-in {
          from {
            opacity: 0;
            transform: scale(0.6);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes brb-slide-down {
          from {
            transform: translateY(-100%);
          }
          to {
            transform: translateY(0);
          }
        }
        @keyframes brb-slide-up {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        @keyframes brb-fade-in-up {
          from {
            opacity: 0;
            transform: translateY(28px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes brb-shield-in {
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
        @keyframes brb-shield-float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        @keyframes brb-hero-breathe {
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
        @keyframes brb-crawl {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-100%);
          }
        }
      `}</style>

      {/* atmospheric background */}
      <div className="bg-base" />
      <div className="bg-diagonal" />
      <div className="bg-grid" />
      <div className="bg-glow-green" />
      <div className="bg-glow-pink" />
      <div className="scanline" />

      {/* tactical HUD corners */}
      <div className="corner tl" />
      <div className="corner tr" />
      <div className="corner bl" />
      <div className="corner br" />

      {/* tick marks */}
      <div className="tick-mark" style={{ top: 175, left: 60 }}>
        N · 06.5244
      </div>
      <div className="tick-mark" style={{ top: 175, right: 60 }}>
        E · 03.3792
      </div>
      <div className="tick-mark" style={{ bottom: 215, left: 60 }}>
        SEQ / 0023
      </div>
      <div className="tick-mark" style={{ bottom: 215, right: 60 }}>
        CH / 01
      </div>

      {/* top bar */}
      <header className="top-bar">
        <div className="cade-mark">
          <Image
            src="/brand/logos/primary/cade.png"
            alt="CADE esports"
            width={240}
            height={76}
            priority
          />
        </div>
        <div className="hud-meta">
          <div className="tick" />
          <span className="dot" />
          <span>INTERMISSION · STAY TUNED</span>
        </div>
      </header>

      {/* center stage */}
      <main className="center-stage">
        <div className="shield-wrap">
          <Image
            src="/brand/logos/primary/pro-league.png"
            alt="Pro League"
            width={230}
            height={230}
            priority
          />
        </div>
        <div className="kicker">NATIONAL E-SOCCER PRO LEAGUE</div>
        <span className="hero hero-small">STREAM WILL</span>
        <span className="hero hero-big">BE RIGHT</span>
        <span className="hero hero-sub">BACK SHORTLY</span>
        <div className="status-row">
          <span className="status-dot" />
          <span className="status-txt">
            {crawlMessage ?? "BROADCAST PAUSED · RESUMING SOON"}
          </span>
        </div>
      </main>

      {/* optional producer-supplied message crawl */}
      {crawlMessage ? (
        <div className="crawl" aria-hidden="true">
          <div className="crawl-track">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i}>
                {crawlMessage}
                <span className="sep">◆</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* bottom bar */}
      <footer className="bottom-bar">
        <div className="bb-header">
          <span className="chev">◣</span>
          <span className="lbl">OFFICIAL PARTNERS</span>
          <span className="line" />
        </div>
        <div className="partners">
          <div className="pitem">
            <Image
              src="/brand/logos/primary/gameevo-white.png"
              alt="GameEvo"
              width={180}
              height={56}
            />
          </div>
          <span className="partner-divider" />
          <div className="pitem">
            <Image
              src="/brand/logos/partners/esports-africa-news-white.png"
              alt="Esports Africa News"
              width={180}
              height={56}
            />
          </div>
          <span className="partner-divider" />
          <div className="pitem">
            <Image
              src="/brand/logos/partners/gamepride.png"
              alt="Gamepride"
              width={180}
              height={56}
            />
          </div>
          <span className="partner-divider" />
          <div className="pitem">
            <Image
              src="/brand/logos/partners/trace-tv.png"
              alt="Trace TV"
              width={180}
              height={56}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
