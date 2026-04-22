"use client";

/**
 * Plan 22 — CADE-original FUT-style player card.
 *
 * Reusable card consumed by:
 *  - /overlay/player-card (production broadcast overlay)
 *  - /players/[id] (public profile)
 *  - future /admin/squads/[id] review preview
 *  - future weekend-roster rotation overlay
 *
 * Visuals are CADE-original: SVG gradients keyed off the brand tokens in
 * globals.css (--primary, --secondary, ink ramp). No EA assets, no FIFA
 * wordmark, no club crests shipped by this component. Layout proportions
 * (rating top-left, photo top-right, 2x3 stat grid) are functional fact —
 * see docs/superpowers/specs/2026-04-22-plan-22-cade-player-card.md §10
 * for the legal posture.
 *
 * Animation tokens come from `lib/motion.ts` only — no inline duration
 * literals (CLAUDE.md constraint).
 */

import { motion } from "framer-motion";
import Image from "next/image";
import { useId, useMemo } from "react";
import { ENTER, IDLE_PULSE } from "@/lib/motion";

export type CadePlayerCardRarity =
  | "gold"
  | "silver"
  | "bronze"
  | "totw"
  | "hero"
  | "icon"
  | "cade-special";

export type CadePlayerCardSize = "sm" | "md" | "lg" | "xl";

export type CadePlayerCardPosition =
  | "GK"
  | "CB"
  | "LB"
  | "RB"
  | "CDM"
  | "CM"
  | "CAM"
  | "LM"
  | "RM"
  | "LW"
  | "RW"
  | "ST"
  | "CF";

export type CadePlayerCardProps = {
  // Identity
  displayName: string;
  gamerTag?: string;
  jerseyNumber?: number;
  // FUT rating + position
  rating: number;
  position: CadePlayerCardPosition;
  // Photo (transparent-bg PNG recommended)
  photoUrl: string;
  // 6 main stats (0-99)
  stats: {
    pac: number;
    sho: number;
    pas: number;
    dri: number;
    def: number;
    phy: number;
  };
  // Optional badges
  clubLogoUrl?: string;
  nationFlagUrl?: string;
  leagueLogoUrl?: string;
  // Visual
  rarity?: CadePlayerCardRarity;
  size?: CadePlayerCardSize;
  animate?: boolean;
  // GK label override (DIV/HAN/KIC/REF/SPE/POS)
  isGoalkeeper?: boolean;
};

// -- Size table -----------------------------------------------------------

const SIZE_PX: Record<CadePlayerCardSize, number> = {
  sm: 240,
  md: 320,
  lg: 480,
  xl: 640,
};

// -- Rarity palette -------------------------------------------------------
// Each entry produces an SVG <linearGradient> + accent colours used by
// the trim, name strip, and rating chip. Reimplemented from scratch using
// our brand tokens; no copy of EA's exact ramps.

type RarityPalette = {
  // SVG gradient stops for the card background
  bgStops: { offset: string; color: string; opacity?: number }[];
  // Diagonal sheen overlay strength
  sheen: number;
  // Trim + accent for rating chip and divider rules
  accent: string;
  accentInk: string;
  // Inner panel background tinted under the photo + name
  innerTint: string;
  // Name strip colour
  nameColor: string;
  // Stat cell text colour
  statColor: string;
  // Stat label colour
  statLabelColor: string;
  // Ring colour around the photo well
  ring: string;
};

const PALETTES: Record<CadePlayerCardRarity, RarityPalette> = {
  gold: {
    bgStops: [
      { offset: "0%", color: "#f8e08e" },
      { offset: "45%", color: "#dcae3a" },
      { offset: "100%", color: "#7e5113" },
    ],
    sheen: 0.18,
    accent: "#fff5c8",
    accentInk: "#3a2806",
    innerTint: "rgba(36, 22, 4, 0.35)",
    nameColor: "#fff8d8",
    statColor: "#fff5c8",
    statLabelColor: "rgba(255, 248, 216, 0.78)",
    ring: "rgba(255, 245, 200, 0.55)",
  },
  silver: {
    bgStops: [
      { offset: "0%", color: "#f4f5f7" },
      { offset: "45%", color: "#bfc3cc" },
      { offset: "100%", color: "#5f6470" },
    ],
    sheen: 0.16,
    accent: "#1c1f26",
    accentInk: "#f5f6f8",
    innerTint: "rgba(20, 22, 28, 0.18)",
    nameColor: "#1c1f26",
    statColor: "#1c1f26",
    statLabelColor: "rgba(28, 31, 38, 0.7)",
    ring: "rgba(28, 31, 38, 0.45)",
  },
  bronze: {
    bgStops: [
      { offset: "0%", color: "#d59964" },
      { offset: "45%", color: "#9a5a26" },
      { offset: "100%", color: "#4d2706" },
    ],
    sheen: 0.18,
    accent: "#ffe2b9",
    accentInk: "#33170a",
    innerTint: "rgba(28, 14, 4, 0.35)",
    nameColor: "#ffe2b9",
    statColor: "#ffe2b9",
    statLabelColor: "rgba(255, 226, 185, 0.78)",
    ring: "rgba(255, 226, 185, 0.5)",
  },
  totw: {
    bgStops: [
      { offset: "0%", color: "#1d1a0a" },
      { offset: "45%", color: "#0c0a04" },
      { offset: "100%", color: "#000000" },
    ],
    sheen: 0.22,
    accent: "#e6b32b",
    accentInk: "#0c0a04",
    innerTint: "rgba(230, 179, 43, 0.08)",
    nameColor: "#e6b32b",
    statColor: "#e6b32b",
    statLabelColor: "rgba(230, 179, 43, 0.7)",
    ring: "rgba(230, 179, 43, 0.55)",
  },
  hero: {
    bgStops: [
      { offset: "0%", color: "#ff7855" },
      { offset: "45%", color: "#c0341a" },
      { offset: "100%", color: "#3a0a02" },
    ],
    sheen: 0.2,
    accent: "#fff0e8",
    accentInk: "#400a02",
    innerTint: "rgba(40, 6, 2, 0.32)",
    nameColor: "#fff0e8",
    statColor: "#fff0e8",
    statLabelColor: "rgba(255, 240, 232, 0.78)",
    ring: "rgba(255, 240, 232, 0.55)",
  },
  icon: {
    bgStops: [
      { offset: "0%", color: "#fbf2d2" },
      { offset: "45%", color: "#d6b675" },
      { offset: "100%", color: "#82622a" },
    ],
    sheen: 0.16,
    accent: "#322310",
    accentInk: "#fbf2d2",
    innerTint: "rgba(50, 35, 16, 0.22)",
    nameColor: "#322310",
    statColor: "#322310",
    statLabelColor: "rgba(50, 35, 16, 0.72)",
    ring: "rgba(50, 35, 16, 0.45)",
  },
  "cade-special": {
    bgStops: [
      { offset: "0%", color: "#fe036d" },
      { offset: "55%", color: "#7a0036" },
      { offset: "100%", color: "#0a0006" },
    ],
    sheen: 0.24,
    accent: "#6bcd06",
    accentInk: "#0a1400",
    innerTint: "rgba(0, 0, 0, 0.35)",
    nameColor: "#6bcd06",
    statColor: "#ffffff",
    statLabelColor: "rgba(255, 255, 255, 0.78)",
    ring: "rgba(107, 205, 6, 0.6)",
  },
};

// -- Stat labels ----------------------------------------------------------

const OUTFIELD_LABELS: Array<[keyof CadePlayerCardProps["stats"], string]> = [
  ["pac", "PAC"],
  ["sho", "SHO"],
  ["pas", "PAS"],
  ["dri", "DRI"],
  ["def", "DEF"],
  ["phy", "PHY"],
];

const GK_LABELS: Array<[keyof CadePlayerCardProps["stats"], string]> = [
  ["pac", "DIV"],
  ["sho", "HAN"],
  ["pas", "KIC"],
  ["dri", "REF"],
  ["def", "SPE"],
  ["phy", "POS"],
];

// -- Component ------------------------------------------------------------

export function CadePlayerCard(props: CadePlayerCardProps) {
  const {
    displayName,
    gamerTag,
    rating,
    position,
    photoUrl,
    stats,
    clubLogoUrl,
    nationFlagUrl,
    leagueLogoUrl,
    rarity = "gold",
    size = "md",
    animate = false,
    isGoalkeeper = false,
  } = props;

  const palette = PALETTES[rarity];
  const widthPx = SIZE_PX[size];
  const gradId = useId();
  const sheenId = useId();
  const radialId = useId();

  const labels = isGoalkeeper ? GK_LABELS : OUTFIELD_LABELS;
  const hasAnyBadge = Boolean(clubLogoUrl || nationFlagUrl || leagueLogoUrl);

  // Rating font scales with card width — locks proportional FUT feel
  // independent of size.
  const ratingFontSize = Math.round(widthPx * 0.18);
  const positionFontSize = Math.round(widthPx * 0.055);
  const nameFontSize = Math.round(widthPx * 0.085);
  const statNumberFontSize = Math.round(widthPx * 0.08);
  const statLabelFontSize = Math.round(widthPx * 0.04);

  const cardStyle: React.CSSProperties = useMemo(
    () => ({
      width: widthPx,
      aspectRatio: "2 / 3",
      position: "relative",
      borderRadius: 14,
      overflow: "hidden",
      boxShadow:
        "0 18px 38px -14px rgba(0,0,0,0.55), 0 4px 16px -6px rgba(0,0,0,0.4)",
      isolation: "isolate",
      color: palette.statColor,
      fontFamily:
        "var(--font-broadcast-display, var(--font-display, system-ui))",
    }),
    [widthPx, palette.statColor],
  );

  const cardContent = (
    <>
      {/* Background SVG — fills the card */}
      <svg
        aria-hidden
        viewBox={`0 0 200 300`}
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="20%" y2="100%">
            {palette.bgStops.map((s) => (
              <stop
                key={s.offset}
                offset={s.offset}
                stopColor={s.color}
                stopOpacity={s.opacity ?? 1}
              />
            ))}
          </linearGradient>
          <linearGradient id={sheenId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop
              offset="45%"
              stopColor="#ffffff"
              stopOpacity={palette.sheen}
            />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={radialId} cx="80%" cy="20%" r="80%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect
          x={0}
          y={0}
          width={200}
          height={300}
          fill={`url(#${gradId})`}
        />
        {/* Diagonal sheen */}
        <rect
          x={0}
          y={0}
          width={200}
          height={300}
          fill={`url(#${sheenId})`}
        />
        {/* Top-right radial highlight to lift the photo */}
        <rect
          x={0}
          y={0}
          width={200}
          height={300}
          fill={`url(#${radialId})`}
        />
        {/* Inner trim — outline + inset highlight */}
        <rect
          x={2}
          y={2}
          width={196}
          height={296}
          rx={9}
          ry={9}
          fill="none"
          stroke={palette.accent}
          strokeOpacity={0.45}
          strokeWidth={1}
        />
      </svg>

      {/* Rating chip + position chip — top-left stack */}
      <div
        style={{
          position: "absolute",
          left: widthPx * 0.075,
          top: widthPx * 0.07,
          zIndex: 3,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: widthPx * 0.01,
        }}
      >
        <motion.div
          data-testid="cade-card-rating"
          animate={
            animate
              ? { scale: [1, 1.04, 1], opacity: [1, 0.92, 1] }
              : undefined
          }
          transition={
            animate
              ? {
                  duration: IDLE_PULSE.duration,
                  ease: [...IDLE_PULSE.ease] as [number, number, number, number],
                  repeat: Infinity,
                  repeatType: IDLE_PULSE.repeatType,
                }
              : undefined
          }
          style={{
            color: palette.accent,
            fontSize: ratingFontSize,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            textShadow: "0 2px 6px rgba(0,0,0,0.35)",
          }}
        >
          {rating}
        </motion.div>
        <div
          style={{
            color: palette.accent,
            fontFamily:
              "var(--font-broadcast-accent, var(--font-display, system-ui))",
            fontSize: positionFontSize,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            marginTop: widthPx * 0.01,
          }}
        >
          {position}
        </div>
      </div>

      {/* Photo well — top-right, transparent PNG sits over the gradient */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: "62%",
          height: "55%",
          zIndex: 1,
          overflow: "visible",
        }}
      >
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt=""
            width={widthPx}
            height={Math.round(widthPx * 1.5)}
            sizes={`${widthPx}px`}
            unoptimized={!photoUrl.startsWith("/")}
            style={{
              position: "absolute",
              right: -widthPx * 0.04,
              top: widthPx * 0.04,
              width: "118%",
              height: "auto",
              objectFit: "contain",
              transform: "rotate(-2deg)",
              transformOrigin: "top right",
              filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))",
              pointerEvents: "none",
            }}
            priority={false}
          />
        ) : null}
      </div>

      {/* Inner tint panel below mid — improves contrast for name + stats */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "55%",
          background: `linear-gradient(180deg, transparent 0%, ${palette.innerTint} 35%, ${palette.innerTint} 100%)`,
          zIndex: 2,
        }}
      />

      {/* Name strip */}
      <div
        data-testid="cade-card-name"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "55%",
          zIndex: 4,
          textAlign: "center",
          padding: `${widthPx * 0.025}px ${widthPx * 0.05}px ${widthPx * 0.015}px`,
          borderTop: `1px solid ${palette.ring}`,
          borderBottom: `1px solid ${palette.ring}`,
          color: palette.nameColor,
          fontFamily:
            "var(--font-broadcast-display, var(--font-display, system-ui))",
          fontSize: nameFontSize,
          fontWeight: 900,
          letterSpacing: "-0.02em",
          textTransform: "uppercase",
          lineHeight: 1.05,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {displayName}
      </div>
      {gamerTag ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `calc(55% + ${nameFontSize + widthPx * 0.05}px)`,
            zIndex: 4,
            textAlign: "center",
            color: palette.statLabelColor,
            fontFamily:
              "var(--font-broadcast-accent, var(--font-display, system-ui))",
            fontSize: Math.round(widthPx * 0.038),
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          @{gamerTag}
        </div>
      ) : null}

      {/* Stats grid — 2 columns x 3 rows */}
      <div
        data-testid="cade-card-stats"
        style={{
          position: "absolute",
          left: widthPx * 0.07,
          right: widthPx * 0.07,
          bottom: hasAnyBadge ? widthPx * 0.18 : widthPx * 0.06,
          zIndex: 4,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          rowGap: widthPx * 0.012,
          columnGap: widthPx * 0.06,
        }}
      >
        {labels.map(([key, label]) => (
          <div
            key={label}
            data-stat={label}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: widthPx * 0.02,
              justifyContent: "center",
            }}
          >
            <span
              style={{
                color: palette.statColor,
                fontFamily:
                  "var(--font-broadcast-display, var(--font-display, system-ui))",
                fontSize: statNumberFontSize,
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
                minWidth: "2ch",
                textAlign: "right",
              }}
            >
              {stats[key]}
            </span>
            <span
              style={{
                color: palette.statLabelColor,
                fontFamily:
                  "var(--font-broadcast-accent, var(--font-display, system-ui))",
                fontSize: statLabelFontSize,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Badge row — bottom edge, only if at least one URL is present */}
      {hasAnyBadge ? (
        <div
          data-testid="cade-card-badges"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: widthPx * 0.04,
            zIndex: 4,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: widthPx * 0.05,
          }}
        >
          {clubLogoUrl ? <Badge url={clubLogoUrl} px={widthPx * 0.08} /> : null}
          {nationFlagUrl ? (
            <Badge url={nationFlagUrl} px={widthPx * 0.08} />
          ) : null}
          {leagueLogoUrl ? (
            <Badge url={leagueLogoUrl} px={widthPx * 0.08} />
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (!animate) {
    return (
      <div
        data-testid="cade-player-card"
        data-rarity={rarity}
        data-size={size}
        style={cardStyle}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <motion.div
      data-testid="cade-player-card"
      data-rarity={rarity}
      data-size={size}
      style={cardStyle}
      initial={{ scale: 0.86, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        duration: ENTER.duration,
        ease: [...ENTER.ease] as [number, number, number, number],
      }}
    >
      {cardContent}
    </motion.div>
  );
}

function Badge({ url, px }: { url: string; px: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        width: px,
        height: px,
        borderRadius: "50%",
        background: "rgba(0,0,0,0.25)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        style={{ width: "78%", height: "78%", objectFit: "contain" }}
      />
    </span>
  );
}
