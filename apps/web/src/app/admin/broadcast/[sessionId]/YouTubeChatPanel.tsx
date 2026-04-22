"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Plan 44 — YouTube live-chat picker + Feature-on-stream panel.
 *
 * Two modes:
 *   1. Unbound — "Pick a live stream" CTA. Clicking loads the current live
 *      videos from `/api/youtube/live`. Click one → POST /api/youtube/bind
 *      → re-renders in bound mode.
 *   2. Bound — polls `/api/youtube/chat` every `pollingIntervalMillis`
 *      (from YouTube's latest response; default 3000). Renders message
 *      list newest-first with a "Feature on stream" button per row.
 *
 * Polling is paused when the tab is hidden (document.visibilityState) so
 * we don't burn quota on invisible admin tabs.
 */

export type YouTubeChatPanelProps = {
  sessionId: string;
  initialVideoId: string | null;
  initialLiveChatId: string | null;
};

type LiveVideo = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  liveChatId: string;
  startedAt: string | null;
};

type ChatMessage = {
  id: string;
  authorName: string;
  authorPhotoUrl: string | null;
  text: string;
  postedAt: string;
};

type ChatResult = {
  videoId: string;
  messages: ChatMessage[];
  nextPageToken: string | null;
  pollingIntervalMillis: number;
};

const DEFAULT_POLL_MS = 3000;

export function YouTubeChatPanel({
  sessionId,
  initialVideoId,
  initialLiveChatId,
}: YouTubeChatPanelProps) {
  const [bound, setBound] = useState<boolean>(
    initialVideoId != null && initialLiveChatId != null,
  );
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(
    initialVideoId,
  );
  const [liveVideos, setLiveVideos] = useState<LiveVideo[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pollMs, setPollMs] = useState<number>(DEFAULT_POLL_MS);
  const [error, setError] = useState<string | null>(null);
  const [featuringId, setFeaturingId] = useState<string | null>(null);
  const [slot, setSlot] = useState<"primary" | "secondary">("primary");
  const [displaySeconds, setDisplaySeconds] = useState<number>(10);

  const pageTokenRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // --- Picker: load currently-live videos ----------------------------------
  const loadLiveVideos = useCallback(async () => {
    setError(null);
    setLiveVideos(null);
    try {
      const res = await fetch(
        `/api/youtube/live?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { videos: LiveVideo[] };
      setLiveVideos(body.videos);
    } catch (e) {
      setError((e as Error).message);
      setLiveVideos([]);
    }
  }, [sessionId]);

  // --- Bind + Unbind -------------------------------------------------------
  const bind = useCallback(
    async (v: LiveVideo) => {
      setError(null);
      try {
        const res = await fetch("/api/youtube/bind", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            videoId: v.videoId,
            liveChatId: v.liveChatId,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setCurrentVideoId(v.videoId);
        setBound(true);
        setLiveVideos(null);
        setMessages([]);
        pageTokenRef.current = null;
        seenIdsRef.current = new Set();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [sessionId],
  );

  const unbind = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/youtube/unbind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setBound(false);
      setCurrentVideoId(null);
      setMessages([]);
      pageTokenRef.current = null;
      seenIdsRef.current = new Set();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sessionId]);

  // --- Chat polling loop ---------------------------------------------------
  useEffect(() => {
    if (!bound) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        // Skip fetch while tab is hidden — save quota. Re-schedule.
        timer = setTimeout(tick, pollMs);
        return;
      }
      try {
        const url = new URL("/api/youtube/chat", window.location.origin);
        url.searchParams.set("sessionId", sessionId);
        if (pageTokenRef.current) {
          url.searchParams.set("pageToken", pageTokenRef.current);
        }
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as ChatResult;
        if (cancelled) return;
        pageTokenRef.current = body.nextPageToken;
        setPollMs(body.pollingIntervalMillis || DEFAULT_POLL_MS);
        if (body.messages.length > 0) {
          setMessages((prev) => {
            const seen = seenIdsRef.current;
            const fresh = body.messages.filter((m) => {
              if (seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
            if (fresh.length === 0) return prev;
            // newest-first — reverse the API order + prepend
            return [...fresh.reverse(), ...prev].slice(0, 200);
          });
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, pollMs);
        }
      }
    };

    // First tick immediately.
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bound, sessionId, pollMs]);

  // --- Feature on stream ---------------------------------------------------
  const feature = useCallback(
    async (m: ChatMessage) => {
      setFeaturingId(m.id);
      setError(null);
      try {
        const res = await fetch("/api/broadcast/feature-comment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            messageId: m.id,
            authorName: m.authorName,
            authorPhotoUrl: m.authorPhotoUrl ?? undefined,
            message: m.text,
            postedAt: m.postedAt,
            displaySeconds,
            slot,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        // Debounce: keep button disabled ~2 s after success.
        setTimeout(() => setFeaturingId(null), 2000);
      } catch (e) {
        setError((e as Error).message);
        setFeaturingId(null);
      }
    },
    [sessionId, slot, displaySeconds],
  );

  // --- Render --------------------------------------------------------------
  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid="youtube-chat-panel"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
            YouTube Chat
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            {bound && currentVideoId
              ? `Bound to video ${currentVideoId}`
              : "Not monitoring a stream"}
          </div>
        </div>
        {bound ? (
          <button
            type="button"
            onClick={unbind}
            className="rounded-sm border border-[var(--flare)]/45 bg-transparent px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--flare)] hover:bg-[var(--flare)]/12"
            data-testid="yt-unbind-btn"
          >
            Unbind
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          className="mb-3 rounded-sm border border-[var(--flare)]/50 bg-[var(--flare)]/8 px-3 py-2 text-[11px] text-[var(--flare)]"
          data-testid="yt-error"
        >
          {error}
        </div>
      ) : null}

      {!bound ? (
        <div className="space-y-3" data-testid="yt-picker">
          {liveVideos === null ? (
            <button
              type="button"
              onClick={loadLiveVideos}
              className="rounded-sm border border-[var(--signal)]/45 bg-transparent px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:bg-[var(--signal)]/12"
              data-testid="yt-load-videos-btn"
            >
              Pick a live stream
            </button>
          ) : liveVideos.length === 0 ? (
            <div className="text-center text-[11px] text-[var(--chalk-3)]">
              No live streams right now.
              <button
                type="button"
                onClick={loadLiveVideos}
                className="ml-2 text-[var(--signal)] underline"
              >
                Refresh
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {liveVideos.map((v) => (
                <li
                  key={v.videoId}
                  className="flex items-center gap-3 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-2"
                  data-testid={`yt-live-video-${v.videoId}`}
                >
                  {v.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.thumbnailUrl}
                      alt=""
                      className="h-12 w-20 flex-shrink-0 object-cover"
                    />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs font-semibold text-[var(--chalk-0)]">
                      {v.title}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                      {v.videoId}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => bind(v)}
                    className="rounded-sm border border-[var(--signal)]/45 bg-transparent px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:bg-[var(--signal)]/12"
                    data-testid={`yt-bind-${v.videoId}`}
                  >
                    Bind
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="yt-chat-feed">
          <div className="flex flex-wrap items-center gap-3 rounded-sm border border-[var(--ink-4)]/50 bg-[var(--ink-3)]/30 p-2 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            <fieldset className="flex items-center gap-3">
              <span>Slot</span>
              <label className="flex items-center gap-1 normal-case text-[10px] text-[var(--chalk-1)]">
                <input
                  type="radio"
                  name="yt-slot"
                  value="primary"
                  checked={slot === "primary"}
                  onChange={() => setSlot("primary")}
                />
                primary
              </label>
              <label className="flex items-center gap-1 normal-case text-[10px] text-[var(--chalk-1)]">
                <input
                  type="radio"
                  name="yt-slot"
                  value="secondary"
                  checked={slot === "secondary"}
                  onChange={() => setSlot("secondary")}
                />
                secondary
              </label>
            </fieldset>
            <label className="ml-auto flex items-center gap-2 normal-case text-[10px] text-[var(--chalk-1)]">
              <span>Display (s)</span>
              <input
                type="number"
                min={3}
                max={30}
                value={displaySeconds}
                onChange={(e) =>
                  setDisplaySeconds(
                    Math.max(3, Math.min(30, Number(e.target.value) || 10)),
                  )
                }
                className="w-14 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-2)] px-1 py-0.5 text-right font-mono text-[10px] text-[var(--chalk-0)]"
              />
            </label>
            <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Poll {pollMs} ms
            </span>
          </div>
          {messages.length === 0 ? (
            <div className="rounded-sm border border-[var(--ink-4)]/40 bg-[var(--ink-3)]/20 p-4 text-center text-[11px] text-[var(--chalk-3)]">
              Listening for messages…
            </div>
          ) : (
            <ul className="max-h-[360px] space-y-2 overflow-y-auto">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-3 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-2"
                  data-testid={`yt-msg-${m.id}`}
                >
                  {m.authorPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.authorPhotoUrl}
                      alt=""
                      className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--ink-4)] text-[10px] font-bold text-[var(--chalk-1)]">
                      {m.authorName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[var(--chalk-0)]">
                      {m.authorName}{" "}
                      <span className="ml-1 font-mono text-[9px] text-[var(--chalk-3)]">
                        {formatAgo(m.postedAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 break-words text-[11px] text-[var(--chalk-1)]">
                      {m.text}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => feature(m)}
                    disabled={featuringId === m.id}
                    className="flex-shrink-0 rounded-sm border border-[var(--signal)]/45 bg-transparent px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:bg-[var(--signal)]/12 disabled:cursor-wait disabled:opacity-60"
                    data-testid={`yt-feature-${m.id}`}
                  >
                    {featuringId === m.id ? "Featuring…" : "Feature on stream"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
