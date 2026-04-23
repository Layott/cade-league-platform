import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
};

/**
 * Reusable public-page header. Eyebrow tag is in signal-green caps;
 * title uses the display font with tight kerning.
 */
export function PageHeader({ eyebrow, title, description, right }: Props) {
  return (
    <header className="relative overflow-hidden border-b border-[var(--ink-4)] py-10 md:py-14">
      <div aria-hidden className="absolute inset-0 scanlines opacity-[0.35]" />
      <div
        aria-hidden
        className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[var(--signal-glow)] blur-3xl"
      />
      <div className="relative mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 md:flex-row md:items-end">
        <div className="max-w-2xl">
          {eyebrow ? (
            <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--secondary)]">
              <span
                aria-hidden
                className="h-[1px] w-8 bg-[var(--secondary)]"
              />
              {eyebrow}
            </div>
          ) : null}
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-[var(--chalk-0)] md:text-5xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--chalk-2)]">
              {description}
            </p>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </header>
  );
}
