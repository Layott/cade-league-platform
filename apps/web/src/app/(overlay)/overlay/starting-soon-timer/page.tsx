"use client";

// TODO Plan 48 phase 2 — design parity
import { motion } from "framer-motion";
import { useEffect, useState, type CSSProperties } from "react";
import Image from "next/image";
import { PreviewStub } from "../PreviewStub";
import { startingSoonTimerSchema } from "@/server/overlays/schemas";
import type { StartingSoonTimerPayload } from "@/server/overlays/schemas";
import { useOverlaySound, type OverlaySoundSlot } from "@/lib/overlay-sound";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

export const dynamic = "force-dynamic";

/**
 * Plan 16 — Wave A polish port of `22_starting_ad_timer.html`.
 *
 * Surfaces a 1920×1080 pre-match countdown frame with a left timer column,
 * a right 16:9 ad slot (video optional — defaults to placeholder art), and
 * a looping bottom marquee of official / partner strap copy. Countdown
 * derives seconds client-side from `startsAt` (ISO string); every wall
 * tick pulses the optional `tick-1s` sound slot.
 *
 * Video tag is `muted + playsinline + autoplay` to satisfy Chrome
 * auto-play policy.
 */

const KEYFRAMES = `
@keyframes ss-drift { from { transform: translateX(0); } to { transform: translateX(-120px); } }
@keyframes ss-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.65); } }
@keyframes ss-corner-in { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
@keyframes ss-slide-down { from { transform: translateY(-100%); } to { transform: translateY(0); } }
@keyframes ss-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes ss-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ss-fade-in-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ss-slide-in-left { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }
@keyframes ss-expired { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.55; transform: scale(0.98); } }
@keyframes ss-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;

function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function StartingSoonTimerPage() {
  return (
    <OverlayFrame>
  <PreviewStub
        templateKey="starting_soon_timer"
        schema={startingSoonTimerSchema}
        position="fullscreen"
        render={(p, { cycle }) => <Inner key={cycle} payload={p} cycle={cycle} />}
      />
    </OverlayFrame>
  );
}

function Inner({ payload, cycle }: { payload: StartingSoonTimerPayload; cycle: number }) {
  const { startsAt, adVideoUrl, soundSlot } = payload;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const startsAtMs = new Date(startsAt).getTime();
  const remainingSec = Math.max(0, Math.floor((startsAtMs - now) / 1000));
  const expired = remainingSec <= 0;
  // Tick identity — re-fires `useOverlaySound` on each whole-second change.
  // Plan 48.4 (2026-04-24) — default to SILENT. Producers were getting a
  // live audible tick every second while the starting-soon timer was
  // up, which competed with caster VO + intro music. Must explicitly opt
  // in via payload `soundSlot: "tick-1s"` to re-enable the tick cue.
  const tickTrigger = `${cycle}-${remainingSec}`;
  const resolvedSlot = (soundSlot ?? null) as OverlaySoundSlot;
  useOverlaySound(resolvedSlot, tickTrigger);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        fontFamily: "'Quedora', var(--font-sans, sans-serif)",
        color: "#ffffff",
        fontVariantNumeric: "tabular-nums",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{KEYFRAMES}</style>

      {/* ---- Background layers (radial + grid + diagonals + noise) ---- */}
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
          animation: "ss-drift 45s linear infinite",
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

      {/* Video cutout behind the ad slot — actual <video> placed as a layer below the overlay frame. */}
      <div
        style={{
          position: "absolute",
          left: 700,
          top: 260,
          width: 1120,
          height: 630,
          background: "#000",
          zIndex: 1,
        }}
      >
        {adVideoUrl ? (
          <video
            src={adVideoUrl}
            autoPlay
            muted
            loop
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <motion.div
            animate={{ opacity: [0.4, 0.75, 0.4] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: "100%",
              height: "100%",
              background:
                "linear-gradient(135deg, rgba(107,205,6,0.08) 0%, rgba(254,3,109,0.08) 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Quedora', sans-serif",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: 7,
              color: "#6bcd06",
              textTransform: "uppercase",
              opacity: 0.55,
            }}
          >
            LIVE · 16:9 VIDEO SLOT
          </motion.div>
        )}
      </div>

      {/* Ad-slot decorative frame + LIVE pill on top of video */}
      <div
        style={{
          position: "absolute",
          left: 700,
          top: 260,
          width: 1120,
          height: 630,
          pointerEvents: "none",
          zIndex: 4,
          animation: "ss-fade-in 0.6s ease-out 1.0s both",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "2px solid #6bcd06",
            boxShadow: "0 0 24px rgba(107,205,6,0.35)",
          }}
        />
        {(["tl", "tr", "bl", "br"] as const).map((pos) => {
          const base: CSSProperties = {
            position: "absolute",
            width: 28,
            height: 28,
            border: "3px solid #fe036d",
            filter: "drop-shadow(0 0 6px #fe036d)",
          };
          const off = {
            tl: { top: -2, left: -2, borderRight: "none", borderBottom: "none" },
            tr: { top: -2, right: -2, borderLeft: "none", borderBottom: "none" },
            bl: { bottom: -2, left: -2, borderRight: "none", borderTop: "none" },
            br: { bottom: -2, right: -2, borderLeft: "none", borderTop: "none" },
          }[pos];
          return <span key={pos} style={{ ...base, ...off }} />;
        })}
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
            fontFamily: "'Quedora', sans-serif",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 3,
            color: "#fff",
            textTransform: "uppercase",
            clipPath: "polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              background: "#fff",
              borderRadius: "50%",
              animation: "ss-pulse 1.2s ease-in-out infinite",
            }}
          />
          LIVE
        </div>
      </div>

      {/* ---- Corner brackets ---- */}
      {(["tl", "tr", "bl", "br"] as const).map((pos, i) => {
        const base: CSSProperties = {
          position: "absolute",
          width: 70,
          height: 70,
          border: "2px solid #6bcd06",
          filter: "drop-shadow(0 0 8px #6bcd06)",
          opacity: 0,
          animation: `ss-corner-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${0.3 + i * 0.1}s forwards`,
          zIndex: 5,
        };
        const off = {
          tl: { top: 130, left: 32, borderRight: "none", borderBottom: "none" },
          tr: { top: 130, right: 32, borderLeft: "none", borderBottom: "none" },
          bl: { bottom: 130, left: 32, borderRight: "none", borderTop: "none" },
          br: { bottom: 130, right: 32, borderLeft: "none", borderTop: "none" },
        }[pos];
        return <div key={pos} style={{ ...base, ...off }} />;
      })}

      {/* ---- Top bar ---- */}
      <header
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 110,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 60px",
          zIndex: 10,
          transform: "translateY(-100%)",
          animation: "ss-slide-down 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards",
        }}
      >
        <Image
          src="/brand/logos/primary/cade.png"
          alt="CADE"
          width={200}
          height={72}
          style={{ height: 72, width: "auto", filter: "drop-shadow(0 0 14px rgba(254,3,109,0.45))" }}
          priority
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: "'Quedora', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 4,
            color: "#6bcd06",
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 60,
              height: 2,
              background: "linear-gradient(90deg, transparent, #6bcd06)",
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              background: "#fe036d",
              boxShadow: "0 0 10px #fe036d",
              animation: "ss-pulse 1.5s ease-in-out infinite",
            }}
          />
          <span>LIVE BROADCAST · STANDBY</span>
        </div>
      </header>

      {/* ---- Page head ---- */}
      <div
        style={{
          position: "absolute",
          top: 130,
          left: 0,
          right: 0,
          textAlign: "center",
          padding: "20px 0",
          opacity: 0,
          animation: "ss-fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards",
          zIndex: 6,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            fontFamily: "'Quedora', sans-serif",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 10,
            color: "#6bcd06",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          <span style={{ color: "#fe036d" }}>—</span>
          PRE-MATCH COUNTDOWN
          <span style={{ color: "#fe036d" }}>—</span>
        </div>
        <h1
          style={{
            fontFamily: "'AghartiWide', 'Quedora', sans-serif",
            fontWeight: 900,
            fontSize: 64,
            lineHeight: 0.95,
            color: "#fff",
            letterSpacing: 2,
            textTransform: "uppercase",
            textShadow:
              "0 0 40px rgba(107,205,6,0.25), 2px 2px 0 rgba(254,3,109,0.35)",
            margin: 0,
          }}
        >
          STARTING SOON
        </h1>
      </div>

      {/* ---- Left timer column ---- */}
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 320,
          width: 580,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          opacity: 0,
          animation: "ss-slide-in-left 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.7s forwards",
          zIndex: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: "'Quedora', sans-serif",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 8,
            color: "#6bcd06",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              background: "#6bcd06",
              boxShadow: "0 0 12px #6bcd06",
              animation: "ss-pulse 1.2s ease-in-out infinite",
            }}
          />
          <span>KICKOFF IN</span>
        </div>
        <div
          style={{
            fontFamily: "'AghartiWide', 'Quedora', sans-serif",
            fontWeight: 900,
            fontSize: 180,
            lineHeight: 0.88,
            color: expired ? "#8eff14" : "#fff",
            letterSpacing: -2,
            textShadow:
              "0 0 60px rgba(107,205,6,0.45), 4px 4px 0 rgba(254,3,109,0.4)",
            animation: expired ? "ss-expired 0.6s ease-in-out infinite" : undefined,
          }}
        >
          {fmt(remainingSec)}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: "'Quedora', sans-serif",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 8,
            color: "#fe036d",
            textTransform: "uppercase",
          }}
        >
          {expired ? "MATCH BEGINS NOW" : "GET READY · MATCH INCOMING"}
        </div>
      </div>

      {/* ---- Bottom bar + marquee ---- */}
      <footer
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
          background:
            "linear-gradient(180deg, transparent 0%, rgba(5,8,5,0.92) 100%)",
          borderTop: "1px solid rgba(107,205,6,0.3)",
          transform: "translateY(100%)",
          animation: "ss-slide-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards",
          zIndex: 10,
          gap: 30,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <Image
            src="/brand/logos/primary/pro-league.png"
            alt="Pro League"
            width={200}
            height={78}
            style={{ height: 78, width: "auto", filter: "drop-shadow(0 0 14px rgba(254,3,109,0.5))" }}
          />
          <div
            style={{
              fontFamily: "'AghartiWide', 'Quedora', sans-serif",
              fontWeight: 900,
              fontSize: 20,
              color: "#fff",
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

        {/* Infinite marquee — two concatenated copies of the strap for seamless loop. */}
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            padding: "0 26px",
            borderLeft: "1px solid rgba(107,205,6,0.2)",
            borderRight: "1px solid rgba(107,205,6,0.2)",
            height: "70%",
            display: "flex",
            alignItems: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              whiteSpace: "nowrap",
              animation: "ss-marquee 40s linear infinite",
              fontFamily: "'Quedora', sans-serif",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: 6,
              color: "#6bcd06",
              textTransform: "uppercase",
            }}
          >
            <MarqueeStrap />
            <MarqueeStrap />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontFamily: "'Quedora', sans-serif",
            fontWeight: 500,
            fontSize: 11,
            letterSpacing: 4,
            color: "#5a6853",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          <span>CADE ESPORTS</span>
          <span style={{ color: "#fe036d" }}>◣</span>
          <span>LIVE · OFFICIAL</span>
        </div>
      </footer>
    </div>
  );
}

function MarqueeStrap() {
  const items = [
    "CADE ESPORTS",
    "◆",
    "GAMEEVO",
    "◆",
    "ESPORTS AFRICA NEWS",
    "◆",
    "GAMEPRIDE",
    "◆",
    "TRACE TV",
    "◆",
    "NATIONAL E-SOCCER PRO LEAGUE",
    "◆",
  ];
  return (
    <>
      {items.map((text, i) => (
        <span key={i} style={{ padding: "0 28px", color: text === "◆" ? "#fe036d" : undefined }}>
          {text}
        </span>
      ))}
    </>
  );
}
