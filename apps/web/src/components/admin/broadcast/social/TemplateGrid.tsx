"use client";

import Link from "next/link";
import type { SocialTemplate } from "@/server/social/templates";

/**
 * Plan 54 Wave 2B — `<TemplateGrid>` lists every active social template
 * as a tile linking to its config page at `/admin/broadcast/social/<key>`.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
 */

export function TemplateGrid({
  templates,
}: {
  templates: ReadonlyArray<SocialTemplate>;
}) {
  if (templates.length === 0) {
    return (
      <div
        className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]"
        data-testid="template-grid-empty"
      >
        No active templates yet.
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="template-grid"
    >
      {templates.map((t) => (
        <TemplateCard key={t.templateKey} template={t} />
      ))}
    </div>
  );
}

function TemplateCard({ template }: { template: SocialTemplate }) {
  const formatLabel: Record<SocialTemplate["format"], string> = {
    image: "Image",
    video: "Video",
    both: "Image + Video",
  };
  const formatTone =
    template.format === "video"
      ? "border-[rgba(254,3,109,0.4)] bg-[rgba(254,3,109,0.08)] text-[var(--secondary)]"
      : template.format === "both"
        ? "border-[rgba(107,205,6,0.4)] bg-[rgba(107,205,6,0.08)] text-[var(--primary)]"
        : "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-1)]";

  return (
    <Link
      href={`/admin/broadcast/social/${template.templateKey}`}
      data-testid={`template-card-${template.templateKey}`}
      className="group flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 transition-colors hover:border-[var(--signal)] hover:bg-[var(--ink-3)]/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-display text-base font-bold text-[var(--chalk-0)] group-hover:text-[var(--signal)]">
            {template.label}
          </h3>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            {template.templateKey}
          </div>
        </div>
        <span
          className={
            "inline-flex shrink-0 items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] " +
            formatTone
          }
        >
          {formatLabel[template.format]}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-[var(--chalk-2)]">
        {template.description}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {template.supportedSizes.map((s) => (
          <span
            key={s}
            className="inline-flex items-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-0.5 font-mono text-[10px] text-[var(--chalk-2)]"
          >
            {s}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-end pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] group-hover:text-[var(--signal)]">
          Open →
        </span>
      </div>
    </Link>
  );
}
