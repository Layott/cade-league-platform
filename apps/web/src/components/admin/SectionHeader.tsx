import type { ReactNode } from "react";

/**
 * Shared admin page header: eyebrow tag + display title + optional
 * description + optional action slot (usually a PrimaryButton link).
 * Keeps every admin page's top-of-content treatment identical.
 */

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--ink-4)] pb-6 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--secondary)]">
          {eyebrow}
        </div>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-tight text-[var(--chalk-0)] md:text-[34px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--chalk-2)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}
