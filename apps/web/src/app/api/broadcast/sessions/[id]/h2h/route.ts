import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { buildH2HCards, type H2HCard } from "@/server/standings/h2h_view";
import { REALTIME } from "@/server/overlays/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Phase B4-B5 + C — live data feed for the v2 H2H overlays
 * (`/overlay/v2/04-h2h-2`, `/05-h2h-3`, `/06-h2h-5`).
 *
 * Auth: same `view_token` gate as the other unauthenticated overlay
 * endpoints (`/leaderboard`, `/top-scorers`, `/match-scores-day`). This is
 * for OBS / vMix browser sources, NOT the admin React surface — the
 * authenticated `/api/tournament/h2h` route still gates on
 * `tournament.read` for the admin H2H lookup tab.
 *
 * Query params:
 *   `?ids=A,B[,C][,D][,E]` — comma-separated player UUIDs (1..5).
 *     OPTIONAL. When omitted, the endpoint resolves the pinned players
 *     from the latest `overlay_events` row for the matching template_key
 *     (`h2h_2` / `h2h_3` / `h2h_5`) on this session — broadcast control
 *     panel writes `players: [{displayName}]` into payload on Trigger.
 *     Fallback path lets the static HTML simply call
 *     `/api/broadcast/sessions/<id>/h2h?key=04-h2h-2` and have the server
 *     do the resolution end-to-end.
 *   `?key=04-h2h-2|05-h2h-3|06-h2h-5` — overlay key. Used to look up the
 *     matching template_key when `ids` is omitted.
 *   `?t=<view_token>` — the session's view token (verified constant-time).
 *
 * Response shape:
 *   {
 *     cards: H2HCard[];
 *     seasonId: string;
 *     channel: "public:standings:<seasonId>";
 *   }
 *
 * `cards` is an empty array when:
 *   - the session has no live season (no match_day attached),
 *   - the player ids fail to resolve to standings rows,
 *   - the latest overlay_events payload has no players.
 *
 * Cache-Control: no-store. Browser sources can stay open for hours and
 * we never want a stale H2H stat row pinned across a redeploy.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await enforcePublicRead(req);
  if (limited) return limited;

  const { id } = await params;
  const sb = getServiceRoleSupabase();

  const gate = await checkViewToken(sb, req, id);
  if (!gate.ok) return gate.response;

  // Resolve session → match_day → season.
  const { data: sessRaw, error: sessErr } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (sessErr || !sessRaw) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const sess = sessRaw as { id: string; match_day_id: string | null };

  if (!sess.match_day_id) {
    return NextResponse.json({
      cards: [] as H2HCard[],
      seasonId: null,
      channel: null,
    });
  }

  const { data: mdRaw, error: mdErr } = await sb
    .from("match_days")
    .select("id, season_id")
    .eq("id", sess.match_day_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (mdErr || !mdRaw) {
    return NextResponse.json({ error: "match_day not found" }, { status: 404 });
  }
  const md = mdRaw as { id: string; season_id: string };

  // Resolve player ids — explicit `?ids=` wins; otherwise pick up from the
  // latest overlay_events.payload for the matching template_key.
  const url = req.nextUrl;
  const idsParam = url.searchParams.get("ids");
  const overlayKey = url.searchParams.get("key");

  let ids: string[];
  if (idsParam && idsParam.trim().length > 0) {
    const parsed = parseIds(idsParam);
    if (parsed === null || parsed.length < 1 || parsed.length > 5) {
      return NextResponse.json({ error: "invalid ids" }, { status: 400 });
    }
    ids = parsed;
  } else {
    const templateKey = OVERLAY_KEY_TO_TEMPLATE_KEY[overlayKey ?? ""] ?? null;
    if (!templateKey) {
      return NextResponse.json({ error: "missing ids and key" }, { status: 400 });
    }
    const resolved = await resolvePinnedPlayerIds(sb, id, templateKey);
    if (resolved === null) {
      // No active overlay_events row → return empty cards. The static
      // HTML keeps the placeholder shape; nothing to show until the
      // operator triggers.
      return NextResponse.json(
        {
          cards: [] as H2HCard[],
          seasonId: md.season_id,
          channel: REALTIME.standingsChannel(md.season_id),
        },
        {
          headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
        },
      );
    }
    ids = resolved;
  }

  try {
    const cards = await buildH2HCards(sb, md.season_id, ids);
    return NextResponse.json(
      {
        cards,
        seasonId: md.season_id,
        channel: REALTIME.standingsChannel(md.season_id),
      },
      {
        headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "h2h read failed" },
      { status: 500 },
    );
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict UUID-list parser. Returns null when any token fails the UUID
 * regex (defends against header-injection / control-char smuggling
 * through the query string).
 */
function parseIds(raw: string): string[] | null {
  const tokens = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (tokens.length === 0) return null;
  for (const t of tokens) {
    if (!UUID_RE.test(t)) return null;
  }
  return tokens;
}

/**
 * Map of v2 overlay key → legacy template_key. The h2h family is the
 * only concern of this endpoint; other keys are routed through their own
 * `/api/broadcast/sessions/[id]/<feed>` paths.
 */
const OVERLAY_KEY_TO_TEMPLATE_KEY: Record<string, string> = {
  "04-h2h-2": "h2h_2",
  "05-h2h-3": "h2h_3",
  "06-h2h-5": "h2h_5",
};

/**
 * Read the latest non-cleared overlay_events row for the given session +
 * template_key, decode `payload.players[]` (each `{displayName}`), and
 * resolve those names to player UUIDs via the gamer_tag → user → player
 * chain.
 *
 * Returns:
 *   - `string[]` of player ids (in payload order) on success,
 *   - `null` when no active overlay row exists,
 *   - `null` when the payload has no resolvable players (so the endpoint
 *     can short-circuit to an empty `cards` response without blowing up).
 *
 * Resolution rule: each `displayName` is matched against `users.gamer_tag`
 * (case-insensitive uppercase). The displayName values written by the
 * broadcast control panel come from `V2_PLAYER_NAMES` which mirrors the
 * `users.gamer_tag` set verbatim, so this is a direct lookup.
 */
async function resolvePinnedPlayerIds(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  sessionId: string,
  templateKey: string,
): Promise<string[] | null> {
  // Look up the latest active overlay_events row for this session +
  // template_key. The control panel writes one row per Trigger; OFF
  // sets `cleared_at` (we exclude those).
  const { data: rows } = await sb
    .from("overlay_events")
    .select(
      `
      id,
      payload,
      triggered_at,
      overlay_templates:template_id ( template_key )
      `,
    )
    .eq("stream_session_id", sessionId)
    .is("cleared_at", null)
    .is("deleted_at", null)
    .order("triggered_at", { ascending: false })
    .limit(20);

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  type EventRow = {
    id: string;
    payload: Record<string, unknown> | null;
    overlay_templates: { template_key: string } | { template_key: string }[] | null;
  };

  const matched = (rows as unknown as EventRow[]).find((r) => {
    const tpl = r.overlay_templates;
    if (!tpl) return false;
    if (Array.isArray(tpl)) {
      return tpl.some((t) => t.template_key === templateKey);
    }
    return tpl.template_key === templateKey;
  });

  if (!matched) return null;

  const payload = matched.payload ?? {};
  const players = Array.isArray(
    (payload as { players?: unknown }).players,
  )
    ? ((payload as { players: unknown[] }).players as unknown[])
    : [];

  const displayNames: string[] = [];
  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    const dn = (p as { displayName?: unknown }).displayName;
    if (typeof dn === "string" && dn.trim().length > 0) {
      displayNames.push(dn.trim().toUpperCase());
    }
  }
  if (displayNames.length === 0) return null;

  // Resolve displayName → users.gamer_tag → users.id → players.id.
  const { data: userRows } = await sb
    .from("users")
    .select("id, gamer_tag")
    .in("gamer_tag", displayNames)
    .is("deleted_at", null);

  if (!userRows || userRows.length === 0) return null;

  type UserRow = { id: string; gamer_tag: string };
  const userByTag = new Map<string, string>();
  for (const u of userRows as UserRow[]) {
    if (u.gamer_tag) userByTag.set(u.gamer_tag.toUpperCase(), u.id);
  }

  const userIds: string[] = [];
  for (const dn of displayNames) {
    const uid = userByTag.get(dn);
    if (uid) userIds.push(uid);
  }
  if (userIds.length === 0) return null;

  const { data: playerRows } = await sb
    .from("players")
    .select("id, user_id")
    .in("user_id", userIds)
    .is("deleted_at", null);

  if (!playerRows || playerRows.length === 0) return null;

  type PlayerRow = { id: string; user_id: string };
  const playerByUser = new Map<string, string>();
  for (const p of playerRows as PlayerRow[]) {
    playerByUser.set(p.user_id, p.id);
  }

  // Re-order to match payload order so the overlay slots align with the
  // operator's selection.
  const out: string[] = [];
  for (const dn of displayNames) {
    const uid = userByTag.get(dn);
    if (!uid) continue;
    const pid = playerByUser.get(uid);
    if (pid) out.push(pid);
  }
  return out.length > 0 ? out : null;
}
