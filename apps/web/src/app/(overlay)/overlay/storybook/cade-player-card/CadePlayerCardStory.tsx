"use client";

import { useState } from "react";
import {
  CadePlayerCard,
  type CadePlayerCardRarity,
  type CadePlayerCardSize,
  type CadePlayerCardPosition,
} from "@/components/players/CadePlayerCard";

const RARITIES: CadePlayerCardRarity[] = [
  "gold",
  "silver",
  "bronze",
  "totw",
  "hero",
  "icon",
  "cade-special",
];

const SIZES: CadePlayerCardSize[] = ["sm", "md", "lg", "xl"];

// Rotating placeholder positions used for the 13-player row so each card
// shows a different spot on the pitch.
const POSITION_ROTATION: CadePlayerCardPosition[] = [
  "GK",
  "ST",
  "CAM",
  "CB",
  "RW",
  "LW",
  "CDM",
  "CM",
  "RB",
  "LB",
  "CF",
  "RM",
  "LM",
];

const PLACEHOLDER_STATS = {
  pac: 84,
  sho: 80,
  pas: 76,
  dri: 88,
  def: 36,
  phy: 74,
};

type PlayerEntry = {
  slug: string;
  displayName: string;
  photoUrl: string;
};

export function CadePlayerCardStory({ players }: { players: PlayerEntry[] }) {
  const [animate, setAnimate] = useState(false);
  const [hover, setHover] = useState(true);

  return (
    <div
      data-testid="cade-card-storybook-root"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 80px",
        background: "var(--ink-1)",
        color: "var(--chalk-0)",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1
          className="font-broadcast-display"
          style={{
            fontSize: 48,
            margin: 0,
            color: "var(--primary)",
            letterSpacing: "-0.03em",
          }}
        >
          CadePlayerCard — Storybook
        </h1>
        <p style={{ color: "var(--chalk-2)", margin: "6px 0 0" }}>
          Plan 22 — 7 rarities x 4 sizes + the real 13-player manifest row.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 14 }}>
          <Toggle
            label="animate"
            checked={animate}
            onChange={setAnimate}
            testId="toggle-animate"
          />
          <Toggle
            label="hover"
            checked={hover}
            onChange={setHover}
            testId="toggle-hover"
          />
        </div>
      </header>

      <SectionHeader>1 · Rarities x Sizes</SectionHeader>
      {RARITIES.map((rarity) => (
        <div key={rarity} style={{ marginBottom: 36 }}>
          <h3
            data-testid={`rarity-tag-${rarity}`}
            data-rarity-tag={rarity}
            className="font-broadcast-accent"
            style={{
              fontSize: 14,
              color: "var(--chalk-2)",
              margin: "0 0 12px",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
            }}
          >
            {rarity}
          </h3>
          <div
            style={{
              display: "flex",
              gap: 24,
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            {SIZES.map((size) => (
              <CardCell
                key={`${rarity}-${size}`}
                hover={hover}
                label={size}
              >
                <CadePlayerCard
                  displayName="Adefola"
                  gamerTag="adefola"
                  rating={88}
                  position="ST"
                  photoUrl="/players/adefola/headshot_01.png"
                  stats={PLACEHOLDER_STATS}
                  rarity={rarity}
                  size={size}
                  animate={animate}
                />
              </CardCell>
            ))}
          </div>
        </div>
      ))}

      <SectionHeader>2 · Real 13 CADE players</SectionHeader>
      <p style={{ color: "var(--chalk-3)", fontSize: 13, margin: "0 0 16px" }}>
        Photos sourced from{" "}
        <code>KNOWLEDGE/brand-assets/players/processed/manifest.json</code>{" "}
        via <code>scripts/sync-player-photos.mjs</code>. Rating 88 +
        rotating positions are placeholders.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 20,
        }}
      >
        {players.map((p, i) => (
          <CardCell
            key={p.slug}
            hover={hover}
            label={p.displayName}
            testId={`real-player-${p.slug}`}
          >
            <CadePlayerCard
              displayName={p.displayName}
              gamerTag={p.slug}
              rating={88}
              position={POSITION_ROTATION[i % POSITION_ROTATION.length]}
              photoUrl={p.photoUrl}
              stats={PLACEHOLDER_STATS}
              rarity={i % 2 === 0 ? "cade-special" : "gold"}
              size="md"
              isGoalkeeper={
                POSITION_ROTATION[i % POSITION_ROTATION.length] === "GK"
              }
              animate={animate}
            />
          </CardCell>
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
        margin: "32px 0 18px",
        borderBottom: "1px solid var(--ink-4)",
        paddingBottom: 8,
        textTransform: "uppercase",
      }}
    >
      {children}
    </h2>
  );
}

function CardCell({
  children,
  hover,
  label,
  testId,
}: {
  children: React.ReactNode;
  hover: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        transition: "transform 200ms ease-out",
        cursor: hover ? "pointer" : "default",
      }}
      onMouseEnter={(e) => {
        if (hover) e.currentTarget.style.transform = "translateY(-4px)";
      }}
      onMouseLeave={(e) => {
        if (hover) e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {children}
      <span
        className="tabular"
        style={{ fontSize: 11, color: "var(--chalk-3)" }}
      >
        {label}
      </span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  testId: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        fontSize: 13,
        color: "var(--chalk-1)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className="font-broadcast-accent">{label}</span>
    </label>
  );
}
