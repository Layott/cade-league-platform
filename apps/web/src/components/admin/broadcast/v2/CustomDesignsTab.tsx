"use client";

import Link from "next/link";
import { CustomDesignCard, type CustomDesignSummary } from "./CustomDesignCard";

export type CustomDesignsTabProps = {
  designs: readonly CustomDesignSummary[];
  sessionId: string;
  viewToken: string | null;
  canTrigger: boolean;
  triggerAction: (args: {
    overlayKey: string;
    sessionId: string;
  }) => void | Promise<unknown>;
  clearAction: (args: {
    overlayKey: string;
    sessionId: string;
  }) => void | Promise<unknown>;
  /**
   * When false (overlayBuilder feature flag off) renders a disabled
   * empty state instead of the card grid. Default-off invariant
   * per Wave 1A flag spec.
   */
  enabled?: boolean;
};

export function CustomDesignsTab({
  designs,
  sessionId,
  viewToken,
  canTrigger,
  triggerAction,
  clearAction,
  enabled = true,
}: CustomDesignsTabProps) {
  if (!enabled) {
    return (
      <div
        data-testid="custom-designs-disabled"
        className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-6 text-center"
      >
        <p className="text-[12px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          Overlay Builder is disabled.
        </p>
        <p className="mt-2 text-[11px] text-[var(--chalk-3)]">
          Set{" "}
          <code className="font-mono text-[var(--signal)]">
            {"NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true"}
          </code>{" "}
          to enable.
        </p>
      </div>
    );
  }

  if (designs.length === 0) {
    return (
      <div
        data-testid="custom-designs-empty"
        className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-6 text-center"
      >
        <p className="text-[12px] uppercase tracking-[0.2em] text-[var(--chalk-2)]">
          No custom designs published yet.
        </p>
        <p className="mt-2 text-[11px] text-[var(--chalk-3)]">
          Create one in{" "}
          <Link
            href="/admin/broadcast/v2/builder"
            className="text-[var(--signal)] underline"
          >
            Builder
          </Link>{" "}
          then publish to surface it here.
        </p>
      </div>
    );
  }

  return (
    <section
      data-testid="custom-designs-tab"
      className="space-y-3"
      aria-label="Custom user-authored overlay designs"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-1)]">
          Custom Designs ({designs.length})
        </h3>
        <Link
          href="/admin/broadcast/v2/builder"
          className="text-[11px] uppercase tracking-[0.18em] text-[var(--signal)] hover:underline"
        >
          Manage in Builder →
        </Link>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {designs.map((design) => (
          <CustomDesignCard
            key={design.id}
            design={design}
            sessionId={sessionId}
            viewToken={viewToken}
            canTrigger={canTrigger}
            onTrigger={triggerAction}
            onHide={clearAction}
          />
        ))}
      </div>
    </section>
  );
}
