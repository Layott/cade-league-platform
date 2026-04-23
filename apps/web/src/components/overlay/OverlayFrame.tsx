"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Plan 48 — canonical 1920×1080 overlay root.
 *
 * Browser sources (OBS, vMix, Streamlabs, Ecamm…) resolve to pixel-exact
 * 1920×1080, so every overlay page must render content positioned against
 * that box. OverlayFrame is the single `data-overlay-root` wrapper: all
 * 27 overlay routes nest their motion layers inside it.
 *
 * ?preview=1 scales the frame to 50% via CSS transform for the
 * design-review harness so a full 1920×1080 comp fits inside a 960×540
 * admin thumbnail. The inner content keeps its native dimensions so
 * layout math + keyframes remain identical to production output.
 *
 * The frame renders `position: relative` + `overflow: hidden` so
 * absolutely-positioned children can use 0-based coordinates.
 */

export type OverlayFrameProps = {
  children: ReactNode;
  /** Extra classes applied to the inner content wrapper (not the frame). */
  className?: string;
  /** Override the data-testid (default: "overlay-root" — Plan 48). */
  "data-testid"?: string;
};

export function OverlayFrame({ children, className = "", ...rest }: OverlayFrameProps) {
  return (
    <Suspense fallback={<FrameShell className={className} rest={rest} preview={false}>{children}</FrameShell>}>
      <OverlayFrameInner className={className} rest={rest}>
        {children}
      </OverlayFrameInner>
    </Suspense>
  );
}

function OverlayFrameInner({
  children,
  className,
  rest,
}: {
  children: ReactNode;
  className: string;
  rest: Omit<OverlayFrameProps, "children" | "className">;
}) {
  const sp = useSearchParams();
  const preview = sp?.get("preview") === "1";
  return (
    <FrameShell className={className} rest={rest} preview={preview}>
      {children}
    </FrameShell>
  );
}

function FrameShell({
  children,
  className,
  rest,
  preview,
}: {
  children: ReactNode;
  className: string;
  rest: Omit<OverlayFrameProps, "children" | "className">;
  preview: boolean;
}) {
  const testId = rest["data-testid"] ?? "overlay-root";
  // When preview=1: wrap in a 960×540 outer box that scales the
  // 1920×1080 inner frame to 50%. This means Playwright / curl consumers
  // that snapshot at 960×540 see a complete composition.
  if (preview) {
    return (
      <div
        style={{
          position: "relative",
          width: "960px",
          height: "540px",
          overflow: "hidden",
          background: "transparent",
        }}
      >
        <div
          data-overlay-root
          data-testid={testId}
          className={
            "relative w-[1920px] h-[1080px] overflow-hidden bg-transparent " +
            className
          }
          style={{
            transform: "scale(0.5)",
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div
      data-overlay-root
      data-testid={testId}
      className={
        "relative w-[1920px] h-[1080px] overflow-hidden bg-transparent " +
        className
      }
    >
      {children}
    </div>
  );
}
