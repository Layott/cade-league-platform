"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { REALTIME, type TemplateKey } from "@/server/overlays/registry";

/**
 * Shared hook for every /overlay/<key>/page.tsx client component.
 *
 * Flow:
 *   1. Mount — fetch current state from `/api/broadcast/sessions/:id/active?template_key=`.
 *   2. Subscribe to `overlay:<sessionId>` realtime channel.
 *   3. On `overlay.triggered` with matching templateKey → replace payload.
 *   4. On `overlay.cleared` matching current event id → clear payload.
 *   5. On `session.ended` → clear and show nothing.
 *
 * The payload itself is an unvalidated `Record<string, unknown>` here
 * and the calling page re-validates via the template's Zod schema. The
 * hook only cares about lifecycle.
 */

export type OverlayState = {
  eventId: string | null;
  payload: Record<string, unknown> | null;
  connected: boolean;
  lastEventAt: number | null;
};

type ActiveResponse = {
  id: string;
  payload: Record<string, unknown>;
  triggered_at: string;
} | null;

/**
 * Plan 42.1 — optional `slotFilter` lets overlay pages opt into slot
 * routing. When a slot is provided, the hook only accepts payloads whose
 * `slot` field matches (payloads without a `slot` default to 'primary').
 * Hydration picks the first matching active row from the list endpoint
 * (the single-active endpoint doesn't discriminate by slot).
 */
export function useOverlayChannel(
  sessionId: string | null,
  templateKey: TemplateKey,
  slotFilter?: "primary" | "secondary",
): OverlayState {
  const [state, setState] = useState<OverlayState>({
    eventId: null,
    payload: null,
    connected: false,
    lastEventAt: null,
  });

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    // Helper: does an incoming payload match our slot filter?
    const slotMatches = (p: Record<string, unknown> | null | undefined) => {
      if (!slotFilter) return true;
      const s = (p as { slot?: string } | null | undefined)?.slot ?? "primary";
      return s === slotFilter;
    };

    // 1. Hydrate from the REST endpoint. When slot filtering is active,
    //    forward `?slot=` so the server-side helper picks the slot-tagged
    //    row (or a slot-less row when slot===primary, for Plan 42 back-
    //    compat).
    const baseUrl = `/api/broadcast/sessions/${encodeURIComponent(
      sessionId,
    )}/active?template_key=${encodeURIComponent(templateKey)}`;
    const activeUrl = slotFilter ? `${baseUrl}&slot=${slotFilter}` : baseUrl;

    fetch(activeUrl, { cache: "no-store" })
      .then((r) => r.json() as Promise<ActiveResponse>)
      .then((active) => {
        if (cancelled) return;
        if (active && active.payload && slotMatches(active.payload)) {
          setState((s) => ({
            ...s,
            eventId: active.id,
            payload: active.payload,
            lastEventAt: Date.now(),
          }));
        }
      })
      .catch(() => {
        // hydration failure is non-fatal; realtime will eventually fill in.
      });

    // 2. Subscribe to realtime channel.
    const sb = getBrowserSupabase();
    const channel = sb.channel(REALTIME.channel(sessionId), {
      config: { broadcast: { self: false } },
    });

    channel
      .on(
        "broadcast",
        { event: REALTIME.eventTriggered },
        (msg: { payload: { eventId: string; templateKey: string; payload: Record<string, unknown> } }) => {
          const p = msg.payload;
          if (!p || p.templateKey !== templateKey) return;
          if (!slotMatches(p.payload)) return;
          setState({
            eventId: p.eventId,
            payload: p.payload,
            connected: true,
            lastEventAt: Date.now(),
          });
        },
      )
      .on(
        "broadcast",
        { event: REALTIME.eventCleared },
        (msg: { payload: { eventId: string; templateKey: string | null } }) => {
          const p = msg.payload;
          setState((s) => {
            if (!s.eventId) return s;
            // If the cleared event matches what we have OR the templateKey
            // broadcast matches, clear. Matching by id is stricter but the
            // cleared broadcast payload may not include the template key
            // in older rows.
            if (s.eventId === p.eventId) {
              return { ...s, eventId: null, payload: null };
            }
            return s;
          });
        },
      )
      .on(
        "broadcast",
        { event: REALTIME.eventSessionEnded },
        () => {
          setState({
            eventId: null,
            payload: null,
            connected: true,
            lastEventAt: Date.now(),
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setState((s) => ({ ...s, connected: true }));
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState((s) => ({ ...s, connected: false }));
        }
      });

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [sessionId, templateKey, slotFilter]);

  return state;
}
