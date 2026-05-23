"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import { retriggerOverlayAction } from "@/app/admin/broadcast/v2/[sessionId]/actions";

type Variant = {
  variantId: string;
  kind: string;
  headline: string;
  detail: string;
  player: {
    playerId: string;
    displayName: string;
    slug: string;
    photoUrl: string | null;
    orgName: string | null;
    orgLogoUrl: string | null;
  } | null;
};

export type DidYouKnowControlProps = {
  sessionId: string;
  viewToken: string | null;
  active?: boolean;
};

/**
 * Producer picker for the 25-did-you-know overlay.
 *
 * Fetches up to 10 stat-driven variants from
 * `/api/broadcast/v2/sessions/<id>/did-you-know-variants` and renders
 * them as a scrollable list of mini-cards inside the standard
 * ControlCard footer. Producer clicks a variant → that variant becomes
 * the active payload AND fires Trigger in one click. Subsequent
 * Trigger clicks (without picking a different variant) re-fire the
 * same selection so animations replay.
 *
 * Hide button clears the overlay independent of which variant is
 * selected.
 */
export function DidYouKnowControl({
  sessionId,
  viewToken,
  active = false,
}: DidYouKnowControlProps) {
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
      `/api/broadcast/v2/sessions/${sessionId}/did-you-know-variants${tokenSuffix}`,
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
        didYouKnow: {
          kind: selected.kind,
          headline: selected.headline,
          detail: selected.detail,
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
          didYouKnow: {
            kind: selected.kind,
            headline: selected.headline,
            detail: selected.detail,
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
      overlayKey="25-did-you-know"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      active={active}
      liveBadge={active}
      editPanel={
        <div
          className="space-y-2"
          data-testid="did-you-know-variant-picker"
        >
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Pick a stat
            </div>
            <div className="text-[10px] text-[var(--chalk-3)]">
              {variants.length}/10 generated
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
                Generating variants…
              </div>
            ) : null}
            {variants.map((v) => {
              const isSelected = v.variantId === selectedId;
              const variantPayload = JSON.stringify({
                didYouKnow: {
                  kind: v.kind,
                  headline: v.headline,
                  detail: v.detail,
                  player: v.player,
                },
              });
              const onCardClick = () => {
                setSelectedId(v.variantId);
                postToFrame(iframeRef.current, {
                  type: "show",
                  data: {
                    payload: {
                      didYouKnow: {
                        kind: v.kind,
                        headline: v.headline,
                        detail: v.detail,
                        player: v.player,
                      },
                    },
                  },
                });
              };
              return (
                <div
                  key={v.variantId}
                  data-testid={`dyk-variant-${v.variantId}`}
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)]">
                        {v.headline}
                      </div>
                      {v.player?.displayName ? (
                        <div className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                          {v.player.displayName}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--chalk-3)]">
                      {v.detail}
                    </div>
                  </button>
                  <form
                    action={retriggerOverlayAction}
                    className="flex shrink-0 items-center px-2"
                    onSubmit={onCardClick}
                  >
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="overlayKey" value="25-did-you-know" />
                    <input type="hidden" name="payload" value={variantPayload} />
                    <button
                      type="submit"
                      data-testid={`dyk-trigger-${v.variantId}`}
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
          overlayKey="25-did-you-know"
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
