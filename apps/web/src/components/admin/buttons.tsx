import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Admin button primitives. Three flavors (primary = signal accent,
 * secondary = chalk outline, danger = flare red). All share consistent
 * sizing + uppercase tracking so forms across the console read the same.
 */

type Size = "sm" | "md";

const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[11px]",
  md: "px-4 py-2 text-xs",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm font-semibold uppercase tracking-[0.18em] transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function PrimaryButton({
  children,
  size = "md",
  className = "",
  ...rest
}: { children: ReactNode; size?: Size } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={
        BASE +
        " " +
        SIZE[size] +
        " border border-[var(--signal)] bg-[var(--signal)] text-[var(--signal-ink)] shadow-[0_0_0_1px_rgba(0,255,136,0.25),0_10px_30px_-12px_rgba(0,255,136,0.5)] hover:bg-[#3dffa4] hover:shadow-[0_0_0_1px_rgba(0,255,136,0.5),0_12px_36px_-10px_rgba(0,255,136,0.6)] " +
        className
      }
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  size = "md",
  className = "",
  ...rest
}: { children: ReactNode; size?: Size } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={
        BASE +
        " " +
        SIZE[size] +
        " border border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)] " +
        className
      }
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  size = "md",
  className = "",
  ...rest
}: { children: ReactNode; size?: Size } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={
        BASE +
        " " +
        SIZE[size] +
        " border border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.08)] text-[var(--flare)] hover:border-[var(--flare)] hover:bg-[rgba(255,91,59,0.15)] " +
        className
      }
    >
      {children}
    </button>
  );
}
