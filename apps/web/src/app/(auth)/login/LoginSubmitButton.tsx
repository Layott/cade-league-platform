"use client";

import { useFormStatus } from "react-dom";
import { PrimaryButton } from "@/components/admin/buttons";

/**
 * 2026-05-08 — submit button with pending-state animation.
 *
 * Wraps the existing `PrimaryButton` and reads `useFormStatus()` so the
 * client renders a spinner + "Signing in…" the moment the form posts.
 * Previously the button stayed labeled "Continue →" while the server
 * action established the session — players were uncertain whether the
 * click registered.
 *
 * The form must be a Server Action (`<form action={login}>`); React's
 * `useFormStatus` only fires for that boundary.
 */
export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <PrimaryButton
      type="submit"
      className="w-full"
      aria-label="Continue Sign in"
      disabled={pending}
      data-testid="login-submit-btn"
      data-pending={pending ? "1" : "0"}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center gap-2"
      >
        {pending ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ animation: "cade-spin 0.7s linear infinite" }}
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeOpacity="0.25"
            />
            <path
              d="M12 3a9 9 0 0 1 9 9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
        <span>{pending ? "Signing in…" : "Continue →"}</span>
      </span>
      <style>{`@keyframes cade-spin { to { transform: rotate(360deg); } }`}</style>
    </PrimaryButton>
  );
}
