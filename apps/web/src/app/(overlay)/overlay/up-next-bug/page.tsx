"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useOverlayChannel } from "../../useOverlayChannel";
import { upNextBugSchema } from "@/server/overlays/schemas";
import { ENTER } from "@/lib/motion";
import { formatClock } from "../../useMatchClock";

/**
 * Plan 37 — up-next overlay rewrite. Trapezoid clip-path + left
 * "IN mm:ss" countdown block + center VS column + right shield slot.
 * Chrome from `KNOWLEDGE/brand-assets/elements/19_up_next.html`.
 */

export const dynamic = "force-dynamic";

export default function UpNextBugPage() {
  return (
    <Suspense fallback={null}>
      <UpNextInner />
    </Suspense>
  );
}

function UpNextInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  // Plan 42.1 — optional slot filter; default primary for back-compat.
  const slotRaw = sp?.get("slot") ?? null;
  const slot: "primary" | "secondary" =
    slotRaw === "secondary" ? "secondary" : "primary";
  const state = useOverlayChannel(sessionId, "up_next_bug", slot);
  const parsed = state.payload
    ? upNextBugSchema.safeParse(state.payload)
    : null;

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
            key={state.eventId ?? "up-next"}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ ...ENTER, duration: 0.7 }}
            style={{
              position: "fixed",
              right: "60px",
              top: "60px",
              minWidth: "780px",
              background: "var(--panel-strong)",
              border: "2px solid var(--primary)",
              clipPath:
                "polygon(20px 0, calc(100% - 20px) 0, 100% 100%, 0 100%)",
              padding: "20px 36px",
              pointerEvents: "auto",
              display: "grid",
              gridTemplateColumns: "220px 1fr 100px",
              alignItems: "center",
              gap: "24px",
            }}
            data-testid="up-next"
          >
            <KickoffBlock kickoffAt={parsed.data.kickoffAt} />
            <MatchupBlock data={parsed.data} />
            <ShieldSlot />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function KickoffBlock({ kickoffAt }: { kickoffAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remainingMs = new Date(kickoffAt).getTime() - now;
  const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
  return (
    <div
      style={{
        background: "var(--primary-glow)",
        padding: "10px 14px",
        borderLeft: "3px solid var(--primary)",
      }}
    >
      <div
        style={{
          fontFamily: "Quedora, sans-serif",
          fontWeight: 700,
          fontSize: "11px",
          letterSpacing: "4px",
          textTransform: "uppercase",
          color: "var(--primary)",
        }}
      >
        Up Next · In
      </div>
      <div
        style={{
          fontFamily: "AghartiWide, sans-serif",
          fontWeight: 900,
          fontSize: "40px",
          color: "var(--chalk-0)",
          fontVariantNumeric: "tabular-nums",
          textShadow: "0 0 18px var(--primary-glow)",
        }}
      >
        {formatClock(remainingSec)}
      </div>
    </div>
  );
}

function MatchupBlock({
  data,
}: {
  data: import("zod").infer<typeof upNextBugSchema>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: "16px",
      }}
    >
      <NameCell name={data.home.displayName} photoUrl={data.home.photoUrl} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "2px",
            background: "var(--primary)",
            boxShadow: "0 0 10px var(--primary)",
          }}
        />
        <span
          style={{
            fontFamily: "AghartiWide, sans-serif",
            fontWeight: 900,
            fontSize: "22px",
            letterSpacing: "2px",
            color: "var(--secondary)",
          }}
        >
          VS
        </span>
        <div
          style={{
            width: "40px",
            height: "2px",
            background: "var(--primary)",
            boxShadow: "0 0 10px var(--primary)",
          }}
        />
      </div>
      <NameCell
        name={data.away.displayName}
        photoUrl={data.away.photoUrl}
        rtl
      />
    </div>
  );
}

function NameCell({
  name,
  photoUrl,
  rtl,
}: {
  name: string;
  photoUrl?: string;
  rtl?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: rtl ? "row-reverse" : "row",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <div
        style={{
          width: "76px",
          height: "76px",
          borderRadius: "50%",
          overflow: "hidden",
          border: "2px solid var(--primary)",
          boxShadow: "0 0 14px var(--primary-glow)",
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
          fontSize: "30px",
          textTransform: "uppercase",
          color: "var(--chalk-0)",
          textShadow: "1px 1px 0 var(--secondary-dim)",
          textAlign: rtl ? "right" : "left",
        }}
      >
        {name}
      </div>
    </div>
  );
}

function ShieldSlot() {
  return (
    <div
      style={{
        background: "var(--primary-glow)",
        height: "76px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--primary)",
      }}
    >
      <span
        style={{
          fontFamily: "AghartiWide, sans-serif",
          fontWeight: 900,
          fontSize: "13px",
          letterSpacing: "3px",
          color: "var(--primary)",
        }}
      >
        CADE
      </span>
    </div>
  );
}
