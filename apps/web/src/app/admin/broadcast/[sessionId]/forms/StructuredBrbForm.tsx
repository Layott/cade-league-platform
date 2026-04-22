"use client";

import { useState } from "react";
import { PrimaryButton } from "@/components/admin/buttons";
import { inputClass } from "@/components/admin/FormField";
import { triggerOverlayAction } from "../../actions";

/**
 * Plan 45 — Structured layout_brb_full form.
 *
 * Resume countdown (minutes + seconds, default 3:00). Optional ad video
 * URL + socials + free-text message. On submit we compute `resumeAt` ISO
 * (Date.now() + duration) since layoutBrbFullSchema expects a datetime
 * string, and keep the other fields only when non-empty so the Zod schema
 * doesn't reject empty strings on optional `.url()` validators.
 */
export function StructuredBrbForm({
  sessionId,
  isLive,
}: {
  sessionId: string;
  isLive: boolean;
}) {
  const [mins, setMins] = useState<number>(3);
  const [secs, setSecs] = useState<number>(0);
  const [message, setMessage] = useState<string>("BE RIGHT BACK");
  const [adVideoUrl, setAdVideoUrl] = useState<string>("");
  const [twitter, setTwitter] = useState<string>("");
  const [instagram, setInstagram] = useState<string>("");

  const totalSeconds = Math.max(0, Math.floor(mins) * 60 + Math.floor(secs));
  const resumeAt = new Date(Date.now() + totalSeconds * 1000).toISOString();

  const socials: Record<string, string> = {};
  if (twitter.trim()) socials.twitter = twitter.trim();
  if (instagram.trim()) socials.instagram = instagram.trim();

  const payload: Record<string, unknown> = { resumeAt };
  if (message.trim()) payload.message = message.trim();
  if (adVideoUrl.trim()) payload.adVideoUrl = adVideoUrl.trim();
  if (Object.keys(socials).length) payload.socials = socials;

  return (
    <div className="space-y-3" data-testid="structured-brb">
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
            data-testid="brb-minutes"
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
            data-testid="brb-seconds"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Message (optional)
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={200}
          className={inputClass}
          data-testid="brb-message"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Ad video URL (optional)
        <input
          type="url"
          value={adVideoUrl}
          onChange={(e) => setAdVideoUrl(e.target.value)}
          placeholder="https://…/ad.mp4"
          className={inputClass}
          data-testid="brb-ad"
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Twitter handle
          <input
            type="text"
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
            placeholder="@cade_league"
            className={inputClass}
            data-testid="brb-twitter"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Instagram handle
          <input
            type="text"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            placeholder="@cade_league"
            className={inputClass}
            data-testid="brb-instagram"
          />
        </label>
      </div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Resumes in {totalSeconds}s
      </div>
      <form action={triggerOverlayAction} className="flex justify-end">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="templateKey" value="layout_brb_full" />
        <input type="hidden" name="payload" value={JSON.stringify(payload)} />
        <PrimaryButton
          type="submit"
          size="sm"
          disabled={!isLive}
          data-testid="brb-trigger"
        >
          Trigger
        </PrimaryButton>
      </form>
    </div>
  );
}
