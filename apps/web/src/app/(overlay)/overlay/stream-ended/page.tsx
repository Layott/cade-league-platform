"use client";

// TODO Plan 48 phase 2 — design parity
import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import {
  streamEndedSchema,
  type StreamEndedPayload,
} from "@/server/overlays/schemas";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

/**
 * Plan 16 Wave A — motion port of
 * `KNOWLEDGE/brand-assets/elements/03_stream_ended.html`.
 *
 * Outro surface — 16 @keyframes preserved:
 *
 *   CSS ambient loops (infinite):
 *     1. `drift`        — diagonal grid drift (45s linear)
 *     2. `breathe`      — green/pink radial glow breathe (6s / 8s reverse)
 *     3. `scan`         — horizontal scanline travels top→bottom (9s)
 *     4. `pulse`        — corner + HUD dots (1.2s–1.5s mirror)
 *     5. `shieldFloat`  — shield Y-float idle (5s)
 *     6. `heroBreathe`  — "WATCHING" text-shadow breathe (4s)
 *     7. `socials-crawl`— new marquee loop for the socials row
 *
 *   framer-motion hero reveal (once, on mount / cycle):
 *     8.  `cornerIn`   — four HUD corners scale-in staggered (0.3–0.6s)
 *     9.  `slideDown`  — top bar slides in from above
 *    10.  `slideUp`    — bottom bar slides in from below
 *    11.  `shieldIn`   — shield iris-in (scale 0.5→1.08→1 with blur→0)
 *    12.  `fadeInUp`   — kicker fade-up (@1.0s)
 *    13.  `fadeInUp`   — hero-small "THANK YOU FOR" (@1.1s)
 *    14.  `fadeInUp`   — hero-big "WATCHING" (@1.2s)  ← slow fade
 *    15.  `fadeInUp`   — hero-sub "THANKS FOR WATCHING" pink (@1.4s)
 *    16.  `fadeInUp`   — socials crawl container (@1.6s)
 *
 * Sound: none per spec (outro is silent).
 */
export default function StreamEndedPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="stream_ended"
        schema={streamEndedSchema}
        position="fullscreen"
        render={(p, { cycle }) => <StreamEndedScene payload={p} cycle={cycle} />}
      />
    </OverlayFrame>
  );
}

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

function StreamEndedScene({
  payload,
  cycle,
}: {
  payload: StreamEndedPayload;
  cycle: number | string;
}) {
  const socials = payload.socials ?? {};
  const subtitle = payload.subtitle ?? "THANKS FOR WATCHING";

  // Build a crawl list of non-empty social handles. If nothing provided,
  // leave an empty string array — the crawl row just won't render.
  const socialItems: { icon: string; handle: string }[] = [];
  if (socials.twitter) socialItems.push({ icon: "X", handle: socials.twitter });
  if (socials.instagram)
    socialItems.push({ icon: "IG", handle: socials.instagram });
  if (socials.tiktok) socialItems.push({ icon: "TT", handle: socials.tiktok });
  if (socials.youtube)
    socialItems.push({ icon: "YT", handle: socials.youtube });
  // Duplicate once so the marquee wraps seamlessly.
  const crawl = socialItems.length > 0 ? [...socialItems, ...socialItems] : [];

  return (
    <motion.div
      key={cycle}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Quedora, sans-serif",
        color: "#ffffff",
        background:
          "radial-gradient(ellipse 70% 60% at 50% 50%, #0b1a03 0%, #030502 72%, #000 100%)",
      }}
    >
      {/* Ambient CSS-driven loops — grid / glows / scanline. Keeping them as
          plain <style> + class DOM so the infinite loops run untouched by
          AnimatePresence remounts on cycle change. */}
      <style>{ambientCss}</style>

      <div className="se-bg-diagonal" />
      <div className="se-bg-grid" />
      <div className="se-bg-glow-green" />
      <div className="se-bg-glow-pink" />
      <div className="se-scanline" />

      {/* Tactical HUD corners — staggered cornerIn */}
      {(["tl", "tr", "bl", "br"] as const).map((pos, i) => (
        <motion.div
          key={pos}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3 + i * 0.1, ease: EASE_OUT }}
          className={`se-corner se-corner-${pos}`}
        />
      ))}

      {/* Top bar — slideDown */}
      <motion.header
        initial={{ y: "-100%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 0.7, delay: 0.1, ease: EASE_OUT }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 130,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 210px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logos/primary/cade.png"
            alt="CADE"
            style={{
              height: 76,
              filter: "drop-shadow(0 0 14px rgba(254, 3, 109, 0.45))",
            }}
          />
        </div>
        <div
          style={{
            fontWeight: 500,
            fontSize: 13,
            letterSpacing: 4,
            color: "#6bcd06",
            textTransform: "uppercase",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span
            style={{
              width: 60,
              height: 2,
              background:
                "linear-gradient(90deg, transparent, #6bcd06)",
            }}
          />
          <span className="se-pulse-dot" />
          <span>BROADCAST CONCLUDED &middot; OFF AIR</span>
        </div>
      </motion.header>

      {/* Tick marks — static decorative labels */}
      {[
        { style: { top: 175, left: 60 }, text: "N · 06.5244" },
        { style: { top: 175, right: 60 }, text: "E · 03.3792" },
        { style: { bottom: 215, left: 60 }, text: "SEQ / 0023" },
        { style: { bottom: 215, right: 60 }, text: "CH / 01" },
      ].map((t, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: 2,
            color: "#6bcd06",
            opacity: 0.5,
            textTransform: "uppercase",
            ...t.style,
          }}
        >
          {t.text}
        </div>
      ))}

      {/* Center stage — shield + kicker + hero + sub + socials */}
      <main
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          width: 1500,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
        }}
      >
        {/* Shield — iris-in with blur→0 then infinite float */}
        <motion.div
          initial={{
            opacity: 0,
            scale: 0.5,
            filter:
              "drop-shadow(0 0 60px rgba(107, 205, 6, 0.9)) blur(20px)",
          }}
          animate={{
            opacity: [0, 1, 1],
            scale: [0.5, 1.08, 1],
            filter: [
              "drop-shadow(0 0 60px rgba(107, 205, 6, 0.9)) blur(20px)",
              "drop-shadow(0 0 40px rgba(107, 205, 6, 0.6)) blur(0px)",
              "drop-shadow(0 0 30px rgba(254, 3, 109, 0.55)) blur(0px)",
            ],
          }}
          transition={{
            duration: 0.9,
            delay: 0.6,
            times: [0, 0.6, 1],
            ease: EASE_OUT,
          }}
          className="se-shield-float"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logos/primary/cade.png"
            alt="CADE Esports"
            style={{ width: 230, height: "auto", display: "block" }}
          />
        </motion.div>

        {/* Kicker */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.0, ease: EASE_OUT }}
          style={{
            fontWeight: 700,
            fontSize: 19,
            letterSpacing: 12,
            color: "#6bcd06",
            margin: "22px 0 10px",
            textTransform: "uppercase",
          }}
        >
          <span style={{ color: "#fe036d", margin: "0 14px" }}>&mdash;</span>
          NATIONAL E-SOCCER PRO LEAGUE
          <span style={{ color: "#fe036d", margin: "0 14px" }}>&mdash;</span>
        </motion.div>

        {/* Hero-small */}
        <motion.span
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.1, ease: EASE_OUT }}
          style={{
            fontFamily: "AghartiWide, Agharti, sans-serif",
            fontWeight: 400,
            fontSize: 56,
            color: "#6bcd06",
            letterSpacing: 14,
            marginBottom: 6,
            textTransform: "uppercase",
            lineHeight: 0.88,
            display: "block",
          }}
        >
          THANK YOU FOR
        </motion.span>

        {/* Hero-big "WATCHING" — slow fade (0.75s) + infinite heroBreathe */}
        <motion.span
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 1.2, ease: EASE_OUT }}
          className="se-hero-breathe"
          style={{
            fontFamily: "AghartiWide, Agharti, sans-serif",
            fontWeight: 900,
            fontSize: 200,
            color: "#ffffff",
            letterSpacing: -3,
            textTransform: "uppercase",
            lineHeight: 0.88,
            display: "block",
            textShadow:
              "0 0 50px rgba(107, 205, 6, 0.35), 3px 3px 0 rgba(254, 3, 109, 0.5)",
          }}
        >
          WATCHING
        </motion.span>

        {/* Hero-sub — pink subtitle from payload */}
        <motion.span
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.4, ease: EASE_OUT }}
          style={{
            fontFamily: "AghartiWide, Agharti, sans-serif",
            fontWeight: 700,
            fontSize: 54,
            color: "#fe036d",
            letterSpacing: 10,
            marginTop: 14,
            textShadow: "0 0 20px rgba(254, 3, 109, 0.4)",
            textTransform: "uppercase",
            lineHeight: 0.88,
            display: "block",
          }}
        >
          {subtitle}
        </motion.span>

        {/* Socials crawl — infinite marquee loop */}
        {crawl.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.6, ease: EASE_OUT }}
            style={{
              marginTop: 44,
              width: 900,
              overflow: "hidden",
              maskImage:
                "linear-gradient(90deg, transparent 0, black 10%, black 90%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(90deg, transparent 0, black 10%, black 90%, transparent 100%)",
              padding: "12px 0",
              border: "1px solid rgba(107, 205, 6, 0.35)",
              background: "rgba(107, 205, 6, 0.05)",
              clipPath:
                "polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%)",
            }}
          >
            <div className="se-socials-track">
              {crawl.map((s, i) => (
                <span key={i} className="se-social-item">
                  <span
                    style={{
                      display: "inline-block",
                      width: 28,
                      height: 28,
                      lineHeight: "28px",
                      textAlign: "center",
                      borderRadius: 999,
                      background: "#fe036d",
                      color: "#ffffff",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 1,
                      marginRight: 10,
                    }}
                  >
                    {s.icon}
                  </span>
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                      letterSpacing: 5,
                      color: "#e8f0dc",
                      textTransform: "uppercase",
                    }}
                  >
                    @{s.handle}
                  </span>
                </span>
              ))}
            </div>
          </motion.div>
        ) : null}
      </main>

      {/* Bottom bar — slideUp with partners row */}
      <motion.footer
        initial={{ y: "100%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 0.7, delay: 0.2, ease: EASE_OUT }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 150,
          padding: "0 210px 20px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ color: "#fe036d", fontSize: 10 }}>&#9698;</span>
          <span
            style={{
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: 5,
              color: "#6bcd06",
              textTransform: "uppercase",
            }}
          >
            OFFICIAL PARTNERS
          </span>
          <span
            style={{
              flex: 1,
              height: 1,
              background:
                "linear-gradient(90deg, #6bcd06, transparent 60%)",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 80,
            height: 64,
          }}
        >
          {[
            "/brand/logos/primary/gameevo-white.png",
            "/brand/logos/primary/pro-league.png",
            "/brand/logos/partners/esports-africa-news-white.png",
            "/brand/logos/partners/gamepride.png",
          ].map((src, i) => (
            <span
              key={src}
              style={{ display: "flex", alignItems: "center", gap: 80 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                style={{
                  maxHeight: 56,
                  maxWidth: 200,
                  objectFit: "contain",
                  opacity: 0.92,
                }}
              />
              {i < 3 ? (
                <span
                  style={{
                    width: 1,
                    height: 38,
                    background: "rgba(107, 205, 6, 0.35)",
                  }}
                />
              ) : null}
            </span>
          ))}
        </div>
      </motion.footer>
    </motion.div>
  );
}

/**
 * Ambient CSS — scoped class names prefixed `se-` (stream-ended) to avoid
 * collisions with other overlay pages. Seven infinite loops live here.
 */
const ambientCss = `
.se-bg-diagonal {
  position: absolute;
  inset: -10%;
  background-image: repeating-linear-gradient(
    -22deg, transparent 0, transparent 40px,
    rgba(107, 205, 6, 0.02) 40px, rgba(107, 205, 6, 0.02) 41px
  );
  animation: se-drift 45s linear infinite;
}
.se-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(107, 205, 6, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(107, 205, 6, 0.035) 1px, transparent 1px);
  background-size: 120px 120px;
  mask-image: radial-gradient(ellipse 85% 75% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 85% 75% at 50% 50%, black 20%, transparent 100%);
}
.se-bg-glow-green {
  position: absolute;
  left: 50%; top: 50%;
  width: 1400px; height: 1400px;
  background: radial-gradient(circle, rgba(107, 205, 6, 0.2) 0%, transparent 55%);
  filter: blur(40px);
  transform: translate(-50%, -50%);
  animation: se-breathe 6s ease-in-out infinite;
}
.se-bg-glow-pink {
  position: absolute;
  left: 15%; top: 85%;
  width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(254, 3, 109, 0.14) 0%, transparent 55%);
  filter: blur(60px);
  transform: translate(-50%, -50%);
  animation: se-breathe 8s ease-in-out infinite reverse;
}
.se-scanline {
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(142, 255, 20, 0.5), transparent);
  animation: se-scan 9s linear infinite;
  animation-delay: 3s;
}
.se-corner {
  position: absolute;
  width: 100px; height: 100px;
  border: 3px solid #6bcd06;
  filter: drop-shadow(0 0 10px #6bcd06);
  pointer-events: none;
}
.se-corner-tl { top: 50px; left: 50px; border-right: none; border-bottom: none; }
.se-corner-tr { top: 50px; right: 50px; border-left: none; border-bottom: none; }
.se-corner-bl { bottom: 50px; left: 50px; border-right: none; border-top: none; }
.se-corner-br { bottom: 50px; right: 50px; border-left: none; border-top: none; }
.se-corner::before {
  content: '';
  position: absolute;
  width: 8px; height: 8px;
  background: #fe036d;
  box-shadow: 0 0 12px #fe036d;
  animation: se-pulse 1.5s ease-in-out infinite;
}
.se-corner-tl::before { top: -6px; left: -6px; }
.se-corner-tr::before { top: -6px; right: -6px; }
.se-corner-bl::before { bottom: -6px; left: -6px; }
.se-corner-br::before { bottom: -6px; right: -6px; }
.se-pulse-dot {
  width: 10px; height: 10px;
  background: #fe036d;
  box-shadow: 0 0 10px #fe036d;
  display: inline-block;
  animation: se-pulse 1.5s ease-in-out infinite;
}
.se-shield-float {
  animation: se-shield-float 5s ease-in-out 1.5s infinite;
}
.se-hero-breathe {
  animation: se-hero-breathe 4s ease-in-out 2.2s infinite;
}
.se-socials-track {
  display: inline-flex;
  gap: 80px;
  align-items: center;
  white-space: nowrap;
  animation: se-socials-crawl 18s linear infinite;
  will-change: transform;
}
.se-social-item {
  display: inline-flex;
  align-items: center;
}
@keyframes se-drift {
  from { transform: translateX(0); }
  to   { transform: translateX(-120px); }
}
@keyframes se-breathe {
  0%, 100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
  50%      { opacity: 1;   transform: translate(-50%, -50%) scale(1.08); }
}
@keyframes se-scan {
  0%   { top: -5%;  opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { top: 105%; opacity: 0; }
}
@keyframes se-pulse {
  0%, 100% { opacity: 1;   transform: scale(1); }
  50%      { opacity: 0.3; transform: scale(0.65); }
}
@keyframes se-shield-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-10px); }
}
@keyframes se-hero-breathe {
  0%, 100% {
    opacity: 1;
    text-shadow: 0 0 50px rgba(107, 205, 6, 0.35), 3px 3px 0 rgba(254, 3, 109, 0.5);
  }
  50% {
    opacity: 0.95;
    text-shadow: 0 0 70px rgba(107, 205, 6, 0.55), 3px 3px 0 rgba(254, 3, 109, 0.6);
  }
}
@keyframes se-socials-crawl {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
