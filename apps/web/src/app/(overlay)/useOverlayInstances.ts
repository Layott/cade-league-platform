"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { REALTIME, type TemplateKey } from "@/server/overlays/registry";

/**
 * Plan 37 — multi-active instance hook for editable overlays
 * (currently lower_third, slots 1..3).
 *
 * Listens for `instance.triggered` and `instance.cleared` on the same
 * `overlay:<sessionId>` channel as `useOverlayChannel`. Maintains a map
 * keyed by `instanceSlot` so the page can stack three concurrent renders.
 *
 * Behavioural detail: a `triggered` event whose `instanceId` matches an
 * existing slot rewrites that slot's payload IN PLACE. The page should use
 * `instanceId` (stable across edits) as its React key so payload edits do
 * NOT re-mount + replay enter motion.
 */

export type OverlayInstance = {
  instanceId: string;
  instanceSlot: number;
  payload: Record<string, unknown>;
  triggeredAt: number;
};

export type OverlayInstancesState = {
  bySlot: Record<number, OverlayInstance | null>;
  connected: boolean;
};

type ActiveListResponse = Array<{
  id: string;
  instance_slot: number;
  payload: Record<string, unknown>;
  triggered_at: string;
}>;

const EMPTY_BY_SLOT: Record<number, OverlayInstance | null> = {
  1: null,
  2: null,
  3: null,
};

/**
 * Plan 42.1 — optional `slotFilter` narrows multi-instance overlays to
 * payloads whose `slot` field matches. Payloads without a `slot` default
 * to 'primary' (back-compat with Plan 42 single-slot).
 */
export function useOverlayInstances(
  sessionId: string | null,
  templateKey: TemplateKey,
  slotFilter?: "primary" | "secondary",
): OverlayInstancesState {
  const [state, setState] = useState<OverlayInstancesState>({
    bySlot: { ...EMPTY_BY_SLOT },
    connected: false,
  });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const slotMatches = (p: Record<string, unknown> | null | undefined) => {
      if (!slotFilter) return true;
      const s = (p as { slot?: string } | null | undefined)?.slot ?? "primary";
      return s === slotFilter;
    };

    // 1. Hydrate from REST.
    fetch(
      `/api/broadcast/sessions/${encodeURIComponent(
        sessionId,
      )}/instances?template_key=${encodeURIComponent(templateKey)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json() as Promise<ActiveListResponse>)
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        setState((s) => {
          const next: Record<number, OverlayInstance | null> = { ...s.bySlot };
          for (const r of rows) {
            if (!slotMatches(r.payload)) continue;
            next[r.instance_slot] = {
              instanceId: r.id,
              instanceSlot: r.instance_slot,
              payload: r.payload,
              triggeredAt: Date.parse(r.triggered_at) || Date.now(),
            };
          }
          return { ...s, bySlot: next };
        });
      })
      .catch(() => {
        // realtime will fill in
      });

    // 2. Subscribe.
    const sb = getBrowserSupabase();
    const channel = sb.channel(REALTIME.channel(sessionId), {
      config: { broadcast: { self: false } },
    });

    channel
      .on(
        "broadcast",
        { event: REALTIME.eventInstanceTriggered },
        (msg: {
          payload: {
            instanceId: string;
            instanceSlot: number;
            templateKey: string;
            payload: Record<string, unknown>;
          };
        }) => {
          const p = msg.payload;
          if (!p || p.templateKey !== templateKey) return;
          if (!slotMatches(p.payload)) return;
          setState((s) => ({
            ...s,
            bySlot: {
              ...s.bySlot,
              [p.instanceSlot]: {
                instanceId: p.instanceId,
                instanceSlot: p.instanceSlot,
                payload: p.payload,
                triggeredAt: Date.now(),
              },
            },
          }));
        },
      )
      .on(
        "broadcast",
        { event: REALTIME.eventInstanceCleared },
        (msg: {
          payload: {
            instanceId: string;
            instanceSlot: number;
            templateKey: string;
          };
        }) => {
          const p = msg.payload;
          if (!p || p.templateKey !== templateKey) return;
          setState((s) => ({
            ...s,
            bySlot: { ...s.bySlot, [p.instanceSlot]: null },
          }));
        },
      )
      .on(
        "broadcast",
        { event: REALTIME.eventSessionEnded },
        () => {
          setState((s) => ({ ...s, bySlot: { ...EMPTY_BY_SLOT } }));
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
