"use client";

import { useState } from "react";
import { PrimaryButton } from "@/components/admin/buttons";
import { inputClass, textareaClass } from "@/components/admin/FormField";
import { OffTriggerButton } from "@/components/broadcast/OffTriggerButton";
import { triggerOverlayAction } from "../../actions";

/**
 * Plan 45 + Plan 48.2 — Structured featured_comment form.
 *
 * Plan 48.2 swaps the raw "CSS overrides" textarea for a sidebar of
 * structured design pickers that map 1:1 to CSS custom properties on the
 * overlay card root. The overlay page (`/overlay/featured-comment`) reads
 * `payload.design` and writes the matching vars:
 *
 *   backgroundColor (+ opacity) → --fc-bg
 *   textColor                   → --fc-text
 *   authorColor                 → --fc-author
 *   accentColor                 → --fc-accent
 *   borderRadius                → --fc-radius
 *   fontSize                    → --fc-font-scale (multiplier)
 *   position                    → absolute placement + enter/exit offsets
 *   duration (displaySeconds)   → auto-clear timer
 *
 * Values pass through Zod (`fcDesignSchema` in `server/overlays/schemas.ts`)
 * before landing on the overlay. Only hex colours / numbers / enumerated
 * keywords survive the guard — arbitrary strings are rejected.
 *
 * The original freeform `cssOverrides` textarea stays under a collapsed
 * "Advanced CSS" details block for power users. Applied AFTER the
 * structured vars so it can still override anything.
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
  const [displaySeconds, setDisplaySeconds] = useState<number>(10);

  // Structured design knobs.
  const [backgroundColor, setBackgroundColor] = useState<string>("#07080b");
  const [backgroundOpacity, setBackgroundOpacity] = useState<number>(94);
  const [textColor, setTextColor] = useState<string>("#e8f0dc");
  const [authorColor, setAuthorColor] = useState<string>("#ffffff");
  const [accentColor, setAccentColor] = useState<string>("#fe036d");
  const [borderRadius, setBorderRadius] = useState<number>(0);
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">(
    "medium",
  );
  const [position, setPosition] = useState<
    "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
  >("bottom-left");

  const [cssOverrides, setCssOverrides] = useState<string>("");

  const payload: Record<string, unknown> = {
    authorName: authorName.trim() || "Viewer",
    message: message.trim() || "(empty)",
    postedAt: new Date().toISOString(),
    displaySeconds,
    slot,
    design: {
      backgroundColor,
      backgroundOpacity,
      textColor,
      authorColor,
      accentColor,
      borderRadius,
      fontSize,
      position,
    },
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

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        {/* LEFT column — author / message / duration. */}
        <div className="space-y-3">
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
              rows={4}
              maxLength={500}
              className={textareaClass}
              data-testid="fc-message"
            />
          </label>

          <details className="rounded-sm border border-[var(--ink-4)]/40 bg-[var(--ink-3)]/20 px-2 py-1">
            <summary
              className="cursor-pointer select-none text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]"
              data-testid="fc-advanced-css-summary"
            >
              Advanced CSS (optional)
            </summary>
            <textarea
              value={cssOverrides}
              onChange={(e) => setCssOverrides(e.target.value)}
              rows={6}
              maxLength={4000}
              className={`${textareaClass} mt-2`}
              placeholder={`/* override specific rules — runs AFTER the sidebar vars
.fc-card { background: linear-gradient(...); }
.fc-author { color: #fe036d; } */`}
              data-testid="fc-css"
            />
          </details>
        </div>

        {/* RIGHT column — design sidebar. */}
        <aside
          className="space-y-2 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-3"
          data-testid="fc-design-sidebar"
        >
          <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Design
          </div>

          <ColorPickerRow
            label="Background"
            value={backgroundColor}
            onChange={setBackgroundColor}
            testId="fc-bg-color"
          />
          <SliderRow
            label="Bg opacity"
            value={backgroundOpacity}
            min={0}
            max={100}
            onChange={setBackgroundOpacity}
            testId="fc-bg-opacity"
            suffix="%"
          />
          <ColorPickerRow
            label="Text"
            value={textColor}
            onChange={setTextColor}
            testId="fc-text-color"
          />
          <ColorPickerRow
            label="Author"
            value={authorColor}
            onChange={setAuthorColor}
            testId="fc-author-color"
          />
          <ColorPickerRow
            label="Accent bar"
            value={accentColor}
            onChange={setAccentColor}
            testId="fc-accent-color"
          />
          <NumberRow
            label="Radius"
            value={borderRadius}
            min={0}
            max={40}
            onChange={setBorderRadius}
            testId="fc-radius"
            suffix="px"
          />
          <SelectRow
            label="Font size"
            value={fontSize}
            options={[
              { v: "small", t: "Small" },
              { v: "medium", t: "Medium" },
              { v: "large", t: "Large" },
            ]}
            onChange={(v) => setFontSize(v as typeof fontSize)}
            testId="fc-font-size"
          />
          <SelectRow
            label="Position"
            value={position}
            options={[
              { v: "top-left", t: "Top Left" },
              { v: "top-right", t: "Top Right" },
              { v: "bottom-left", t: "Bottom Left" },
              { v: "bottom-right", t: "Bottom Right" },
              { v: "center", t: "Center" },
            ]}
            onChange={(v) => setPosition(v as typeof position)}
            testId="fc-position"
          />
        </aside>
      </div>

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

// --- Sidebar sub-components --------------------------------------------

function ColorPickerRow({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
      <span className="flex-1">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-10 cursor-pointer border border-[var(--ink-4)] bg-transparent"
        data-testid={testId}
      />
      <span className="w-16 font-mono text-[10px] normal-case text-[var(--chalk-1)]">
        {value}
      </span>
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  testId,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  testId: string;
  suffix?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
      <span className="w-16 flex-shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(
            Math.max(min, Math.min(max, Number(e.target.value) || min)),
          )
        }
        className="flex-1"
        data-testid={testId}
      />
      <span className="w-12 text-right font-mono text-[10px] normal-case text-[var(--chalk-1)]">
        {value}
        {suffix ?? ""}
      </span>
    </label>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  onChange,
  testId,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  testId: string;
  suffix?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
      <span className="flex-1">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(
            Math.max(min, Math.min(max, Number(e.target.value) || min)),
          )
        }
        className={`${inputClass} w-20`}
        data-testid={testId}
      />
      {suffix ? (
        <span className="w-6 text-[10px] normal-case text-[var(--chalk-3)]">
          {suffix}
        </span>
      ) : null}
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: { v: string; t: string }[];
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
      <span className="flex-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} w-36 normal-case`}
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.t}
          </option>
        ))}
      </select>
    </label>
  );
}
