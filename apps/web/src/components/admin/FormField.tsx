import type { HTMLAttributes, ReactNode } from "react";

/**
 * FormField wraps an admin form control with a consistent label treatment:
 * tiny uppercase eyebrow label + optional hint below. Keeps markup terse
 * at call sites.
 */

export function FormField({
  label,
  hint,
  children,
  className = "",
  htmlFor,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
} & Omit<HTMLAttributes<HTMLLabelElement>, "children">) {
  return (
    <label
      className={"block space-y-1.5 " + className}
      htmlFor={htmlFor}
      {...rest}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-xs text-[var(--chalk-3)]">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Shared class strings for native form inputs on the admin dark surface.
 * Keep one source of truth instead of duplicating across pages.
 */
export const inputClass =
  "w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-sm text-[var(--chalk-0)] placeholder:text-[var(--chalk-3)] focus:border-[var(--signal)] focus:outline-none focus:ring-1 focus:ring-[var(--signal)]";

export const selectClass = inputClass + " appearance-none";

export const textareaClass =
  inputClass + " font-mono text-[13px] leading-relaxed";
