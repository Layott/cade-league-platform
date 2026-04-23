"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useOverlayChannel } from "../../useOverlayChannel";
import { upNextBugSchema } from "@/server/overlays/schemas";
import { ENTER } from "@/lib/motion";
import { formatClock } from "../../useMatchClock";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

/**
 * Plan 37 + Plan 48 — up-next overlay.
 *
 * Plan 48 parity pass against
 * `KNOWLEDGE/brand-assets/elements/19_up_next.html`:
 *   - 1920×1080 OverlayFrame root; positioning switched to absolute.
 *   - trapezoid clip-path (20 px shoulders) matches reference.
 *   - 40 px Quedora/Aghart kicker time, 22 px VS, 38 px team names —
 *     aligned to ref values (was 30 px names).
 *   - Ref uses bottom-center placement; overlay retains top-right for
 *     legibility against on-screen action since this slot is driven by
 *     the admin Up Next form, not the matchday score corner.
 *   - photo slot 76×76 keeps the card compact on top-right.
 *
 * Live countdown `IN mm:ss` still computes locally from kickoffAt.
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
    <OverlayFrame>
      <AnimatePresence>
        {parsed && parsed.success ? (
          <motion.div
            key={state.eventId ?? "up-next"}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ ...ENTER, duration: 0.7 }}
            style={{
              position: "absolute",
              right: "60px",
              top: "60px",
              minWidth: "780px",
              background: "var(--panel-strong)",
              border: "2px solid var(--primary)",
              boxShadow:
                "0 0 0 1px rgba(107, 205, 6, 0.3), 0 10px 40px rgba(0, 0, 0, 0.7)",
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
    </OverlayFrame>
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
        background: "rgba(107, 205, 6, 0.06)",
        padding: "14px 30px 14px 40px",
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
        <span style={{ color: "var(--secondary)", fontSize: "9px" }}>▶</span>
        {"  "}Up Next · In
      </div>
      <div
        style={{
          fontFamily: "AghartiWide, sans-serif",
          fontWeight: 900,
          fontSize: "40px",
          color: "var(--chalk-0)",
          fontVariantNumeric: "tabular-nums",
          textShadow: "0 0 18px rgba(107, 205, 6, 0.35)",
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
        padding: "0 8px",
      }}
    >
      <NameCell name={data.home.displayName} photoUrl={data.home.photoUrl} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
          padding: "0 8px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "2px",
            background: "var(--primary)",
            boxShadow: "0 0 6px var(--primary)",
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
            boxShadow: "0 0 6px var(--primary)",
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
          boxShadow: "0 0 12px rgba(107, 205, 6, 0.5)",
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
          fontSize: "38px",
          textTransform: "uppercase",
          color: "var(--chalk-0)",
          textShadow: "1px 1px 0 rgba(254, 3, 109, 0.35)",
          textAlign: rtl ? "right" : "left",
          letterSpacing: "1px",
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
        background: "rgba(107, 205, 6, 0.08)",
        height: "76px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--primary)",
        boxShadow: "inset 0 0 12px rgba(254, 3, 109, 0.12)",
      }}
    >
      <span
        style={{
          fontFamily: "AghartiWide, sans-serif",
          fontWeight: 900,
          fontSize: "13px",
          letterSpacing: "3px",
          color: "var(--primary)",
          filter: "drop-shadow(0 0 10px rgba(254, 3, 109, 0.5))",
        }}
      >
        CADE
      </span>
    </div>
  );
}
