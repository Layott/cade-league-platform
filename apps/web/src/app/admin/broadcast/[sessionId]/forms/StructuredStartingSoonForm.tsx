"use client";

import { useState } from "react";
import { PrimaryButton } from "@/components/admin/buttons";
import { inputClass } from "@/components/admin/FormField";
import { AssetUploader } from "@/components/broadcast/AssetUploader";
import { OffTriggerButton } from "@/components/broadcast/OffTriggerButton";
import { triggerOverlayAction } from "../../actions";

/**
 * Plan 45 — Structured starting_soon_timer form.
 *
 * Admin enters minutes + seconds; form computes `startsAt = Date.now() +
 * duration` at submit time. Optional ad video URL + poster URL. The poster
 * field isn't in the Zod schema but is retained in the payload as a
 * harmless sidecar — consumers that don't need it ignore it.
 */
export function StructuredStartingSoonForm({
  sessionId,
  isLive,
}: {
  sessionId: string;
  isLive: boolean;
}) {
  const [mins, setMins] = useState<number>(5);
  const [secs, setSecs] = useState<number>(0);
  const [adVideoUrl, setAdVideoUrl] = useState<string>("");
  const [posterUrl, setPosterUrl] = useState<string>("");

  const totalSeconds = Math.max(0, Math.floor(mins) * 60 + Math.floor(secs));
  const startsAt = new Date(Date.now() + totalSeconds * 1000).toISOString();

  const payload: Record<string, unknown> = { startsAt };
  if (adVideoUrl.trim()) payload.adVideoUrl = adVideoUrl.trim();
  if (posterUrl.trim()) payload.posterUrl = posterUrl.trim();

  return (
    <div className="space-y-3" data-testid="structured-starting-soon">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Minutes
          <input
            type="number"
            min={0}
            max={60}
            value={mins}
            onChange={(e) => setMins(Number(e.target.value) || 0)}
            className={inputClass}
            data-testid="starting-soon-minutes"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Seconds
          <input
            type="number"
            min={0}
            max={59}
            value={secs}
            onChange={(e) => setSecs(Number(e.target.value) || 0)}
            className={inputClass}
            data-testid="starting-soon-seconds"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Ad video URL (optional)
        <AssetUploader
          kind="video"
          label="ad video"
          onUploaded={(url) => setAdVideoUrl(url)}
          data-testid="starting-soon-ad-upload"
        />
        <input
          type="url"
          value={adVideoUrl}
          onChange={(e) => setAdVideoUrl(e.target.value)}
          placeholder="https://…/ad.mp4"
          className={inputClass}
          data-testid="starting-soon-ad"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Poster URL (optional)
        <AssetUploader
          kind="image"
          label="poster"
          onUploaded={(url) => setPosterUrl(url)}
          data-testid="starting-soon-poster-upload"
        />
        <input
          type="url"
          value={posterUrl}
          onChange={(e) => setPosterUrl(e.target.value)}
          placeholder="https://…/poster.jpg"
          className={inputClass}
          data-testid="starting-soon-poster"
        />
      </label>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Resolves to {totalSeconds}s from now
      </div>
      <div className="flex items-center justify-end gap-2">
        <OffTriggerButton
          templateKey="starting_soon_timer"
          sessionId={sessionId}
          disabled={!isLive}
          data-testid="starting-soon-off"
        />
        <form action={triggerOverlayAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="templateKey" value="starting_soon_timer" />
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />
          <PrimaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="starting-soon-trigger"
          >
            Trigger
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}
