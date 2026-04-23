"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useOverlayChannel } from "../../useOverlayChannel";
import { scoreBugSchema } from "@/server/overlays/schemas";
import { ENTER } from "@/lib/motion";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

/**
 * Plan 37 + Plan 48 — score-bug overlay.
 *
 * Plan 48 parity pass against
 * `KNOWLEDGE/brand-assets/elements/18_score_bug.html`:
 *   - 1920×1080 OverlayFrame root (was bare fixed inset).
 *   - Card uses absolute positioning inside the frame so `?preview=1`
 *     scaling carries the card along with the frame.
 *   - 520 px card width (was minWidth 520), 10 px pulse dot (was 8 px),
 *     header padding + gap tightened to 10 px / 18 px / 8 px to match
 *     the reference. Header label tag changed to "LIVE" with separator
 *     then "CADE PRO LEAGUE" aligned right.
 *   - Team name 26 px, score number 40 px, "VS" 20 px — match ref.
 *   - box-shadow tokens use brand rgba so the card lift looks identical
 *     in preview + browser-source mode.
 *
 * React key still uses eventId only so live score edits update payload
 * in place without re-mounting + replaying enter motion.
 */

export const dynamic = "force-dynamic";

export default function ScoreBugPage() {
  return (
    <Suspense fallback={null}>
      <ScoreBugInner />
    </Suspense>
  );
}

function ScoreBugInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  // Plan 42.1 — `?slot=primary|secondary` filters the score_bug feed to
  // the matching match slot. Default 'primary' so legacy single-match
  // bookmarks keep working.
  const slotRaw = sp?.get("slot") ?? null;
  const slot: "primary" | "secondary" =
    slotRaw === "secondary" ? "secondary" : "primary";
  const state = useOverlayChannel(sessionId, "score_bug", slot);
  const parsed = state.payload ? scoreBugSchema.safeParse(state.payload) : null;

  return (
    <OverlayFrame>
      <AnimatePresence>
        {parsed && parsed.success ? (
          <motion.div
            key={state.eventId ?? "score-bug"}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ ...ENTER, duration: 0.6 }}
            style={{
              position: "absolute",
              right: "60px",
              bottom: "60px",
              width: "520px",
              background: "var(--panel-strong)",
              border: "2px solid var(--primary)",
              clipPath:
                "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
              pointerEvents: "auto",
              boxShadow:
                "0 0 0 1px rgba(107, 205, 6, 0.3), 0 10px 40px rgba(0, 0, 0, 0.6)",
            }}
            data-testid="score-bug"
          >
            <ScoreBugCard data={parsed.data} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </OverlayFrame>
  );
}

function ScoreBugCard({
  data,
}: {
  data: import("zod").infer<typeof scoreBugSchema>;
}) {
  const [home, away] = data.players;
  return (
    <div>
      {/* header strip — pink pulse dot + LIVE label + right-aligned tourney mark */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "8px 18px",
          background: "rgba(107, 205, 6, 0.12)",
          borderBottom: "1px solid rgba(107, 205, 6, 0.3)",
          fontFamily: "Quedora, sans-serif",
          fontWeight: 700,
          fontSize: "11px",
          letterSpacing: "4px",
          textTransform: "uppercase",
          color: "var(--primary)",
        }}
      >
        <span
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: "var(--secondary)",
            boxShadow: "0 0 10px var(--secondary)",
            animation: "sb-pulse 1.2s ease-in-out infinite",
          }}
        />
        <span>LIVE</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--chalk-1)" }}>CADE PRO LEAGUE</span>
      </div>

      {/* match row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: "20px",
          padding: "16px 24px",
        }}
      >
        <TeamCell name={home.displayName} photoUrl={home.photoUrl} align="left" />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "18px",
            fontFamily: "AghartiWide, sans-serif",
            fontWeight: 900,
            fontSize: "40px",
            color: "var(--chalk-0)",
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 0 18px rgba(107, 205, 6, 0.35)",
          }}
          data-testid="score-display"
        >
          <span>{home.score}</span>
          <span
            style={{
              fontSize: "20px",
              color: "var(--secondary)",
              letterSpacing: "2px",
            }}
          >
            VS
          </span>
          <span>{away.score}</span>
        </div>
        <TeamCell
          name={away.displayName}
          photoUrl={away.photoUrl}
          align="right"
        />
      </div>
      <style>{`
        @keyframes sb-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.6); }
        }
      `}</style>
    </div>
  );
}

function TeamCell({
  name,
  photoUrl,
  align,
}: {
  name: string;
  photoUrl?: string;
  align: "left" | "right";
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: align === "right" ? "row-reverse" : "row",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <div
        style={{
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          overflow: "hidden",
          border: "2px solid var(--primary)",
          boxShadow: "0 0 12px rgba(107, 205, 6, 0.4)",
          background: "var(--ink-3)",
          flexShrink: 0,
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </div>
      <div
        style={{
          fontFamily: "AghartiWide, sans-serif",
          fontWeight: 900,
          fontSize: "26px",
          textTransform: "uppercase",
          color: "var(--chalk-0)",
          textAlign: align,
          letterSpacing: "1px",
        }}
      >
        {name}
      </div>
    </div>
  );
}
