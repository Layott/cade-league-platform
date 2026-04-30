import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side image upscale proxy. Fetches a small thumbnail from a
 * tightly-allowlisted upstream (FUTBIN's image CDN), runs it through
 * Sharp with Lanczos3 resampling at 4x source size, and returns the
 * result as a long-cached PNG.
 *
 * The 19-player-squads broadcast overlay needs full FUTBIN composite
 * cards rendered crisply at ~120-180px. FUTBIN's native URLs expose
 * only 64×89 thumbnails (any other `w=` value invalidates the signed
 * `s=` HMAC). Browser CSS scaling at 2-3x leaves the cards visibly
 * blurry. Sharp Lanczos at 4x source = 256×356 produces cards that
 * read crisply at 116×168 display + tolerate up to ~200px without
 * obvious softness.
 *
 * Query params:
 *   `?url=<urlencoded futbin url>` — REQUIRED. Must be on `cdn3.futbin.com`.
 *   `?w=<integer>` — OPTIONAL target width (default 256, max 1024).
 *
 * Response:
 *   - 200 image/png with `Cache-Control: public, max-age=604800, immutable`.
 *     FUTBIN URLs are content-addressed via the signature param, so the
 *     same `?url=` argument always returns the same bytes — safe to cache
 *     immutably for a week.
 *   - 400 on bad input.
 *   - 502 when upstream fetch fails or returns non-image.
 *
 * SSRF guards:
 *   - URL host MUST be in the allowlist (currently only `cdn3.futbin.com`).
 *   - URL scheme MUST be https.
 *   - No request body forwarding; outbound has only User-Agent + Accept.
 */

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "cdn3.futbin.com",
]);

const DEFAULT_WIDTH = 256;
const MAX_WIDTH = 1024;
const FETCH_TIMEOUT_MS = 6000;
const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const rawUrl = url.searchParams.get("url");
  const wStr = url.searchParams.get("w");

  if (!rawUrl) {
    return NextResponse.json(
      { error: "missing ?url= param" },
      { status: 400 },
    );
  }

  let upstream: URL;
  try {
    upstream = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (upstream.protocol !== "https:") {
    return NextResponse.json(
      { error: "https only" },
      { status: 400 },
    );
  }
  if (!ALLOWED_HOSTS.has(upstream.hostname)) {
    return NextResponse.json(
      { error: `host not allowed: ${upstream.hostname}` },
      { status: 400 },
    );
  }

  let targetW = DEFAULT_WIDTH;
  if (wStr) {
    const n = parseInt(wStr, 10);
    if (Number.isFinite(n) && n > 0) {
      targetW = Math.min(Math.max(n, 32), MAX_WIDTH);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream.toString(), {
      headers: {
        "User-Agent": UPSTREAM_USER_AGENT,
        Accept: "image/png,image/webp,image/*",
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "upstream fetch failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!upstreamRes.ok) {
    return NextResponse.json(
      { error: `upstream ${upstreamRes.status}` },
      { status: 502 },
    );
  }
  const contentType = upstreamRes.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json(
      { error: `non-image content type: ${contentType}` },
      { status: 502 },
    );
  }

  const buf = Buffer.from(await upstreamRes.arrayBuffer());

  let outBuf: Buffer;
  try {
    outBuf = await sharp(buf)
      .resize({
        width: targetW,
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: false,
        fit: "inside",
      })
      .png({
        quality: 95,
        compressionLevel: 6,
        adaptiveFiltering: true,
      })
      .toBuffer();
  } catch (e) {
    return NextResponse.json(
      {
        error: "sharp resize failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  return new NextResponse(new Uint8Array(outBuf), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=604800, immutable",
      "Content-Length": String(outBuf.length),
      Vary: "Accept",
      "X-Upscaled-From": "cdn3.futbin.com",
    },
  });
}
