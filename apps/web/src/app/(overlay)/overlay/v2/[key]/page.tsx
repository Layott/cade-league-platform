import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import OverlayDataInjector from "@/components/broadcast/v2/OverlayDataInjector";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getActiveSession } from "@/server/broadcast/active_session";
import { isOverlayActive } from "@/server/broadcast/v2/overlay_active_state";
import type { V2OverlayKey } from "@/components/broadcast/v2/overlay-keys";
import { resolveTokens } from "@/server/overlays/design/tokens";
import { getActiveTemplateVariant } from "@/server/overlays/design/templates";
import {
  decodePreviewTokens,
  decodePreviewTextTokens,
  decodePreviewPartnerTokens,
  decodePreviewAnimTokens,
  escapeCssValue,
  type PreviewTextTokens,
  type PreviewPartnerTokens,
  type PreviewAnimTokens,
} from "@/server/overlays/design/preview";
import { resolveTextElements, type ResolvedTextElement } from "@/server/overlays/text/elements";
import {
  resolveStripLayout,
  type PartnerStripLayout,
} from "@/server/overlays/partners/strip";
import {
  resolvePartnerLogos,
  type PartnerLogo,
} from "@/server/overlays/partners/logos";
import {
  resolveAnimations,
  type AnimPhase,
  type ResolvedAnimation,
} from "@/server/overlays/animations/elements";

/**
 * Resolve the active season for a given broadcast session via
 * stream_sessions → match_days. Returns null if session is gone /
 * deleted or doesn't have a match-day attached.
 */
async function resolveSeasonId(sessionId: string): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const sb = getServiceRoleSupabase();
    const { data } = await sb
      .from("stream_sessions")
      .select("match_day_id, match_days:match_day_id ( season_id )")
      .eq("id", sessionId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return null;
    const md = (data as { match_days?: { season_id?: string } | { season_id?: string }[] | null }).match_days;
    if (!md) return null;
    if (Array.isArray(md)) return md[0]?.season_id ?? null;
    return md.season_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Plan 51 — `/overlay/v2/<key>` browser-source route.
 *
 * Thin server-component wrapper around `OverlayDataInjector`. The actual
 * design + animations live in the static HTML mirrored to
 * `apps/web/public/overlays/v2/<key>/index.html` by
 * `apps/web/scripts/sync-v2-overlays.mjs`. The injector iframes that HTML
 * + posts Realtime events / control-panel commands into it via
 * `window.postMessage`.
 *
 * Allowed keys are the 16 routable overlays from spec §9 (animated-bg
 * variants + 18-partners-strip are excluded — meta-only).
 *
 * Auth: routes under `/overlay/v2/*` are publicly readable so OBS / vMix
 * browser sources can pull without cookies. Per-overlay `view_token`
 * validation is optional and happens inside the HTML against the
 * session row when the broadcast control panel attaches one.
 */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "01-brb",
  "02-timer",
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "08-lower-third",
  "09-secondary-score-bug",
  "10-up-next-bug",
  "11-match-scores-day",
  "12-starting-soon",
  "13-stream-ended",
  "14-top-scorers",
  "15-orgs",
  "16-coaches",
  "17-penalties",
  "19-player-squads",
  "20-highlight",
  "21-streaks",
  "22-power-rankings",
  "23-org-standings",
  "24-biggest-margins",
  "25-did-you-know",
  "26-card-meta",
  "27-schedule",
  "28-punditry",
  "29-goalfests",
]);

/**
 * Friendly aliases for muscle-memory + spec/brief keys without the
 * numeric prefix. Resolves to the canonical numeric route. If the
 * caller's key is in this map, redirect once to the canonical URL so
 * downstream code (`isOverlayActive`, demo deep-links, OBS bookmarks)
 * always sees the prefixed form. Added 2026-04-28 after a UI grind
 * agent flagged the divergence.
 */
const KEY_ALIASES: Record<string, string> = {
  brb: "01-brb",
  "be-right-back": "01-brb",
  timer: "02-timer",
  "h2h-2": "04-h2h-2",
  "h2h-3": "05-h2h-3",
  "h2h-5": "06-h2h-5",
  leaderboard: "07-leaderboard",
  "leaderboard-animated": "07-leaderboard",
  "standings-widget": "07-leaderboard",
  "lower-third": "08-lower-third",
  "score-bug": "09-secondary-score-bug",
  "secondary-score-bug": "09-secondary-score-bug",
  "up-next-bug": "10-up-next-bug",
  "up-next": "10-up-next-bug",
  "match-scores-day": "11-match-scores-day",
  "starting-soon": "12-starting-soon",
  "starting-soon-basic": "12-starting-soon",
  "stream-ended": "13-stream-ended",
  outro: "13-stream-ended",
  "top-scorers": "14-top-scorers",
  orgs: "15-orgs",
  "orgs-roster": "15-orgs",
  coaches: "16-coaches",
  "coach-intros": "16-coaches",
  penalties: "17-penalties",
  "player-penalties": "17-penalties",
  "player-squads": "19-player-squads",
  squads: "19-player-squads",
  draft: "19-player-squads",
  drafts: "19-player-squads",
  highlight: "20-highlight",
  highlights: "20-highlight",
};

type SearchParams = {
  session?: string;
  token?: string;
  season?: string;
  preview?: string;
  active?: string;
  slot?: string;
  variant?: string;
  previewTokens?: string;
  previewTextTokens?: string;
  previewPartnerTokens?: string;
  previewAnimTokens?: string;
  /**
   * 2026-04-28 — Bug #25 fix.
   *
   * Forward the `?demo=1` query param down into the iframe URL so the
   * static HTML's demo-loop script (gated on `?demo=1` per CLAUDE.md
   * §14) actually runs when the user navigates the SSR wrapper route
   * `/overlay/v2/<key>?demo=1`. Before this, the SSR page resolved
   * tokens + built the iframe `src` with `?session=` / `?token=` /
   * `?tokens=` / `?previewTokens=` etc. but silently dropped `demo`,
   * which broke:
   *   - Direct navigation to `/overlay/v2/<key>?demo=1` for QA + demo
   *     preview (verification report 2026-04-28).
   *   - The admin design editor preview iframe (passes
   *     `?demo=1&preview=1&active=1` — only the latter two were
   *     reaching the static HTML, so the demo cycle never fired).
   *
   * Static HTML at `/overlays/v2/<key>/index.html?demo=1` was already
   * working — only the SSR wrapper was lossy. Any truthy value (`1`,
   * `true`, `yes`) flips it on for forgiveness with hand-typed URLs.
   */
  demo?: string;
};

/**
 * Build a `:root { --overlay-X: value; ... }` CSS string from a token
 * map. Values are escaped through `escapeCssValue` (defence-in-depth on
 * top of the validation already done in `resolveTokens` /
 * `decodePreviewTokens`).
 */
function buildCssVarRule(tokens: Record<string, string>): string {
  const entries: string[] = [];
  const IMAGE_KEYS: Record<string, true> = { "bg-image": true };
  for (const [k, v] of Object.entries(tokens)) {
    if (typeof v !== "string") continue;
    const safe = escapeCssValue(v);
    if (IMAGE_KEYS[k]) {
      // Empty → drop (HTML default fallback wins).
      if (!safe) continue;
      // Sentinel "none" → emit the CSS keyword `none` so var(--bg-image,
      // url(default)) resolves to none and DOES NOT fall through to the
      // hardcoded HTML default. This is what enables the admin "Off"
      // toggle to actually turn the background off (Bug #28 fix).
      if (safe === "none") {
        entries.push(`--overlay-${k}: none;`);
      } else {
        entries.push(`--overlay-${k}: url("${safe}");`);
      }
    } else {
      if (!safe) continue;
      entries.push(`--overlay-${k}: ${safe};`);
    }
  }
  return `:root{${entries.join(" ")}}`;
}

export default async function OverlayV2Page({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const { key } = await params;
  const {
    session,
    token,
    season,
    preview,
    active,
    slot,
    variant,
    previewTokens: previewTokensRaw,
    previewTextTokens: previewTextTokensRaw,
    previewPartnerTokens: previewPartnerTokensRaw,
    previewAnimTokens: previewAnimTokensRaw,
    demo,
  } = await searchParams;
  // 2026-04-28 — Bug #25. Normalize the `?demo` flag so the same set of
  // truthy values (`1` / `true` / `yes`) all enable the demo cycle. The
  // flag is later forwarded to OverlayDataInjector → iframe URL so the
  // static HTML's `data-tag="cade-demo-mode"` script (gated on
  // `?demo=1`) fires on the SSR wrapper route.
  const isDemo = demo === "1" || demo === "true" || demo === "yes";
  if (!ALLOWED_KEYS.has(key)) {
    const alias = KEY_ALIASES[key];
    if (alias) redirect(`/overlay/v2/${alias}`);
    redirect("/overlay/v2/01-brb");
  }

  // Phase 3 — overlay design system token injection.
  //
  // Resolve persisted DB tokens for this overlay (merged over hard-coded
  // defaults). The `?variant=<id>` param picks a non-default template
  // variant; omitted = the variant flagged `active=true` for the overlay.
  // `decodePreviewTokens` handles the admin live-preview path and is
  // null-safe (malformed input returns null silently).
  let designTokens: Record<string, string> = {};
  let activeVariantId: string | null = null;
  let designTextTokens: Record<string, ResolvedTextElement> = {};
  // Wave 2 Stage 3 — partner-strip layout + logo roster.
  // Bootstrap rebuilds the partner-strip container's <img> children +
  // applies layout CSS. Empty maps preserve hard-coded HTML defaults
  // (backward-compat invariant #1).
  let partnerStrip: PartnerStripLayout | null = null;
  let partnerLogos: PartnerLogo[] = [];
  // Wave 2 Stage 4 — element animations.
  // Resolver returns `Record<elementId, { entry?, exit?, continuous? }>`.
  // Empty map preserves hard-coded HTML defaults (backward-compat
  // invariant #1).
  let designAnimTokens: Record<string, Partial<Record<AnimPhase, ResolvedAnimation>>> = {};
  try {
    const sbDesign = getServiceRoleSupabase();
    const variantRow = variant
      ? await getActiveTemplateVariant(sbDesign, key, variant)
      : await getActiveTemplateVariant(sbDesign, key);
    activeVariantId = variantRow?.variantId ?? "default";
    designTokens = await resolveTokens(sbDesign, key, activeVariantId);
    // Wave 2 Stage 2 — text-element overrides for the iframe bootstrap.
    // resolveTextElements skips no-op rows so the map is empty when no
    // admin has touched a text element yet — keeps backward-compat
    // invariant #1 (default render is byte-identical pre-Wave-2).
    designTextTokens = await resolveTextElements(sbDesign, key, activeVariantId);
    partnerStrip = await resolveStripLayout(sbDesign, key, activeVariantId);
    partnerLogos = await resolvePartnerLogos(sbDesign, key, activeVariantId);
    designAnimTokens = await resolveAnimations(sbDesign, key, activeVariantId);
  } catch {
    // Token resolution failure must not break the overlay route. Fall
    // back to the canonical HTML defaults.
    designTokens = {};
    designTextTokens = {};
    partnerStrip = null;
    partnerLogos = [];
    designAnimTokens = {};
  }
  const previewTokens = await decodePreviewTokens(previewTokensRaw);
  const previewTextTokens: PreviewTextTokens | null = await decodePreviewTextTokens(
    previewTextTokensRaw,
  );
  const previewPartnerTokens: PreviewPartnerTokens | null =
    await decodePreviewPartnerTokens(previewPartnerTokensRaw);
  const previewAnimTokens: PreviewAnimTokens | null =
    await decodePreviewAnimTokens(previewAnimTokensRaw);

  // Build the merged partner token map for the iframe bootstrap. Only
  // surface the param when the admin has actually persisted layout /
  // logos OR the resolver returned at least one logo (the seed has 5
  // logos). Empty map → bootstrap leaves HTML defaults alone.
  const designPartnerTokens =
    partnerStrip || partnerLogos.length > 0
      ? {
          layout: partnerStrip
            ? {
                visible: partnerStrip.visible,
                positionXPx: partnerStrip.positionXPx,
                positionYPx: partnerStrip.positionYPx,
                anchor: partnerStrip.anchor,
                orientation: partnerStrip.orientation,
                scalePct: partnerStrip.scalePct,
                itemSpacingPx: partnerStrip.itemSpacingPx,
                justification: partnerStrip.justification,
                zIndex: partnerStrip.zIndex,
              }
            : undefined,
          logos: partnerLogos.map((l, i) => ({
            partnerKey: l.partnerKey,
            label: l.label,
            alt: l.alt,
            fileUrl: l.fileUrl,
            visible: true,
            sort: l.sortOrder ?? i,
          })),
        }
      : undefined;
  // Wave 2 Stage 4 — animations wire-shape mirrors the
  // `PreviewAnimTokens` shape consumed by `decodePreviewAnimTokens`.
  // Each phase carries the resolved animation parameters; the bootstrap
  // builds `<style>@keyframes anim-<id>-<phase> {...}</style>` + an
  // animation rule scoped to `body.cade-visible` (entry/continuous) or
  // `body.cade-exiting` (exit). Empty wire-shape skips the URL param.
  const designAnimWire = Object.keys(designAnimTokens).length > 0
    ? Object.fromEntries(
        Object.entries(designAnimTokens).map(([elementId, phases]) => [
          elementId,
          Object.fromEntries(
            Object.entries(phases).map(([phase, anim]) => [
              phase,
              {
                enabled: true,
                animType: anim.animType,
                durationMs: anim.durationMs,
                delayMs: anim.delayMs,
                easing: anim.easing,
                iterationCount: anim.iterationCount,
                // `keyframesCss` is the full `@keyframes name{body}`
                // wrapper from the resolver. The bootstrap re-builds
                // its own keyframes from `animType` + only uses
                // `customCssKeyframes` when type is `custom-css`. We
                // pass the body for completeness even though preset
                // types regenerate client-side.
                customCssKeyframes:
                  anim.animType === "custom-css"
                    ? anim.keyframesCss.replace(/^@keyframes\s+\S+\s*\{/, "").replace(/\}\s*$/, "")
                    : null,
              },
            ]),
          ),
        ]),
      )
    : undefined;
  const cssVarRule = buildCssVarRule(designTokens);
  const previewVarRule = previewTokens ? buildCssVarRule(previewTokens) : null;

  // Ambient-session resolve (2026-04-26):
  //
  // OBS / vMix browser sources should be able to point at a stable
  // `https://cade-league.vercel.app/overlay/v2/<key>` URL with NO
  // `?session=` query param and have the server resolve to whichever
  // `stream_sessions` row is currently live. Operators paste the URL once
  // into OBS, then never re-paste across sessions / redeploys.
  //
  // Behaviour:
  //   - explicit `?session=<uuid>` in the URL  → use it (back-compat)
  //   - `?session=current` (sentinel)          → resolve server-side
  //   - missing `session`                      → resolve server-side
  //   - resolve returns null (no live session) → render anyway with
  //     `sessionId=undefined`. The injector handles the empty case
  //     gracefully (no fetch, no channel) and the static HTML stays
  //     in default-OFF state.
  let resolvedSession = session;
  let resolvedSeason: string | null | undefined = season;
  // 2026-04-26 — when ambient resolution kicks in, also adopt the active
  // session's `view_token` so the iframe's INITIAL_FETCH_PATH calls pass
  // the gate. OBS browser sources paste the bare ambient URL with no
  // `?token=` query param; without this, every `/api/broadcast/sessions/
  // <id>/<feed>` call returns 401 and the static demo HTML leaks
  // through. Explicit `?token=<...>` from the caller wins.
  let resolvedToken: string | undefined = token;
  if (!resolvedSession || resolvedSession === "current") {
    const ambient = await getActiveSession(getServiceRoleSupabase());
    if (ambient) {
      resolvedSession = ambient.sessionId;
      // Prefer ambient season unless caller explicitly passed `?season=`.
      if (!resolvedSeason) resolvedSeason = ambient.seasonId ?? undefined;
      if (!resolvedToken && ambient.viewToken) {
        resolvedToken = ambient.viewToken;
      }
    } else {
      resolvedSession = undefined;
    }
  }
  // If we still don't have a season but we DO have a session, fall back
  // to the legacy per-session resolver (joins via match_day).
  if (!resolvedSeason && resolvedSession) {
    resolvedSeason = (await resolveSeasonId(resolvedSession)) ?? undefined;
  }

  // S2 smoke fix (2026-04-26) — Bug CC#2.
  //
  // The mini-preview iframes inside the broadcast control room append
  // `?preview=1&active=0|1` so the injector can decide whether to seed
  // the iframe with current server data (active=1, mirrors stream) or
  // leave it idle (active=0, overlay HTML stays in default-OFF state).
  //
  // Live (OBS) URLs DO NOT carry `preview=1`. Until 2026-04-26 they
  // ALWAYS rendered as active=true, which caused data-driven overlays
  // (match-scores-day, leaderboard, top-scorers) to "auto-load" with
  // current data the moment the OBS browser source opened — even when
  // the operator had not yet triggered the overlay on stream. User
  // bug 2026-04-26: "the match scores today overlay loads automatically
  // without trigger". Fix: probe `overlay_events` for an active row
  // and only flip `active=true` when the server says the overlay is
  // currently triggered. Realtime `overlay.triggered` / `instance.
  // triggered` events still flip the iframe to visible mid-stream.
  const isPreview = preview === "1";
  let isActive: boolean;
  if (isPreview) {
    isActive = active === "1";
  } else if (resolvedSession && (key as V2OverlayKey)) {
    try {
      isActive = await isOverlayActive(
        getServiceRoleSupabase(),
        resolvedSession,
        key as V2OverlayKey,
      );
    } catch {
      // Probe failure must not crash the overlay route — fall back to
      // hidden so a broken DB read does not flash stale data on stream.
      isActive = false;
    }
  } else {
    // No session resolved (no live broadcast) — keep overlay hidden.
    isActive = false;
  }

  // 2026-04-26 lower-third slot isolation — broadcast control mounts
  // 3 mini-preview iframes (one per slot 1..3). Each card passes
  // `?slot=N` so the static HTML can hide the other anchors + drop
  // postMessages / realtime targeting other slots. OBS URLs leave it
  // null so all 3 anchors render simultaneously on stream.
  const slotParsed = (() => {
    const n = Number(slot);
    return n === 1 || n === 2 || n === 3 ? (n as 1 | 2 | 3) : null;
  })();

  // Ambient mode — only enabled for non-preview (live OBS / vMix) URLs.
  // Mini-previews in the broadcast control room embed `?preview=1` so they
  // stay pinned to the operator-picked session and never auto-swap.
  const ambient = !isPreview;

  return (
    <>
      <style
        id="overlay-design-tokens"
        dangerouslySetInnerHTML={{ __html: cssVarRule }}
      />
      {previewVarRule ? (
        <style
          id="preview-tokens"
          dangerouslySetInnerHTML={{ __html: previewVarRule }}
        />
      ) : null}
      <OverlayDataInjector
        overlayKey={key}
        sessionId={resolvedSession}
        token={resolvedToken}
        seasonId={resolvedSeason ?? undefined}
        active={isActive}
        slot={slotParsed}
        ambient={ambient}
        demo={isDemo}
        designTokens={designTokens}
        previewTokens={previewTokens ?? undefined}
        designTextTokens={designTextTokens}
        previewTextTokens={previewTextTokens ?? undefined}
        designPartnerTokens={designPartnerTokens}
        previewPartnerTokens={previewPartnerTokens ?? undefined}
        designAnimTokens={designAnimWire}
        previewAnimTokens={previewAnimTokens ?? undefined}
      />
    </>
  );
}
