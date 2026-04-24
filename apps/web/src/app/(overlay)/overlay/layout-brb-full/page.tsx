"use client";

// TODO Plan 48 phase 2 — design parity
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PreviewStub } from "../PreviewStub";
import { layoutBrbFullSchema } from "@/server/overlays/schemas";
import { ENTER } from "@/lib/motion";
import { useOverlaySound, type OverlaySoundSlot } from "@/lib/overlay-sound";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

/**
 * Plan 16 Wave A — `layout_brb_full` motion port of
 * `KNOWLEDGE/brand-assets/elements/08_brb_ad_timer.html`.
 *
 * Visual breakdown:
 *   - Ambient stage: radial ink + diagonal drift + grid overlay + noise
 *   - Top-bar slide-down with pulsing dot
 *   - Four corner brackets (cornerIn stagger)
 *   - Page-head "BROADCAST PAUSED / BE RIGHT BACK"
 *   - Left column: countdown ring + digital time ticker (MM:SS)
 *   - Right column: 16:9 ad video surface (autoplay muted loop playsinline)
 *   - Bottom-bar: shield + league name + partner logos
 *   - Infinite CSS marquee ticker below the video showing social handles
 *   - Optional tick-1s sound on final 10 seconds (soundSlot payload)
 *
 * Video compliance: `<video>` carries `muted`, `playsinline`, `autoplay`,
 * `loop` + `preload="auto"` so Chrome / OBS browser source both satisfy
 * autoplay policy.
 */

export const dynamic = "force-dynamic";

export default function LayoutBrbFullPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="layout_brb_full"
        schema={layoutBrbFullSchema}
        position="center"
        render={(p, ctx) => (
          <BrbFullInner
            resumeAt={p.resumeAt}
            adVideoUrl={p.adVideoUrl}
            socials={p.socials}
            message={p.message}
            soundSlot={(p.soundSlot ?? null) as OverlaySoundSlot}
            cycle={ctx.cycle}
          />
        )}
      />
    </OverlayFrame>
  );
}

type SocialsShape = {
  twitter?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
};

function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const s = Math.floor(clamped / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function BrbFullInner({
  resumeAt,
  adVideoUrl,
  socials,
  message,
  soundSlot,
  cycle,
}: {
  resumeAt: string | undefined;
  adVideoUrl: string | undefined;
  socials: SocialsShape | undefined;
  message: string | undefined;
  soundSlot: OverlaySoundSlot;
  cycle: number;
}) {
  // Client tick at 4 Hz — cheap + smooth enough for a MM:SS display.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const targetMs = useMemo(() => {
    if (!resumeAt) return null;
    const t = new Date(resumeAt).getTime();
    return Number.isFinite(t) ? t : null;
  }, [resumeAt]);

  const remainingMs = targetMs == null ? 300_000 : targetMs - now;
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const expired = targetMs != null && remainingMs <= 0;
  const urgent = !expired && remainingSec <= 10;

  // Optional last-10-seconds tick audio. Trigger changes every second so
  // the hook replays the tick wav on each integer-second transition.
  const tickTrigger = urgent ? `tick-${remainingSec}-${cycle}` : null;
  useOverlaySound(
    soundSlot === "tick-1s" ? "tick-1s" : null,
    tickTrigger,
  );

  // Socials handles → marquee payload. Marquee is infinite CSS, so we
  // repeat the list twice so the tail always follows the head.
  const socialItems = useMemo(() => {
    const raw: Array<{ icon: string; handle: string }> = [];
    if (socials?.twitter) raw.push({ icon: "X", handle: `@${socials.twitter.replace(/^@/, "")}` });
    if (socials?.instagram) raw.push({ icon: "IG", handle: `@${socials.instagram.replace(/^@/, "")}` });
    if (socials?.tiktok) raw.push({ icon: "TT", handle: `@${socials.tiktok.replace(/^@/, "")}` });
    if (socials?.youtube) raw.push({ icon: "YT", handle: socials.youtube.replace(/^@/, "") });
    if (raw.length === 0) {
      raw.push(
        { icon: "IG", handle: "@cade.esports" },
        { icon: "X", handle: "@cadeesports" },
        { icon: "TT", handle: "@cade.esports" },
        { icon: "YT", handle: "CADE Esports" },
      );
    }
    return raw;
  }, [socials]);

  // Countdown ring geometry.
  const RING_SIZE = 260;
  const STROKE = 14;
  const radius = (RING_SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  // Infer the total duration from the initial remaining window seen on
  // mount so the ring sweeps 360° across the full operator-chosen span.
  // Capture once per `resumeAt` identity (re-captures when a new payload
  // arrives); clamp to [1 min, 60 min] so malformed inputs don't explode.
  const totalMs = useMemo(() => {
    if (targetMs == null) return 300_000;
    const initial = Math.max(0, targetMs - Date.now());
    const rounded = Math.ceil(initial / 60_000) * 60_000;
    return Math.max(60_000, Math.min(60 * 60_000, rounded || 60_000));
  }, [targetMs]);
  const progress = expired ? 0 : Math.max(0, Math.min(1, remainingMs / totalMs));
  const dashOffset = circumference * (1 - progress);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        color: "#ffffff",
        fontFamily: "Quedora, sans-serif",
        fontVariantNumeric: "tabular-nums",
        background: "transparent",
      }}
      data-testid="overlay-root"
    >
      {/* Ambient stage */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 70% at 50% 50%, #0b1a03 0%, #030502 72%, #000 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-10%",
          backgroundImage:
            "repeating-linear-gradient(-22deg, transparent 0, transparent 40px, rgba(107,205,6,0.02) 40px, rgba(107,205,6,0.02) 41px)",
          animation: "brbDrift 45s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(107,205,6,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(107,205,6,0.035) 1px, transparent 1px)",
          backgroundSize: "120px 120px",
        }}
      />
      {/* Ambient glow — breathes primary/secondary */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(700px 520px at 22% 40%, rgba(107,205,6,0.22), transparent 62%), radial-gradient(600px 460px at 78% 62%, rgba(254,3,109,0.18), transparent 65%)",
          mixBlendMode: "screen",
          animation: "brbGlowBreathe 6s ease-in-out infinite",
        }}
      />

      {/* Corner brackets */}
      <CornerBracket pos="tl" delay={0.3} />
      <CornerBracket pos="tr" delay={0.4} />
      <CornerBracket pos="bl" delay={0.5} />
      <CornerBracket pos="br" delay={0.6} />

      {/* Top bar */}
      <motion.header
        initial={{ y: -120, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...ENTER, delay: 0.1, duration: 0.7 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 110,
          padding: "0 60px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img
            src="/brand/logos/primary/cade.png"
            alt="CADE"
            style={{
              height: 72,
              filter: "drop-shadow(0 0 14px rgba(254, 3, 109, 0.45))",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 4,
            color: "#6bcd06",
            textTransform: "uppercase",
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
          <span
            style={{
              width: 10,
              height: 10,
              background: "#fe036d",
              boxShadow: "0 0 10px #fe036d",
              animation: "brbPulse 1.5s ease-in-out infinite",
            }}
          />
          <span>{message ?? "INTERMISSION · STAY TUNED"}</span>
        </div>
      </motion.header>

      {/* Page head */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER, delay: 0.5, duration: 0.6 }}
        style={{
          position: "absolute",
          top: 130,
          left: 0,
          right: 0,
          textAlign: "center",
          padding: "20px 0",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 10,
            color: "#6bcd06",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          <span style={{ color: "#fe036d" }}>&mdash;</span>
          <span>BROADCAST PAUSED</span>
          <span style={{ color: "#fe036d" }}>&mdash;</span>
        </div>
        <h1
          style={{
            fontFamily: "AghartiWide, Agharti, sans-serif",
            fontWeight: 900,
            fontSize: 78,
            lineHeight: 0.95,
            letterSpacing: 2,
            textTransform: "uppercase",
            textShadow:
              "0 0 40px rgba(107, 205, 6, 0.25), 2px 2px 0 rgba(254, 3, 109, 0.35)",
            margin: 0,
          }}
        >
          BE RIGHT BACK
        </h1>
        <div
          style={{
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: 8,
            color: "#e8f0dc",
            textTransform: "uppercase",
            marginTop: 4,
          }}
        >
          BROADCAST WILL RESUME SHORTLY
        </div>
      </motion.div>

      {/* Left column: countdown ring + digital */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...ENTER, delay: 0.7, duration: 0.7 }}
        style={{
          position: "absolute",
          top: 300,
          left: 60,
          width: 560,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 7,
            color: "#fe036d",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              width: 11,
              height: 11,
              background: "#fe036d",
              boxShadow: "0 0 12px #fe036d",
              animation: "brbPulse 1.2s ease-in-out infinite",
            }}
          />
          <span>RESUMING IN</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
          }}
        >
          {/* Ring */}
          <div
            style={{
              position: "relative",
              width: RING_SIZE,
              height: RING_SIZE,
              flexShrink: 0,
              filter: "drop-shadow(0 0 18px rgba(107,205,6,0.35))",
            }}
          >
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              style={{ transform: "rotate(-90deg)" }}
            >
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={radius}
                stroke="rgba(107,205,6,0.12)"
                strokeWidth={STROKE}
                fill="none"
              />
              <motion.circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={radius}
                stroke={expired || urgent ? "#fe036d" : "#6bcd06"}
                strokeWidth={STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circumference}
                animate={{ strokeDashoffset: dashOffset }}
                transition={{ duration: 0.3, ease: "linear" }}
                style={{
                  filter: `drop-shadow(0 0 10px ${expired || urgent ? "#fe036d" : "#6bcd06"})`,
                }}
              />
            </svg>
            {/* Pulsing shield at ring center */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "brbShieldPulse 2.4s ease-in-out infinite",
              }}
            >
              <img
                src="/brand/logos/primary/pro-league.png"
                alt=""
                aria-hidden
                style={{
                  width: 110,
                  height: 110,
                  objectFit: "contain",
                  filter:
                    "drop-shadow(0 0 14px rgba(254,3,109,0.5))",
                }}
              />
            </div>
          </div>

          {/* Digital MM:SS */}
          <div
            className="tabular"
            style={{
              fontFamily: "AghartiWide, Agharti, sans-serif",
              fontWeight: 900,
              fontSize: 140,
              lineHeight: 0.88,
              letterSpacing: -2,
              color: expired ? "#fe036d" : "#ffffff",
              textShadow:
                "0 0 50px rgba(107, 205, 6, 0.3), 3px 3px 0 rgba(254, 3, 109, 0.4)",
              fontVariantNumeric: "tabular-nums",
              animation: expired ? "brbPulse 0.6s ease-in-out infinite" : "none",
            }}
          >
            {formatClock(remainingMs)}
          </div>
        </div>
      </motion.div>

      {/* Right column: ad video surface with fade rotation frame */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...ENTER, delay: 1.0, duration: 0.6 }}
        style={{
          position: "absolute",
          top: 260,
          left: 700,
          width: 1120,
          height: 630,
          zIndex: 3,
        }}
      >
        {/* Frame border */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "2px solid #6bcd06",
            boxShadow: "0 0 24px rgba(107, 205, 6, 0.35)",
            pointerEvents: "none",
          }}
        />
        {/* Pink corner clips */}
        <AdCorner pos="tl" />
        <AdCorner pos="tr" />
        <AdCorner pos="bl" />
        <AdCorner pos="br" />
        {/* LIVE pill */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 12px 5px 8px",
            background: "#fe036d",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 3,
            color: "#ffffff",
            textTransform: "uppercase",
            clipPath:
              "polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)",
            zIndex: 4,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              background: "#ffffff",
              borderRadius: "50%",
              animation: "brbPulse 1.2s ease-in-out infinite",
            }}
          />
          <span>LIVE AD</span>
        </div>

        {/* Video surface — fade rotation via key swap on adVideoUrl */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            background: "#000000",
          }}
        >
          {adVideoUrl ? (
            <motion.video
              key={adVideoUrl}
              src={adVideoUrl}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                color: "#6bcd06",
                textTransform: "uppercase",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: 7,
                  opacity: 0.55,
                }}
              >
                LIVE · 16:9 VIDEO SLOT
              </div>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 10,
                  letterSpacing: 3,
                  color: "#5a6853",
                  opacity: 0.5,
                }}
              >
                place video behind this overlay
              </div>
            </div>
          )}
        </div>

        {/* Socials marquee under the ad surface */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -54,
            height: 40,
            overflow: "hidden",
            background: "rgba(5,8,5,0.9)",
            border: "1px solid rgba(107,205,6,0.25)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              whiteSpace: "nowrap",
              gap: 48,
              paddingLeft: 24,
              animation: "brbMarquee 28s linear infinite",
            }}
          >
            {[...socialItems, ...socialItems, ...socialItems].map((s, i) => (
              <span
                key={`${s.handle}-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 14,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                  color: "#e8f0dc",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    background: "#fe036d",
                    color: "#ffffff",
                    fontWeight: 900,
                    fontSize: 11,
                    letterSpacing: 1,
                    clipPath:
                      "polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)",
                  }}
                >
                  {s.icon}
                </span>
                <span style={{ fontWeight: 600 }}>{s.handle}</span>
              </span>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Bottom bar */}
      <motion.footer
        initial={{ y: 120, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...ENTER, delay: 0.2, duration: 0.7 }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 110,
          padding: "0 50px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 30,
          background:
            "linear-gradient(180deg, transparent 0%, rgba(5, 8, 5, 0.92) 100%)",
          borderTop: "1px solid rgba(107, 205, 6, 0.3)",
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <img
            src="/brand/logos/partners/gameevo-white.png"
            alt="GameEvo"
            style={{
              height: 78,
              filter: "drop-shadow(0 0 14px rgba(254, 3, 109, 0.5))",
            }}
          />
          <div
            style={{
              fontFamily: "AghartiWide, Agharti, sans-serif",
              fontWeight: 900,
              fontSize: 20,
              letterSpacing: 4,
              textTransform: "uppercase",
              lineHeight: 1.05,
            }}
          >
            NATIONAL E-SOCCER PRO LEAGUE
            <small
              style={{
                display: "block",
                fontWeight: 400,
                fontSize: 10,
                letterSpacing: 6,
                color: "#6bcd06",
                marginTop: 4,
              }}
            >
              DIVISION 2 · SEASON 2025/26
            </small>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            padding: "0 26px",
            borderLeft: "1px solid rgba(107, 205, 6, 0.2)",
            borderRight: "1px solid rgba(107, 205, 6, 0.2)",
            height: "70%",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontWeight: 700,
              fontSize: 9,
              letterSpacing: 3,
              color: "#6bcd06",
              textTransform: "uppercase",
              textAlign: "right",
              lineHeight: 1.3,
            }}
          >
            <span>OFFICIAL</span>
            <span style={{ color: "#5a6853", letterSpacing: 2, fontSize: 8 }}>
              PARTNERS
            </span>
          </div>
          <img
            src="/brand/logos/partners/esports-africa-news-white.png"
            alt=""
            aria-hidden
            style={{ height: 42, maxWidth: 120, objectFit: "contain", opacity: 0.95 }}
          />
          <img
            src="/brand/logos/partners/gamepride.png"
            alt=""
            aria-hidden
            style={{ height: 42, maxWidth: 120, objectFit: "contain", opacity: 0.95 }}
          />
          <img
            src="/brand/logos/partners/trace-tv.png"
            alt=""
            aria-hidden
            style={{ height: 42, maxWidth: 120, objectFit: "contain", opacity: 0.95 }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontWeight: 500,
            fontSize: 11,
            letterSpacing: 4,
            color: "#5a6853",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          <span>CADE ESPORTS</span>
          <span style={{ color: "#fe036d" }}>{"◣"}</span>
          <span>LIVE · OFFICIAL</span>
        </div>
      </motion.footer>

      {/* Keyframes */}
      <style>{`
        @keyframes brbDrift {
          from { transform: translateX(0); }
          to { transform: translateX(-120px); }
        }
        @keyframes brbPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.7); }
        }
        @keyframes brbGlowBreathe {
          0%, 100% { opacity: 0.75; }
          50% { opacity: 1; }
        }
        @keyframes brbShieldPulse {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 14px rgba(254,3,109,0.45)); }
          50% { transform: scale(1.06); filter: drop-shadow(0 0 22px rgba(254,3,109,0.75)); }
        }
        @keyframes brbMarquee {
          from { transform: translateX(0); }
          to { transform: translateX(-33.333%); }
        }
        @keyframes brbCornerIn {
          from { opacity: 0; transform: scale(0.6); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function CornerBracket({
  pos,
  delay,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  delay: number;
}) {
  const base: React.CSSProperties = {
    position: "absolute",
    width: 70,
    height: 70,
    border: "2px solid #6bcd06",
    filter: "drop-shadow(0 0 8px #6bcd06)",
    opacity: 0,
    animation: `brbCornerIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s forwards`,
  };
  const posStyle: React.CSSProperties =
    pos === "tl"
      ? { top: 130, left: 32, borderRight: "none", borderBottom: "none" }
      : pos === "tr"
      ? { top: 130, right: 32, borderLeft: "none", borderBottom: "none" }
      : pos === "bl"
      ? { bottom: 130, left: 32, borderRight: "none", borderTop: "none" }
      : { bottom: 130, right: 32, borderLeft: "none", borderTop: "none" };
  return <div style={{ ...base, ...posStyle }} />;
}

function AdCorner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base: React.CSSProperties = {
    position: "absolute",
    width: 28,
    height: 28,
    border: "3px solid #fe036d",
    filter: "drop-shadow(0 0 6px #fe036d)",
    zIndex: 5,
  };
  const pos2: React.CSSProperties =
    pos === "tl"
      ? { top: -2, left: -2, borderRight: "none", borderBottom: "none" }
      : pos === "tr"
      ? { top: -2, right: -2, borderLeft: "none", borderBottom: "none" }
      : pos === "bl"
      ? { bottom: -2, left: -2, borderRight: "none", borderTop: "none" }
      : { bottom: -2, right: -2, borderLeft: "none", borderTop: "none" };
  return <div style={{ ...base, ...pos2 }} />;
}
