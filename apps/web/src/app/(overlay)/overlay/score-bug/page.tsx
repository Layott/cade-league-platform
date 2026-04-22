"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useOverlayChannel } from "../../useOverlayChannel";
import { scoreBugSchema } from "@/server/overlays/schemas";
import { ENTER } from "@/lib/motion";

/**
 * Plan 37 — score-bug overlay rewrite.
 *
 * Single-instance (legacy `useOverlayChannel`), but the React key uses
 * the eventId only (NOT payload contents), so editing scores in the
 * admin updates `payload` in place without re-mounting the card / re-
 * playing enter motion. Chrome from
 * `KNOWLEDGE/brand-assets/elements/18_score_bug.html`.
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        background: "transparent",
      }}
      data-testid="overlay-root"
    >
      <AnimatePresence>
        {parsed && parsed.success ? (
          <motion.div
            key={state.eventId ?? "score-bug"}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ ...ENTER, duration: 0.6 }}
            style={{
              position: "fixed",
              right: "60px",
              bottom: "60px",
              minWidth: "520px",
              background: "var(--panel-strong)",
              border: "2px solid var(--primary)",
              clipPath:
                "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
              pointerEvents: "auto",
              boxShadow:
                "0 0 0 1px var(--primary-glow), inset 0 0 30px var(--primary-glow)",
            }}
            data-testid="score-bug"
          >
            <ScoreBugCard data={parsed.data} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
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
      {/* header strip — LIVE pulse + label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "8px 18px",
          background: "var(--primary-glow)",
          borderBottom: "1px solid var(--primary)",
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
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "var(--secondary)",
            boxShadow: "0 0 8px var(--secondary)",
            animation: "pulse 1.4s ease-in-out infinite",
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
            textShadow: "0 0 18px var(--primary-glow)",
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
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
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
          boxShadow: "0 0 12px var(--primary-glow)",
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
        }}
      >
        {name}
      </div>
    </div>
  );
}
