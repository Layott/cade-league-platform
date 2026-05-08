import Image from "next/image";
import { login } from "./actions";
import { FormField, inputClass } from "@/components/admin/FormField";
import { PRIMARY_LOGOS } from "@/lib/brand";
import { PasswordInput } from "./PasswordInput";
import { LoginSubmitButton } from "./LoginSubmitButton";

/**
 * Map machine-readable error codes (set by `actions.ts`) to user-facing
 * copy. Bug 11 fix (2026-05-01) replaced free-form encoded error strings
 * with stable codes so admin tooling, e2e tests, and the LOC's verbal
 * troubleshooting all agree on the same vocabulary.
 *
 * Legacy free-form strings (anything that doesn't match a known code) is
 * passed through verbatim so old bookmarked URLs / saved redirects don't
 * suddenly start showing "Unknown error".
 */
function describeError(code: string, minutes: string | undefined): string {
  if (code === "account_locked") {
    const n = minutes ? Math.max(1, parseInt(minutes, 10) || 1) : 5;
    return `Account temporarily locked due to too many failed attempts. Try again in ~${n} ${n === 1 ? "minute" : "minutes"}, or ask the LOC to unlock you.`;
  }
  if (code === "rate_limited") {
    return "Too many requests. Slow down and try again in a moment.";
  }
  if (code === "invalid_credentials") {
    return "Invalid email or password.";
  }
  if (code === "unknown_error") {
    return "Something went wrong. Try again, or contact the LOC if it persists.";
  }
  // Legacy fallback — preserve verbatim copy from older error encodings.
  return code;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; minutes?: string }>;
}) {
  const sp = await searchParams;
  const errorCopy = sp.error ? describeError(sp.error, sp.minutes) : null;

  return (
    <main
      className="relative min-h-screen w-full overflow-hidden"
      style={{ background: "var(--ink-0)" }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 0%, rgba(107,205,6,0.18) 0%, transparent 55%), radial-gradient(circle at 90% 100%, rgba(254,3,109,0.14) 0%, transparent 50%)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 4px)",
          pointerEvents: "none",
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-10">
        <div
          className="w-full max-w-md"
          style={{
            background: "rgba(11,12,16,0.85)",
            border: "1px solid var(--ink-3)",
            borderRadius: 6,
            backdropFilter: "blur(14px)",
            boxShadow:
              "0 30px 80px -30px rgba(0,0,0,0.7), 0 0 0 1px rgba(107,205,6,0.06) inset",
          }}
        >
          <div
            className="px-7 pt-7 pb-6"
            style={{ borderBottom: "1px solid var(--ink-3)" }}
          >
            <div className="flex items-center gap-3">
              <Image
                src={PRIMARY_LOGOS.cade}
                alt="CADE"
                width={42}
                height={42}
                priority
                style={{ objectFit: "contain" }}
              />
              <div className="flex flex-col">
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.3em",
                    color: "var(--primary)",
                    textTransform: "uppercase",
                  }}
                >
                  Cade League
                </span>
                <span
                  className="font-broadcast-display"
                  style={{
                    fontSize: 22,
                    color: "var(--chalk-0)",
                    lineHeight: 1.05,
                  }}
                >
                  Sign in
                </span>
              </div>
            </div>
            <p
              className="mt-3"
              style={{
                fontSize: 13,
                color: "var(--chalk-2)",
                lineHeight: 1.5,
              }}
            >
              Division 1 Elite · 2025-2026 · Player + staff console.
            </p>
          </div>

          <form action={login} className="px-7 pt-6 pb-7 space-y-5">
            {errorCopy ? (
              <div
                role="alert"
                data-testid="login-error"
                data-error-code={sp.error}
                style={{
                  background: "rgba(255,91,59,0.1)",
                  border: "1px solid rgba(255,91,59,0.4)",
                  color: "var(--flare)",
                  padding: "10px 12px",
                  borderRadius: 4,
                  fontSize: 12,
                  letterSpacing: "0.04em",
                  lineHeight: 1.5,
                }}
              >
                {errorCopy}
              </div>
            ) : null}

            {/* Only forward `next` when the user landed here via a
                middleware redirect (e.g. /admin/something → /login?next=…).
                No explicit next = role-aware default in the server action. */}
            {sp.next ? (
              <input type="hidden" name="next" value={sp.next} />
            ) : null}

            <FormField label="Email">
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@cade.local"
                className={inputClass}
              />
            </FormField>

            <FormField label="Password">
              <PasswordInput />
            </FormField>

            {/*
              aria-label includes "Sign in" alongside "Continue" so both
              the legacy e2e specs (`name: "Continue"`) AND the Wave 2
              Stage 4 e2e specs (`name: /sign in/i`) match the same
              accessible name. Visible text stays "Continue →" for
              consistency with the rest of the console.
              2026-05-08 — wrapped via LoginSubmitButton client component
              so useFormStatus pending-state can drive a spinner +
              "Signing in…" copy while the server action establishes
              the session.
            */}
            <LoginSubmitButton />

            <p
              className="text-center"
              style={{
                fontSize: 11,
                color: "var(--chalk-3)",
                marginTop: 4,
                letterSpacing: "0.06em",
              }}
            >
              Auth issues? Contact the LOC.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
