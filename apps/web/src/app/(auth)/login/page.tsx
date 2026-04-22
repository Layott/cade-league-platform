import Image from "next/image";
import { login } from "./actions";
import { FormField, inputClass } from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import { PRIMARY_LOGOS } from "@/lib/brand";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;

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
            {sp.error ? (
              <div
                role="alert"
                data-testid="login-error"
                style={{
                  background: "rgba(255,91,59,0.1)",
                  border: "1px solid rgba(255,91,59,0.4)",
                  color: "var(--flare)",
                  padding: "10px 12px",
                  borderRadius: 4,
                  fontSize: 12,
                  letterSpacing: "0.04em",
                }}
              >
                {sp.error}
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
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••••"
                className={inputClass}
              />
            </FormField>

            <PrimaryButton type="submit" className="w-full">
              Continue →
            </PrimaryButton>

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
