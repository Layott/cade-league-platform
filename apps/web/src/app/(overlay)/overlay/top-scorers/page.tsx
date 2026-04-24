"use client";

import { Suspense, useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";
import { usePreviewMode } from "@/lib/overlay-preview";
import { useDataFeed } from "../../useDataFeed";
import {
  topScorersSchema,
  type TopScorersPayload,
} from "@/server/overlays/schemas";
import { REALTIME } from "@/server/overlays/registry";
import { ENTER } from "@/lib/motion";

/**
 * Audit Slice 1 (2026-04-24) — `/overlay/top-scorers` (Golden Pad).
 *
 * LIVE feed: `/api/broadcast/sessions/:id/top-scorers?t=<view_token>`.
 * Realtime wake-up via the same `public:standings:<seasonId>` channel as
 * the leaderboard (recompute_standings fires after every match_results
 * write, which is the same moment per-player goals change).
 */

export const dynamic = "force-dynamic";

export default function TopScorersPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type TopScorersBody = {
  payload: TopScorersPayload;
  seasonId: string;
  channel: string;
};

function Inner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const viewToken = sp?.get("t") ?? null;

  const preview = usePreviewMode();

  const url = sessionId
    ? `/api/broadcast/sessions/${encodeURIComponent(sessionId)}/top-scorers${
        viewToken ? `?t=${encodeURIComponent(viewToken)}` : ""
      }`
    : null;

  const [channel, setChannel] = useState<string | null>(null);

  const feed = useDataFeed<TopScorersBody | null>(
    useMemo(
      () => ({
        url,
        channels: { standings: channel },
        events: [REALTIME.eventStandingsChanged],
      }),
      [url, channel],
    ),
    (body) => {
      if (!body || typeof body !== "object") return null;
      const b = body as {
        payload: unknown;
        seasonId: unknown;
        channel: unknown;
      };
      const parsed = topScorersSchema.safeParse(b.payload);
      if (!parsed.success) return null;
      return {
        payload: parsed.data,
        seasonId: typeof b.seasonId === "string" ? b.seasonId : "",
        channel: typeof b.channel === "string" ? b.channel : "",
      };
    },
  );

  useEffect(() => {
    if (feed.data?.channel && feed.data.channel !== channel) {
      setChannel(feed.data.channel);
    }
  }, [feed.data?.channel, channel]);

  const active: TopScorersPayload | null = preview.enabled
    ? (() => {
        const parsed = topScorersSchema.safeParse(preview.payload);
        return parsed.success ? parsed.data : null;
      })()
    : (feed.data?.payload ?? null);

  const motionKey = preview.enabled
    ? `preview-${preview.cycle}`
    : `${feed.fetchCount}-${active?.rows.length ?? 0}`;

  return (
    <OverlayFrame>
      <AnimatePresence mode="wait">
        {active ? (
          <motion.div
            key={motionKey}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ ...ENTER, duration: 0.5 }}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(820px, 80vw)",
              background: "rgba(5,6,7,0.95)",
              border: "1px solid var(--ink-4)",
              padding: "32px 48px",
              color: "var(--chalk-0)",
              borderRadius: 8,
              pointerEvents: "auto",
            }}
            data-testid="top-scorers"
          >
            <div
              className="font-broadcast-display"
              style={{
                fontSize: 56,
                color: "var(--primary)",
                marginBottom: 24,
                letterSpacing: "2px",
              }}
            >
              TOP 10 · GOLDEN PAD
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {active.rows.length === 0 ? (
                <div
                  style={{ color: "var(--chalk-3)" }}
                  data-testid="top-scorers-empty"
                >
                  NO SCORERS YET
                </div>
              ) : (
                active.rows.map((r) => (
                  <div
                    key={r.rank}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "48px 1fr 80px",
                      alignItems: "center",
                      padding: "10px 14px",
                      background:
                        r.rank === 1 ? "var(--primary-glow)" : "var(--ink-1)",
                      borderRadius: 4,
                    }}
                    data-testid={`top-scorers-row-${r.rank}`}
                  >
                    <span
                      className="tabular"
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: r.rank === 1 ? "#ffd24a" : "var(--chalk-2)",
                      }}
                    >
                      {r.rank}
                    </span>
                    <span
                      className="font-broadcast-accent"
                      style={{ fontSize: 20 }}
                    >
                      {r.displayName}
                    </span>
                    <span
                      className="tabular"
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        color: "var(--primary)",
                        textAlign: "right",
                      }}
                    >
                      {r.goals}
                    </span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </OverlayFrame>
  );
}
