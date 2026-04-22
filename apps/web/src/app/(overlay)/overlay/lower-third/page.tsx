"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useOverlayInstances } from "../../useOverlayInstances";
import { lowerThirdSchema } from "@/server/overlays/schemas";
import { ENTER } from "@/lib/motion";

/**
 * Plan 37 — multi-instance lower-third overlay.
 *
 * Subscribes to `overlay:<sessionId>` and renders up to three stacked
 * cards keyed by instanceSlot. React key uses `instanceId` (stable across
 * payload edits) so re-publishing a payload to the same slot does NOT
 * re-mount and re-play enter motion.
 *
 * Chrome lifted from `KNOWLEDGE/brand-assets/elements/17_lower_third.html`:
 * 8 px pink accent bar, 180 px green-bordered photo slot, body panel with
 * scanlight sweep + slope clip-path. Brand tokens only.
 */

export const dynamic = "force-dynamic";

type SlotPlacement = { bottom: string };
const SLOT_PLACEMENT: Record<number, SlotPlacement> = {
  1: { bottom: "80px" },
  2: { bottom: "300px" },
  3: { bottom: "520px" },
};

export default function LowerThirdPage() {
  return (
    <Suspense fallback={null}>
      <LowerThirdInner />
    </Suspense>
  );
}

function LowerThirdInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const state = useOverlayInstances(sessionId, "lower_third");

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
        {[1, 2, 3].map((slot) => {
          const inst = state.bySlot[slot];
          if (!inst) return null;
          const parsed = lowerThirdSchema.safeParse(inst.payload);
          if (!parsed.success) return null;
          const placement = SLOT_PLACEMENT[slot];
          return (
            <motion.div
              key={inst.instanceId}
              initial={{ opacity: 0, x: -60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ ...ENTER, duration: 0.7 }}
              style={{
                position: "fixed",
                left: "120px",
                bottom: placement.bottom,
                display: "flex",
                alignItems: "stretch",
                height: "180px",
                pointerEvents: "auto",
              }}
              data-testid={`lower-third-slot-${slot}`}
            >
              <LowerThirdCard data={parsed.data} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function LowerThirdCard({
  data,
}: {
  data: import("zod").infer<typeof lowerThirdSchema>;
}) {
  return (
    <>
      {/* pink accent bar */}
      <div
        style={{
          width: "8px",
          background: "var(--secondary)",
          transformOrigin: "bottom",
          boxShadow: "0 0 18px var(--secondary-glow)",
        }}
      />
      {/* photo slot */}
      <div
        style={{
          position: "relative",
          width: "180px",
          height: "180px",
          overflow: "hidden",
          background:
            "linear-gradient(180deg, var(--primary-glow), var(--ink-1))",
        }}
      >
        {data.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.photoUrl}
            alt={data.displayName}
            style={{
              position: "absolute",
              bottom: "-10px",
              left: "50%",
              transform: "translateX(-50%)",
              height: "200px",
              objectFit: "cover",
              objectPosition: "center top",
              maskImage:
                "linear-gradient(180deg, black 70%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(180deg, black 70%, transparent 100%)",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--primary)",
              fontFamily: "AghartiWide, sans-serif",
              fontWeight: 900,
              fontSize: "48px",
            }}
          >
            #{data.jerseyNumber}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "2px solid var(--primary)",
            borderLeft: "none",
            pointerEvents: "none",
          }}
        />
      </div>
      {/* body */}
      <div
        style={{
          minWidth: "520px",
          padding: "22px 36px 22px 28px",
          background: "var(--panel-strong)",
          borderTop: "2px solid var(--primary)",
          borderBottom: "2px solid var(--primary)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "6px",
          clipPath:
            "polygon(0 0, 100% 0, calc(100% - 24px) 100%, 0 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontFamily: "Quedora, sans-serif",
            fontWeight: 700,
            fontSize: "12px",
            letterSpacing: "5px",
            color: "var(--primary)",
            textTransform: "uppercase",
          }}
        >
          <span style={{ color: "var(--secondary)", fontSize: "9px" }}>▶</span>
          <span>Player</span>
        </div>
        <div
          style={{
            fontFamily: "AghartiWide, sans-serif",
            fontWeight: 900,
            fontSize: "62px",
            lineHeight: "0.9",
            color: "var(--chalk-0)",
            letterSpacing: "1px",
            textTransform: "uppercase",
            textShadow: "2px 2px 0 var(--secondary-dim)",
          }}
        >
          {data.displayName}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontFamily: "Quedora, sans-serif",
            fontWeight: 500,
            fontSize: "14px",
            letterSpacing: "3px",
            color: "var(--chalk-1)",
            textTransform: "uppercase",
          }}
        >
          <span style={{ color: "var(--secondary)" }}>·</span>
          <span style={{ color: "var(--primary)" }}>@{data.gamerTag}</span>
          {data.stats ? (
            <span className="tabular" style={{ color: "var(--chalk-2)" }}>
              · {data.stats.pts} PTS
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
