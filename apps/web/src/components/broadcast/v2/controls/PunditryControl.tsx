"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import { retriggerOverlayAction } from "@/app/admin/broadcast/v2/[sessionId]/actions";

type Variant = {
  variantId: string;
  text: string;
  author: string;
  role: string;
  player: {
    playerId: string;
    displayName: string;
    slug: string;
    photoUrl: string | null;
    orgName: string | null;
    orgLogoUrl: string | null;
  } | null;
};

export type PunditryControlProps = {
  sessionId: string;
  viewToken: string | null;
  active?: boolean;
};

/**
 * Producer picker for the 28-punditry overlay.
 *
 * Mirrors DidYouKnowControl exactly — fetches up to 24 pundit-quote
 * variants from `/api/broadcast/v2/sessions/<id>/punditry-variants`
 * and renders them as a scrollable card list with single-click
 * Trigger per row.
 */
export function PunditryControl({
  sessionId,
  viewToken,
  active = false,
}: PunditryControlProps) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tokenSuffix = viewToken ? `?t=${encodeURIComponent(viewToken)}` : "";
    fetch(
      `/api/broadcast/v2/sessions/${sessionId}/punditry-variants${tokenSuffix}`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.variants)) {
          setLoadErr("no variants returned");
          return;
        }
        setVariants(data.variants);
        if (data.variants.length > 0) setSelectedId(data.variants[0].variantId);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, viewToken]);

  const selected = variants.find((v) => v.variantId === selectedId) ?? null;

  const payload = selected
    ? JSON.stringify({
        punditryQuote: {
          text: selected.text,
          author: selected.author,
          role: selected.role,
          player: selected.player,
        },
      })
    : JSON.stringify({});

  const onOptimisticTrigger = useCallback(() => {
    if (!selected) return;
    postToFrame(iframeRef.current, {
      type: "show",
      data: {
        payload: {
          punditryQuote: {
            text: selected.text,
            author: selected.author,
            role: selected.role,
            player: selected.player,
          },
        },
      },
    });
  }, [selected]);

  const onOptimisticHide = useCallback(() => {
    postToFrame(iframeRef.current, { type: "hide" });
  }, []);

  return (
    <ControlCard
      overlayKey="28-punditry"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      active={active}
      liveBadge={active}
      editPanel={
        <div className="space-y-2" data-testid="punditry-variant-picker">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Pick a quote
            </div>
            <div className="text-[10px] text-[var(--chalk-3)]">
              {variants.length} ready
            </div>
          </div>
          {loadErr ? (
            <div className="rounded-sm border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
              Could not load variants: {loadErr}
            </div>
          ) : null}
          <div className="max-h-[260px] overflow-y-auto rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] divide-y divide-[var(--ink-4)]">
            {variants.length === 0 && !loadErr ? (
              <div className="px-3 py-3 text-[11px] text-[var(--chalk-3)]">
                Generating quotes…
              </div>
            ) : null}
            {variants.map((v) => {
              const isSelected = v.variantId === selectedId;
              const variantPayload = JSON.stringify({
                punditryQuote: {
                  text: v.text,
                  author: v.author,
                  role: v.role,
                  player: v.player,
                },
              });
              const onCardClick = () => {
                setSelectedId(v.variantId);
                postToFrame(iframeRef.current, {
                  type: "show",
                  data: {
                    payload: {
                      punditryQuote: {
                        text: v.text,
                        author: v.author,
                        role: v.role,
                        player: v.player,
                      },
                    },
                  },
                });
              };
              return (
                <div
                  key={v.variantId}
                  data-testid={`pundit-variant-${v.variantId}`}
                  data-selected={isSelected ? "true" : "false"}
                  className={
                    "flex items-stretch transition-colors " +
                    (isSelected
                      ? "bg-[var(--primary)]/20 ring-1 ring-[var(--primary)]"
                      : "hover:bg-[var(--ink-2)]")
                  }
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(v.variantId)}
                    className="block flex-1 px-3 py-2 text-left"
                  >
                    <div className="line-clamp-2 text-[11px] font-semibold leading-snug text-[var(--chalk-1)]">
                      &ldquo;{v.text}&rdquo;
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                      <span>{v.author}</span>
                      <span>{v.role}</span>
                    </div>
                  </button>
                  <form
                    action={retriggerOverlayAction}
                    className="flex shrink-0 items-center px-2"
                    onSubmit={onCardClick}
                  >
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="overlayKey" value="28-punditry" />
                    <input type="hidden" name="payload" value={variantPayload} />
                    <button
                      type="submit"
                      data-testid={`pundit-trigger-${v.variantId}`}
                      className="rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-black hover:opacity-90"
                    >
                      Trigger
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        </div>
      }
      triggerSlot={
        <ReTriggerHideButtons
          overlayKey="28-punditry"
          sessionId={sessionId}
          active={active}
          onOptimisticTrigger={onOptimisticTrigger}
          onOptimisticHide={onOptimisticHide}
          canTrigger={!!selected}
          payloadFields={
            <input type="hidden" name="payload" value={payload} />
          }
        />
      }
    />
  );
}
