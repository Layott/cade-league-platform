"use client";

import { Suspense, useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";
import { usePreviewMode } from "@/lib/overlay-preview";
import { useDataFeed } from "../../useDataFeed";
import {
  leaderboardAnimatedSchema,
  type LeaderboardAnimatedPayload,
} from "@/server/overlays/schemas";
import { REALTIME } from "@/server/overlays/registry";
import { ENTER } from "@/lib/motion";

/**
 * Audit Slice 1 (2026-04-24) — `/overlay/leaderboard-animated`.
 *
 * LIVE-data overlay. Fetches from
 * `/api/broadcast/sessions/:id/leaderboard?t=<view_token>` on mount +
 * re-fetches whenever the DB `recompute_standings()` function pushes
 * `standings.changed` on `public:standings:<seasonId>`.
 *
 * Preview mode (`?preview=1`) still works: usePreviewMode supplies a
 * payload from the URL's `payload=` base64 param + a cycle counter so
 * the motion restages every 8 s.
 */

export const dynamic = "force-dynamic";

export default function LeaderboardAnimatedPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type LeaderboardBody = {
  payload: LeaderboardAnimatedPayload | null;
  seasonId: string;
  channel: string;
};

function Inner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const viewToken = sp?.get("t") ?? null;

  const preview = usePreviewMode();

  const url = sessionId
    ? `/api/broadcast/sessions/${encodeURIComponent(sessionId)}/leaderboard${
        viewToken ? `?t=${encodeURIComponent(viewToken)}` : ""
      }`
    : null;

  // Channel is learned from the first fetch body; promote it into the
  // hook options on the next render so the Realtime subscription wires
  // itself automatically.
  const [channel, setChannel] = useState<string | null>(null);

  const feed = useDataFeed<LeaderboardBody | null>(
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
      const payload = b.payload
        ? leaderboardAnimatedSchema.safeParse(b.payload)
        : null;
      return {
        payload: payload && payload.success ? payload.data : null,
        seasonId: typeof b.seasonId === "string" ? b.seasonId : "",
        channel: typeof b.channel === "string" ? b.channel : "",
      };
    },
  );

  // Promote channel to state once we learn it from the first fetch.
  useEffect(() => {
    if (feed.data?.channel && feed.data.channel !== channel) {
      setChannel(feed.data.channel);
    }
  }, [feed.data?.channel, channel]);

  const active: LeaderboardAnimatedPayload | null = preview.enabled
    ? (() => {
        const parsed = leaderboardAnimatedSchema.safeParse(preview.payload);
        return parsed.success ? parsed.data : null;
      })()
    : (feed.data?.payload ?? null);

  const motionKey = preview.enabled
    ? `preview-${preview.cycle}`
    : `${feed.fetchCount}-${active?.rows.length ?? 0}`;

  return (
    <OverlayFrame>
      <AnimatePresence mode="wait">
        {active && active.rows.length > 0 ? (
          <motion.div
            key={motionKey}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ ...ENTER, duration: 0.5 }}
            style={{
              position: "absolute",
              top: "60px",
              right: "60px",
              width: "520px",
              background: "rgba(11,14,17,0.94)",
              border: "1px solid var(--ink-5)",
              borderRadius: 6,
              color: "var(--chalk-0)",
              padding: "20px 24px",
              pointerEvents: "auto",
            }}
            data-testid="leaderboard-animated"
          >
            <div
              className="font-broadcast-accent"
              style={{
                fontSize: 12,
                color: "var(--primary)",
                marginBottom: 14,
                letterSpacing: "3px",
              }}
            >
              LEADERBOARD · TOP {active.topN}
            </div>
            {active.rows.slice(0, active.topN).map((r) => (
              <div
                key={r.rank}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--ink-4)",
                  background:
                    r.rank === 1 ? "var(--primary-glow)" : "transparent",
                }}
                data-testid={`leaderboard-row-${r.rank}`}
              >
                <span
                  className="tabular"
                  style={{ width: 32, color: "var(--chalk-2)" }}
                >
                  {r.rank}
                </span>
                <span style={{ flex: 1 }}>{r.displayName}</span>
                <span
                  className="tabular"
                  style={{
                    width: 60,
                    textAlign: "right",
                    color: "var(--chalk-2)",
                  }}
                >
                  {r.gd >= 0 ? "+" : ""}
                  {r.gd}
                </span>
                <span
                  className="tabular"
                  style={{
                    width: 60,
                    textAlign: "right",
                    color: "var(--primary)",
                  }}
                >
                  {r.pts}
                </span>
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </OverlayFrame>
  );
}
