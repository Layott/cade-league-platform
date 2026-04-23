"use client";

import { useState } from "react";
import { PrimaryButton } from "@/components/admin/buttons";
import { inputClass, textareaClass } from "@/components/admin/FormField";
import { OffTriggerButton } from "@/components/broadcast/OffTriggerButton";
import { triggerOverlayAction } from "../../actions";

/**
 * Plan 45 — Structured featured_comment form.
 *
 * Author + message inputs plus a scoped CSS overrides `<textarea>`. The
 * overlay page reads `payload.cssOverrides` and injects it into a `<style>`
 * element inside a `data-fc-scope` wrapper (see
 * `/overlay/featured-comment/page.tsx`).
 */
export function StructuredFeaturedCommentForm({
  sessionId,
  isLive,
}: {
  sessionId: string;
  isLive: boolean;
}) {
  const [slot, setSlot] = useState<"primary" | "secondary">("primary");
  const [authorName, setAuthorName] = useState<string>("Viewer");
  const [message, setMessage] = useState<string>("");
  const [cssOverrides, setCssOverrides] = useState<string>("");
  const [displaySeconds, setDisplaySeconds] = useState<number>(10);

  const payload: Record<string, unknown> = {
    authorName: authorName.trim() || "Viewer",
    message: message.trim() || "(empty)",
    postedAt: new Date().toISOString(),
    displaySeconds,
    slot,
  };
  if (cssOverrides.trim()) payload.cssOverrides = cssOverrides.trim();

  return (
    <div className="space-y-3" data-testid="structured-featured-comment">
      <fieldset
        className="flex items-center gap-3 rounded-sm border border-[var(--ink-4)]/50 bg-[var(--ink-3)]/30 px-2 py-1 text-[10px]"
        data-testid="fc-slot"
      >
        <span className="font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Slot
        </span>
        <label className="flex items-center gap-1 text-[var(--chalk-1)]">
          <input
            type="radio"
            name="slot-local"
            value="primary"
            checked={slot === "primary"}
            onChange={() => setSlot("primary")}
          />
          primary
        </label>
        <label className="flex items-center gap-1 text-[var(--chalk-1)]">
          <input
            type="radio"
            name="slot-local"
            value="secondary"
            checked={slot === "secondary"}
            onChange={() => setSlot("secondary")}
          />
          secondary
        </label>
      </fieldset>

      <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Author name
          <input
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            maxLength={80}
            className={inputClass}
            data-testid="fc-author"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Display seconds
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
            className={inputClass}
            data-testid="fc-display-seconds"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Message
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={500}
          className={textareaClass}
          data-testid="fc-message"
        />
      </label>

      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        CSS overrides (optional)
        <textarea
          value={cssOverrides}
          onChange={(e) => setCssOverrides(e.target.value)}
          rows={6}
          maxLength={4000}
          className={textareaClass}
          placeholder={`/* override the .fc-card background, colors, etc. Examples:
.fc-card { background: linear-gradient(...); }
.fc-author { color: #fe036d; } */`}
          data-testid="fc-css"
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <OffTriggerButton
          templateKey="featured_comment"
          sessionId={sessionId}
          slot={slot}
          disabled={!isLive}
          data-testid="fc-off"
        />
        <form action={triggerOverlayAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="templateKey" value="featured_comment" />
          <input type="hidden" name="slot" value={slot} />
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />
          <PrimaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="fc-trigger"
          >
            Trigger
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}
