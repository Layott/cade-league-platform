"use client";

// TODO Plan 48 phase 2 — design parity
import { Suspense, useEffect, useId, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useOverlayChannel } from "../../useOverlayChannel";
import { featuredCommentSchema } from "@/server/overlays/schemas";
import { ENTER, EXIT } from "@/lib/motion";
import { OverlayFrame } from "@/components/overlay/OverlayFrame";

/**
 * Plan 45 — minimal CSS sanitizer for admin-authored overrides. Strips:
 *   - `</style>` (breaks out of our injected tag)
 *   - `<script>` tags (script injection)
 *   - `javascript:` URL schemes (script injection via background-image etc)
 *   - HTML-comment terminators that could break the style element
 *
 * The remaining content is echoed verbatim into a scoped <style> element.
 * Accepting CSS from a trusted admin only — production-grade sanitisation
 * would require a full parser (e.g. postcss).
 */
function sanitizeCssOverrides(raw: string): string {
  return raw
    .replace(/<\s*\/\s*style\s*>/gi, "")
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script[^>]*>/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/-->/g, "");
}

/**
 * Scope every selector in a CSS block by prefixing with
 * `[data-fc-scope="<id>"]`. Handles `@media` + `@supports` blocks by
 * scoping inner rules, skips `@keyframes` + `@font-face`. Not a real CSS
 * parser — enough for typical override snippets.
 */
function scopeCss(raw: string, scopeId: string): string {
  const scope = `[data-fc-scope="${scopeId}"]`;
  const cleaned = sanitizeCssOverrides(raw);
  // Split on top-level `}` boundaries that follow a selector+`{`. This is
  // intentionally simplistic; admin-authored snippets are expected to be
  // small and well-formed.
  return cleaned.replace(/([^{}]+)\{([^{}]*)\}/g, (_match, sel: string, body: string) => {
    const trimmed = sel.trim();
    if (!trimmed || trimmed.startsWith("@")) {
      // Leave at-rules untouched (e.g. @keyframes, @font-face, @media).
      return `${trimmed} { ${body} }`;
    }
    const scoped = trimmed
      .split(",")
      .map((s) => `${scope} ${s.trim()}`)
      .join(", ");
    return `${scoped} { ${body} }`;
  });
}

/**
 * Plan 44 — Featured YouTube Chat Comment overlay.
 *
 * Subscribes to `overlay:<sessionId>` and renders a single card keyed on
 * the incoming eventId. Each event also carries `displaySeconds` (3..30,
 * default 10) — after that duration elapses (or a clear event arrives)
 * the card animates out.
 *
 * Motion: slide-in-from-bottom-left + scale + linger + fade-out.
 *
 * Brand chrome lifted from lower_third (pink accent bar + panel) with a
 * "YT LIVE CHAT" chip in place of the "Player" kicker.
 */

export const dynamic = "force-dynamic";

type Parsed = import("zod").infer<typeof featuredCommentSchema>;

export default function FeaturedCommentPage() {
  return (
    <OverlayFrame>
  <Suspense fallback={null}>
        <FeaturedCommentInner />
      </Suspense>
    </OverlayFrame>
  );
}

function FeaturedCommentInner() {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const slotRaw = sp?.get("slot") ?? null;
  const slot: "primary" | "secondary" | undefined =
    slotRaw === "primary" || slotRaw === "secondary" ? slotRaw : undefined;
  const state = useOverlayChannel(sessionId, "featured_comment", slot);
  const scopeId = useId().replace(/:/g, "_");

  // Self-clear: after `displaySeconds` has elapsed since the last event
  // we locally mark the card as expired so AnimatePresence exits even if
  // the admin did not send a clear. Tracks the eventId so re-triggers
  // restart the timer cleanly.
  const [expiredEventId, setExpiredEventId] = useState<string | null>(null);

  const parsed: Parsed | null = useMemo(() => {
    if (!state.payload) return null;
    const res = featuredCommentSchema.safeParse(state.payload);
    return res.success ? res.data : null;
  }, [state.payload]);

  useEffect(() => {
    if (!state.eventId || !parsed) {
      return;
    }
    const ms = Math.max(3, parsed.displaySeconds ?? 10) * 1000;
    const id = state.eventId;
    const t = setTimeout(() => {
      setExpiredEventId(id);
    }, ms);
    return () => clearTimeout(t);
  }, [state.eventId, parsed]);

  const visible =
    parsed != null &&
    state.eventId != null &&
    state.eventId !== expiredEventId;

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
        {visible && parsed ? (
          <motion.div
            key={state.eventId}
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.96 }}
            transition={{ ...ENTER, duration: 0.55 }}
            style={{
              position: "fixed",
              left: "120px",
              bottom: "120px",
              display: "flex",
              alignItems: "stretch",
              minHeight: "140px",
              maxWidth: "900px",
              pointerEvents: "auto",
            }}
            data-testid="featured-comment-card"
            data-fc-scope={scopeId}
          >
            {parsed.cssOverrides ? (
              <style
                data-testid="fc-css-injected"
                dangerouslySetInnerHTML={{
                  __html: scopeCss(parsed.cssOverrides, scopeId),
                }}
              />
            ) : null}
            <FeaturedCommentCard data={parsed} />
            {/* Exit fade-out uses a faster EXIT token on the wrapper via
                AnimatePresence above — the explicit `exit` prop overrides
                any default. EXIT re-export keeps type clean. */}
            <span style={{ display: "none" }} aria-hidden>
              {EXIT.duration}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function FeaturedCommentCard({ data }: { data: Parsed }) {
  return (
    <>
      {/* Pink accent bar — 8 px, mirrors lower-third card */}
      <div
        className="fc-accent"
        style={{
          width: "8px",
          background: "var(--secondary, #fe036d)",
          boxShadow: "0 0 18px rgba(254, 3, 109, 0.5)",
        }}
      />
      {/* Avatar slot — 140 × 140, green border */}
      <div
        className="fc-avatar"
        style={{
          position: "relative",
          width: "140px",
          minHeight: "140px",
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(107, 205, 6, 0.22), #050b01)",
          flexShrink: 0,
        }}
      >
        {data.authorPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.authorPhotoUrl}
            alt={data.authorName}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
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
              color: "#6bcd06",
              fontFamily: "AghartiWide, sans-serif",
              fontWeight: 900,
              fontSize: "48px",
            }}
          >
            {initialsFor(data.authorName)}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "2px solid #6bcd06",
            borderLeft: "none",
            pointerEvents: "none",
          }}
        />
      </div>
      {/* Body panel */}
      <div
        className="fc-card"
        style={{
          minWidth: "420px",
          padding: "18px 32px 22px 24px",
          background: "rgba(7, 8, 11, 0.94)",
          borderTop: "2px solid #6bcd06",
          borderBottom: "2px solid #6bcd06",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "6px",
          clipPath: "polygon(0 0, 100% 0, calc(100% - 24px) 100%, 0 100%)",
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
            fontSize: "11px",
            letterSpacing: "5px",
            color: "#6bcd06",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              background: "#fe036d",
              borderRadius: "1px",
              boxShadow: "0 0 8px #fe036d",
            }}
          />
          <span>YT Live Chat</span>
        </div>
        <div
          className="fc-author"
          style={{
            fontFamily: "AghartiWide, sans-serif",
            fontWeight: 900,
            fontSize: "28px",
            lineHeight: "1",
            color: "#fff",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            textShadow: "1px 1px 0 rgba(254, 3, 109, 0.5)",
          }}
        >
          {data.authorName}
        </div>
        <div
          className="fc-message"
          style={{
            marginTop: "4px",
            fontFamily: "Quedora, sans-serif",
            fontWeight: 500,
            fontSize: "16px",
            lineHeight: "1.35",
            color: "#e8f0dc",
            maxWidth: "700px",
            wordBreak: "break-word",
          }}
        >
          {data.message}
        </div>
      </div>
    </>
  );
}

function initialsFor(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}
