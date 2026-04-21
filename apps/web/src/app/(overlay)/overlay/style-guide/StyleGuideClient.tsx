"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { PRIMARY_LOGOS, PARTNER_LOGOS } from "@/lib/brand";
import {
  ENTER,
  EXIT,
  SCORE_FLIP,
  IDLE_PULSE,
  STINGER_IN,
  STINGER_HOLD,
  STINGER_OUT,
} from "@/lib/motion";
import { OVERLAY_SOUNDS } from "@/lib/overlay-sounds";

const PALETTE = [
  { token: "--primary", hex: "#6bcd06", ink: "#0a1400" },
  { token: "--primary-dim", hex: "#4a8f04", ink: "#0a1400" },
  { token: "--secondary", hex: "#fe036d", ink: "#ffffff" },
  { token: "--secondary-dim", hex: "rgba(254,3,109,0.35)", ink: "#ffffff" },
  { token: "--ink-0", hex: "#050607", ink: "#ffffff" },
  { token: "--ink-1", hex: "#0b0e11", ink: "#ffffff" },
  { token: "--ink-2", hex: "#141820", ink: "#ffffff" },
  { token: "--ink-3", hex: "#1f2530", ink: "#ffffff" },
  { token: "--ink-4", hex: "#2b3340", ink: "#ffffff" },
  { token: "--ink-5", hex: "#3a4355", ink: "#ffffff" },
  { token: "--chalk-0", hex: "#ffffff", ink: "#050607" },
  { token: "--chalk-1", hex: "#e8ecef", ink: "#050607" },
  { token: "--chalk-2", hex: "#b4bcc5", ink: "#050607" },
  { token: "--chalk-3", hex: "#7a8592", ink: "#ffffff" },
  { token: "--amber", hex: "#ffb020", ink: "#050607" },
  { token: "--flare", hex: "#ff3b3b", ink: "#ffffff" },
];

const MOTION_DEMOS: Array<{
  name: string;
  token: { duration: number; ease?: readonly number[]; repeat?: number };
}> = [
  { name: "ENTER", token: ENTER },
  { name: "EXIT", token: EXIT },
  { name: "SCORE_FLIP", token: SCORE_FLIP },
  { name: "IDLE_PULSE", token: IDLE_PULSE },
  { name: "STINGER_IN", token: STINGER_IN },
  { name: "STINGER_HOLD", token: STINGER_HOLD },
  { name: "STINGER_OUT", token: STINGER_OUT },
];

const ALL_SOUNDS: Array<{ label: string; url: string }> = [
  { label: "Stinger · Intro (10s)", url: OVERLAY_SOUNDS.stingers.introLong },
  { label: "Stinger · Normal (2s)", url: OVERLAY_SOUNDS.stingers.normal },
  { label: "Stinger · Replay (2s)", url: OVERLAY_SOUNDS.stingers.replay },
  { label: "Stinger · Goal (2s)", url: OVERLAY_SOUNDS.stingers.goal },
  { label: "Stinger · Winner (2s)", url: OVERLAY_SOUNDS.stingers.winner },
  { label: "UI · Timer tick (1s)", url: OVERLAY_SOUNDS.ui.timerTick },
  { label: "UI · Timer end", url: OVERLAY_SOUNDS.ui.timerEnd },
  { label: "UI · Notification", url: OVERLAY_SOUNDS.ui.notification },
  { label: "UI · Trigger in (whoosh)", url: OVERLAY_SOUNDS.ui.triggerIn },
  { label: "UI · Trigger out (whoosh)", url: OVERLAY_SOUNDS.ui.triggerOut },
  { label: "Brand · Logo thump", url: OVERLAY_SOUNDS.brand.logoThump },
];

export function StyleGuideClient() {
  return (
    <div
      data-testid="style-guide-root"
      style={{
        minHeight: "100vh",
        padding: "40px 48px 80px",
        background: "var(--ink-0)",
        color: "var(--chalk-0)",
      }}
    >
      <header style={{ marginBottom: 48 }}>
        <h1
          className="font-broadcast-display"
          style={{
            fontSize: 72,
            margin: 0,
            color: "var(--primary)",
            letterSpacing: "-0.03em",
          }}
        >
          Style Guide
        </h1>
        <p style={{ color: "var(--chalk-2)", margin: "8px 0 0" }}>
          Plan 16 — broadcast brand tokens, type ramp, motion + sound library.
        </p>
      </header>

      <SectionHeader>1 · Palette</SectionHeader>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 56,
        }}
      >
        {PALETTE.map((p) => (
          <div
            key={p.token}
            style={{
              background: `var(${p.token})`,
              color: p.ink,
              padding: 16,
              height: 110,
              borderRadius: 6,
              border: "1px solid var(--ink-4)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <span
              className="font-broadcast-accent"
              style={{ fontSize: 11, opacity: 0.85 }}
            >
              {p.token}
            </span>
            <span className="tabular" style={{ fontSize: 12 }}>
              {p.hex}
            </span>
          </div>
        ))}
      </div>

      <SectionHeader>2 · Type Ramp</SectionHeader>
      <div style={{ marginBottom: 56, display: "grid", gap: 20 }}>
        <TypeSample face="display" size={120}>
          Agharti 120
        </TypeSample>
        <TypeSample face="display" size={72}>
          Agharti 72
        </TypeSample>
        <TypeSample face="display" size={48}>
          Agharti 48
        </TypeSample>
        <TypeSample face="accent" size={32}>
          Quedora 32 · UPPERCASE EYEBROW
        </TypeSample>
        <TypeSample face="accent" size={18}>
          Quedora 18 · accent body
        </TypeSample>
        <TypeSample face="mono" size={56}>
          0 1 2 3 4 5 6 7 8 9 — JetBrains 56
        </TypeSample>
        <TypeSample face="mono" size={18}>
          03 : 21 : 44 — tabular numerics
        </TypeSample>
      </div>

      <SectionHeader>3 · Motion Tokens</SectionHeader>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 20,
          marginBottom: 56,
        }}
      >
        {MOTION_DEMOS.map((m) => (
          <MotionDemo key={m.name} name={m.name} token={m.token} />
        ))}
      </div>

      <SectionHeader>4 · Sound Library</SectionHeader>
      <div style={{ display: "grid", gap: 8, marginBottom: 56 }}>
        {ALL_SOUNDS.map((s) => (
          <SoundRow key={s.url} label={s.label} url={s.url} />
        ))}
      </div>

      <SectionHeader>5 · Lock-ups</SectionHeader>
      <div style={{ display: "flex", gap: 40, flexWrap: "wrap", marginBottom: 56 }}>
        {Object.entries(PRIMARY_LOGOS).map(([k, url]) => (
          <LogoTile key={k} label={k} url={url} />
        ))}
        {Object.entries(PARTNER_LOGOS).map(([k, url]) => (
          <LogoTile key={k} label={k} url={url} dim />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="font-broadcast-accent"
      style={{
        fontSize: 14,
        letterSpacing: "0.3em",
        color: "var(--primary)",
        margin: "0 0 20px",
        borderBottom: "1px solid var(--ink-4)",
        paddingBottom: 8,
      }}
    >
      {children}
    </h2>
  );
}

function TypeSample({
  face,
  size,
  children,
}: {
  face: "display" | "accent" | "mono";
  size: number;
  children: React.ReactNode;
}) {
  const cls =
    face === "display"
      ? "font-broadcast-display"
      : face === "accent"
        ? "font-broadcast-accent"
        : "tabular";
  return (
    <div
      className={cls}
      style={{ fontSize: size, lineHeight: 1, color: "var(--chalk-0)" }}
    >
      {children}
    </div>
  );
}

function MotionDemo({
  name,
  token,
}: {
  name: string;
  token: { duration: number; ease?: readonly number[]; repeat?: number };
}) {
  // framer-motion expects a 4-tuple bezier; our tokens match that shape.
  const ease =
    token.ease && token.ease.length === 4
      ? ([token.ease[0], token.ease[1], token.ease[2], token.ease[3]] as [
          number,
          number,
          number,
          number,
        ])
      : undefined;
  return (
    <div
      style={{
        background: "var(--ink-1)",
        border: "1px solid var(--ink-4)",
        padding: 16,
        borderRadius: 6,
      }}
    >
      <div
        className="tabular"
        style={{ fontSize: 11, color: "var(--chalk-3)", marginBottom: 8 }}
      >
        {name} · {token.duration}s
      </div>
      <div
        style={{
          position: "relative",
          height: 40,
          background: "var(--ink-3)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <motion.div
          key={name}
          initial={{ x: "-100%" }}
          animate={{ x: ["-100%", "0%", "100%"] }}
          transition={{
            duration: (token.duration ?? 0.6) * 2,
            ease,
            repeat: Infinity,
            repeatDelay: 0.8,
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "20%",
            height: "100%",
            background: "var(--primary)",
          }}
        />
      </div>
    </div>
  );
}

function SoundRow({ label, url }: { label: string; url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 12px",
        background: "var(--ink-1)",
        border: "1px solid var(--ink-4)",
        borderRadius: 4,
      }}
    >
      <div>
        <div style={{ fontSize: 14, color: "var(--chalk-0)" }}>{label}</div>
        <div className="tabular" style={{ fontSize: 11, color: "var(--chalk-3)" }}>
          {url}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            el.currentTime = 0;
            void el.play();
          }}
          style={{
            background: "var(--primary)",
            color: "var(--primary-ink)",
            border: 0,
            padding: "6px 14px",
            borderRadius: 3,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          play
        </button>
        <audio ref={audioRef} src={url} preload="none" />
      </div>
    </div>
  );
}

function LogoTile({ label, url, dim }: { label: string; url: string; dim?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: 16,
        background: dim ? "var(--chalk-0)" : "var(--ink-1)",
        border: "1px solid var(--ink-4)",
        borderRadius: 6,
        minWidth: 160,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} style={{ maxWidth: 140, maxHeight: 80 }} />
      <span
        className="tabular"
        style={{ fontSize: 11, color: dim ? "var(--ink-1)" : "var(--chalk-3)" }}
      >
        {label}
      </span>
    </div>
  );
}
