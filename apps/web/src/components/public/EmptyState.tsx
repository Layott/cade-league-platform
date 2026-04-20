import type { ReactNode } from "react";

type Props = {
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
};

/**
 * Empty-state block used across public pages. Uses brand voice — never
 * generic "no data" copy. Always speaks in league terms.
 */
export function EmptyState({ title, hint, icon }: Props) {
  return (
    <div className="relative overflow-hidden rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/60 p-10 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 scanlines opacity-30"
      />
      <div className="relative mx-auto flex max-w-sm flex-col items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--ink-5)] bg-[var(--ink-1)] text-[var(--signal)]">
          {icon ?? <DefaultIcon />}
        </div>
        <div className="font-display text-base font-semibold text-[var(--chalk-0)]">
          {title}
        </div>
        {hint ? (
          <div className="text-xs leading-relaxed text-[var(--chalk-2)]">
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DefaultIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden
    >
      <path d="M3 12h18M12 3v18" opacity="0.4" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
