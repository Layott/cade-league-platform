"use client";

import { useState } from "react";
import { inputClass } from "@/components/admin/FormField";

/**
 * Login password input with show/hide toggle. Client Component so we
 * can flip the input type on click without round-tripping the server.
 *
 * The eye button toggles between "show" and "hide" states; ARIA labels
 * + `aria-pressed` reflect state for screen readers. Form submission
 * still posts the plain password value via the same `name="password"`
 * field, so the existing Server Action `login()` flow is unchanged.
 */
export function PasswordInput() {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        name="password"
        type={visible ? "text" : "password"}
        required
        autoComplete="current-password"
        placeholder="••••••••••"
        className={`${inputClass} pr-12`}
        data-testid="login-password-input"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        data-testid="login-password-toggle"
        className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-[var(--chalk-3)] hover:text-[var(--chalk-1)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] rounded-sm transition-colors"
        tabIndex={-1}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 5.07A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a10.94 10.94 0 0 0 5.39-1.39" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
