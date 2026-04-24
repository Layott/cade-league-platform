"use client";

import { Suspense, useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";
import { usePreviewMode } from "@/lib/overlay-preview";
import { useDataFeed } from "../../useDataFeed";
import {
  matchScoresDaySchema,
  type MatchScoresDayPayload,
} from "@/server/overlays/schemas";
import { REALTIME } from "@/server/overlays/registry";
import { ENTER } from "@/lib/motion";

/**
 * Audit Slice 1 (2026-04-24) — `/overlay/match-scores-day`.
 *
 * Dual-channel feed: the overlay subscribes to BOTH
 *   1. `public:standings:<seasonId>` — `standings.changed` from the DB
 *      recompute function after every match-result write.
 *   2. `overlay:<sessionId>` — `score.changed`, `match.ended`,
 *      `match.started`, `session.ended` from the broadcast panel.
 *
 * Either signal triggers a re-fetch (debounced 200 ms in useDataFeed).
 */

export const dynamic = "force-dynamic";

export default function MatchScoresDayPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type MatchScoresDayBody = {
  payload: MatchScoresDayPayload;
  seasonId: string | null;
  channels: { standings: string | null; session: string | null };
};

function Inner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const viewToken = sp?.get("t") ?? null;

  const preview = usePreviewMode();

  const url = sessionId
    ? `/api/broadcast/sessions/${encodeURIComponent(
        sessionId,
      )}/match-scores-day${
        viewToken ? `?t=${encodeURIComponent(viewToken)}` : ""
      }`
    : null;

  const [channels, setChannels] = useState<{
    standings: string | null;
    session: string | null;
  }>({ standings: null, session: null });

  const feed = useDataFeed<MatchScoresDayBody | null>(
    useMemo(
      () => ({
        url,
        channels,
        events: [
          REALTIME.eventStandingsChanged,
          REALTIME.eventScoreChanged,
          REALTIME.eventMatchStarted,
          REALTIME.eventMatchEnded,
          REALTIME.eventSessionEnded,
        ],
      }),
      [url, channels],
    ),
    (body) => {
      if (!body || typeof body !== "object") return null;
      const b = body as {
        payload: unknown;
        seasonId: unknown;
        channels: unknown;
      };
      const parsed = matchScoresDaySchema.safeParse(b.payload);
      if (!parsed.success) return null;
      const ch =
        b.channels && typeof b.channels === "object"
          ? (b.channels as { standings?: unknown; session?: unknown })
          : {};
      return {
        payload: parsed.data,
        seasonId: typeof b.seasonId === "string" ? b.seasonId : null,
        channels: {
          standings: typeof ch.standings === "string" ? ch.standings : null,
          session: typeof ch.session === "string" ? ch.session : null,
        },
      };
    },
  );

  useEffect(() => {
    const next = feed.data?.channels;
    if (!next) return;
    if (
      next.standings !== channels.standings ||
      next.session !== channels.session
    ) {
      setChannels({ standings: next.standings, session: next.session });
    }
  }, [feed.data?.channels, channels]);

  const active: MatchScoresDayPayload | null = preview.enabled
    ? (() => {
        const parsed = matchScoresDaySchema.safeParse(preview.payload);
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
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ ...ENTER, duration: 0.55 }}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(1200px, 92vw)",
              background: "rgba(5,6,7,0.96)",
              border: "1px solid var(--ink-4)",
              borderRadius: 8,
              padding: "28px 36px",
              color: "var(--chalk-0)",
              pointerEvents: "auto",
            }}
            data-testid="match-scores-day"
          >
            <div
              className="font-broadcast-display"
              style={{
                fontSize: 48,
                color: "var(--primary)",
                marginBottom: 20,
                letterSpacing: "2px",
              }}
            >
              {active.matchDayLabel} — SCORES
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {active.rows.length === 0 ? (
                <div
                  style={{ color: "var(--chalk-3)" }}
                  data-testid="match-scores-day-empty"
                >
                  NO MATCHES SCHEDULED
                </div>
              ) : (
                active.rows.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 160px 1fr",
                      alignItems: "center",
                      padding: "10px 14px",
                      background:
                        r.status === "in_progress"
                          ? "rgba(254, 3, 109, 0.1)"
                          : "var(--ink-1)",
                      border:
                        r.status === "in_progress"
                          ? "1px solid rgba(254,3,109,0.4)"
                          : "1px solid transparent",
                      borderRadius: 4,
                    }}
                    data-testid={`match-scores-day-row-${i}`}
                  >
                    <span
                      className="font-broadcast-accent"
                      style={{ fontSize: 20 }}
                    >
                      {r.home}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span
                        className="tabular"
                        style={{
                          fontSize: 28,
                          fontWeight: 700,
                          textAlign: "center",
                          color:
                            r.status === "in_progress"
                              ? "var(--secondary)"
                              : "var(--primary)",
                        }}
                      >
                        {r.homeScore ?? "-"} — {r.awayScore ?? "-"}
                      </span>
                      {r.status === "in_progress" ? (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--secondary)",
                            letterSpacing: "2px",
                            fontWeight: 700,
                          }}
                        >
                          LIVE
                        </span>
                      ) : r.status === "scheduled" ? (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--chalk-3)",
                            letterSpacing: "2px",
                            fontWeight: 700,
                          }}
                        >
                          SCHEDULED
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--chalk-2)",
                            letterSpacing: "2px",
                            fontWeight: 700,
                          }}
                        >
                          FT
                        </span>
                      )}
                    </div>
                    <span
                      className="font-broadcast-accent"
                      style={{ fontSize: 20, textAlign: "right" }}
                    >
                      {r.away}
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
