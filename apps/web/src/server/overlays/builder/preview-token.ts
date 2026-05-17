import { createHmac, timingSafeEqual } from "crypto";

/**
 * Wave 1A — short-lived preview token for draft designs.
 *
 * Payload encoded as base64url(JSON({ slug, userId, roles, exp })).
 * HMAC-SHA256 signature appended with a "." separator. Tokens live 15
 * minutes by default; signed with `OVERLAY_PREVIEW_TOKEN_SECRET` (falls
 * back to SUPABASE_SERVICE_ROLE_KEY in dev — production MUST set the
 * env var; a warning is logged if neither is set).
 *
 * The runtime route verifies signature + slug + expiry. Issuance lives
 * in an admin-only API route, consuming `issuePreviewToken` from here.
 */

type PreviewPayload = {
  slug: string;
  userId: string;
  roles: readonly string[];
  exp: number; // unix seconds
};

function getSecret(): string {
  const s =
    process.env.OVERLAY_PREVIEW_TOKEN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) {
    // Warn once in dev; never hard-crash so tests work without env setup.
    console.warn(
      "[preview-token] OVERLAY_PREVIEW_TOKEN_SECRET not set — " +
        "using insecure dev fallback. Set it in production.",
    );
    return "dev-preview-secret-insecure";
  }
  return s;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
}

/** Issue a signed 15-minute preview token for a draft design. */
export function issuePreviewToken(
  payload: Omit<PreviewPayload, "exp">,
  expiresInMs: number = 15 * 60 * 1000,
): string {
  const full: PreviewPayload = {
    ...payload,
    exp: Math.floor((Date.now() + expiresInMs) / 1000),
  };
  const body = b64urlEncode(JSON.stringify(full));
  const sig = createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; actor: { userId: string; roles: readonly string[] } }
  | { ok: false; reason: "malformed" | "bad_sig" | "wrong_slug" | "expired" };

/**
 * Verify a preview token.
 *
 * Returns `{ ok: true, actor }` on success. Returns `{ ok: false, reason }`
 * on any failure — callers MUST NOT treat a failed verify as an error to
 * throw; they should return 404 (to not leak draft existence).
 */
export async function verifyPreviewToken(
  token: string,
  expectedSlug: string,
): Promise<VerifyResult> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return { ok: false, reason: "malformed" };

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Constant-time compare to resist timing attacks.
  let expectedSig: string;
  try {
    expectedSig = createHmac("sha256", getSecret()).update(body).digest("base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_sig" };
  }

  // Signature OK — decode + validate payload.
  let parsed: PreviewPayload;
  try {
    parsed = JSON.parse(b64urlDecode(body)) as PreviewPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof parsed.slug !== "string" || typeof parsed.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.slug !== expectedSlug) return { ok: false, reason: "wrong_slug" };
  if (parsed.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };

  return {
    ok: true,
    actor: {
      userId: parsed.userId ?? "",
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
    },
  };
}
