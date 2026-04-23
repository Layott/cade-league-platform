import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  href?: string;
  hrefLabel?: string;
  children?: ReactNode;
};

export function SectionHeading({
  eyebrow,
  title,
  href,
  hrefLabel = "View all",
  children,
}: Props) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--secondary)]">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="font-display text-2xl font-bold tracking-tight text-[var(--chalk-0)]">
          {title}
        </h2>
        {children ? (
          <p className="mt-1 text-sm text-[var(--chalk-2)]">{children}</p>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--chalk-1)] transition-colors hover:text-[var(--signal)]"
        >
          {hrefLabel}
          <span
            aria-hidden
            className="transition-transform group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      ) : null}
    </div>
  );
}
