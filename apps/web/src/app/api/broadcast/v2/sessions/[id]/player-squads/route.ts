import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { getPlayerHeadshotUrl } from "@/lib/player-photos";
import { weekStartThursday } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Initial-state feed for `/overlay/v2/19-player-squads`.
 *
 * Returns ONE squad submission for the requested player + week. The
 * broadcast control panel pins which player's draft to show via
 * overlay_events payload (`{ playerId: "..." }`); when no pin exists,
 * the endpoint resolves the most recently-triggered playerId for this
 * session, falling back to the first player alphabetically with an
 * approved squad for the current week.
 *
 * Query params:
 *   `?playerId=<uuid>` — explicit player whose draft to render. OPTIONAL.
 *   `?week=<YYYY-MM-DD>` — Thursday-anchored week start (WAT). OPTIONAL,
 *     defaults to the current week (now → weekStartThursday(now)).
 *   `?t=<view_token>` — session view token (constant-time gate).
 *
 * Response shape:
 *   {
 *     payload: {
 *       draftOwner: { playerId, displayName, gamerTag, headshotUrl },
 *       submission: { id, weekStartDate, validationStatus, submittedAt },
 *       formation: string | null,        // derived from starting positions
 *       chemistry: string | null,        // not in DB → always null
 *       starting: SquadItem[],           // slot_index 0..10
 *       subs: SquadItem[]                // slot_index 11..22 truncated to 12
 *     } | null,
 *     seasonId: string | null,
 *     channel: string                    // realtime channel
 *   }
 *
 * `payload: null` when the requested player has no live submission for
 * the requested week — overlay shows the placeholder text "(no draft
 * submitted)" rather than crashing.
 *
 * Cache-Control: no-store. Submissions can be revalidated mid-stream
 * via squad_submissions.* events; OBS browser sources should always
 * fetch fresh on subsequent triggers.
 */

type SquadItem = {
  slotIndex: number;
  name: string;
  rating: number;
  position: string;
  itemType: string;
  nationalityFlag: string | null;
  value: number;
  // Enriched via fc26_players JOIN by (LOWER(name), rating).
  // Null when no match found (rare — Faruk's submission has 100% match rate).
  cardImageUrl: string | null;   // player face (futbin /img/players/<id>.png)
  cardBgUrl: string | null;      // FUT card frame (futbin /img/cards/tiny/<variant>.png)
  mains: {
    pac: number | null;
    sho: number | null;
    pas: number | null;
    dri: number | null;
    def: number | null;
    phy: number | null;
  } | null;
  weakFoot: number | null;
  skillMoves: number | null;
};

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

  const url = new URL(req.url);
  const requestedPlayerId = url.searchParams.get("playerId");
  const requestedWeek = url.searchParams.get("week");

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

  let seasonId: string | null = null;
  if (sess.match_day_id) {
    const { data: mdRaw } = await sb
      .from("match_days")
      .select("season_id")
      .eq("id", sess.match_day_id)
      .maybeSingle();
    seasonId = (mdRaw as { season_id: string } | null)?.season_id ?? null;
  }

  // Default to the current Thursday-anchored week.
  const weekStartDate = requestedWeek || weekStartThursday(new Date());

  // Resolve playerId. Priority:
  //   1. ?playerId= param (explicit pin from control panel postMessage
  //      OR a deep link from the design-page preview).
  //   2. First player (by display_name asc) with an approved/pending
  //      submission this week.
  //
  // The legacy `overlay_events.template_key` fallback used by the H2H
  // family doesn't apply here: the control panel sends `playerId` in
  // the postMessage `data` field on Trigger, and the static HTML's
  // `update(data)` re-fetches this endpoint with the explicit param.
  let resolvedPlayerId = requestedPlayerId;

  if (!resolvedPlayerId) {
    const { data: subsForWeek } = await sb
      .from("squad_submissions")
      .select("player_id")
      .eq("week_start_date", weekStartDate)
      .is("deleted_at", null)
      .neq("validation_status", "rejected")
      .limit(50);
    const candidatePlayerIds = Array.from(
      new Set(((subsForWeek ?? []) as Array<{ player_id: string }>).map((r) => r.player_id)),
    );
    if (candidatePlayerIds.length > 0) {
      const { data: playersRaw } = await sb
        .from("players")
        .select("id, users:users!players_user_id_fkey(display_name)")
        .in("id", candidatePlayerIds)
        .is("deleted_at", null)
        .order("id", { ascending: true });
      type PlayerRow = {
        id: string;
        users:
          | { display_name: string | null }
          | { display_name: string | null }[]
          | null;
      };
      const playersList = (playersRaw ?? []) as unknown as PlayerRow[];
      const usersDisplay = (
        u: PlayerRow["users"],
      ): string => {
        const flat = Array.isArray(u) ? u[0] : u;
        return flat?.display_name ?? "";
      };
      playersList.sort((a, b) =>
        usersDisplay(a.users)
          .toUpperCase()
          .localeCompare(usersDisplay(b.users).toUpperCase()),
      );
      resolvedPlayerId = playersList[0]?.id ?? null;
    }
  }

  const channel = `public:squads:${seasonId ?? "none"}:${weekStartDate}`;

  if (!resolvedPlayerId) {
    return NextResponse.json(
      { payload: null, seasonId, channel },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
    );
  }

  // Hydrate the player's display row.
  const { data: playerRaw } = await sb
    .from("players")
    .select("id, gamer_tag, users:users!players_user_id_fkey(display_name)")
    .eq("id", resolvedPlayerId)
    .is("deleted_at", null)
    .maybeSingle();
  type PlayerLookup = {
    id: string;
    gamer_tag: string | null;
    users:
      | { display_name: string | null }
      | { display_name: string | null }[]
      | null;
  };
  const playerRow = playerRaw as unknown as PlayerLookup | null;
  const playerUsers = playerRow
    ? Array.isArray(playerRow.users)
      ? playerRow.users[0]
      : playerRow.users
    : null;
  const player = playerRow
    ? { id: playerRow.id, gamer_tag: playerRow.gamer_tag, users: playerUsers }
    : null;

  if (!player) {
    return NextResponse.json(
      { payload: null, seasonId, channel },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
    );
  }

  const displayName = player.users?.display_name ?? player.gamer_tag ?? "Player";
  const headshotUrl =
    getPlayerHeadshotUrl(player.gamer_tag, "transparent", 1) ?? null;

  // Live submission for this week. If the operator didn't pin a specific
  // `?week=`, fall back to the player's MOST RECENT submission so the
  // overlay always has something to render between submission windows.
  // The exact-week match still wins when present.
  const { data: exactRaw } = await sb
    .from("squad_submissions")
    .select("id, week_start_date, validation_status, submitted_at")
    .eq("player_id", resolvedPlayerId)
    .eq("week_start_date", weekStartDate)
    .is("deleted_at", null)
    .maybeSingle();
  type SubmissionRow = {
    id: string;
    week_start_date: string;
    validation_status: string;
    submitted_at: string;
  };
  let submission = exactRaw as SubmissionRow | null;
  if (!submission && !requestedWeek) {
    const { data: latestRaw } = await sb
      .from("squad_submissions")
      .select("id, week_start_date, validation_status, submitted_at")
      .eq("player_id", resolvedPlayerId)
      .is("deleted_at", null)
      .order("week_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    submission = latestRaw as SubmissionRow | null;
  }

  if (!submission) {
    return NextResponse.json(
      {
        payload: {
          draftOwner: {
            playerId: player.id,
            displayName,
            gamerTag: player.gamer_tag,
            headshotUrl,
          },
          submission: null,
          formation: null,
          chemistry: null,
          starting: [],
          subs: [],
        },
        seasonId,
        channel,
      },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
    );
  }

  // Items, sorted by slot.
  const { data: itemsRaw } = await sb
    .from("squad_player_items")
    .select(
      "slot_index, name, rating, position, value, item_type, nationality_flag",
    )
    .eq("submission_id", submission.id)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });

  type SquadRow = {
    slot_index: number;
    name: string;
    rating: number;
    position: string;
    value: number;
    item_type: string;
    nationality_flag: string | null;
  };
  const itemRows = (itemsRaw ?? []) as SquadRow[];

  // Enrich every item via fc26_players. Match by (LOWER(name), rating)
  // against `source_dataset='futbin.com'` rows — those are the only
  // cards with `attributes.card_image_url` populated (Kaggle / fut.gg
  // rows are kept for provenance but lack the image). 100% hit rate
  // confirmed against existing Faruk submission (2026-04-30).
  type FcRow = {
    name: string;
    rating: number;
    attributes: Record<string, unknown> | null;
  };
  let enrichByKey = new Map<string, FcRow>();
  if (itemRows.length > 0) {
    const namesUnique = Array.from(new Set(itemRows.map((r) => r.name)));
    const { data: fcRaw } = await sb
      .from("fc26_players")
      .select("name, rating, attributes")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .in("name", namesUnique);
    const fcRows = (fcRaw ?? []) as FcRow[];
    enrichByKey = new Map(
      fcRows.map((r) => [`${r.name.toLowerCase()}|${r.rating}`, r]),
    );
  }
  function lookup(name: string, rating: number): FcRow | undefined {
    return enrichByKey.get(`${name.toLowerCase()}|${rating}`);
  }
  function intOrNull(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // FUTBIN signs every image URL (`s=<HMAC>`) at the table-thumbnail
  // size of `w=64`; bumping the `w=` param invalidates the signature.
  // Wrap the URL in our `/api/img/upscale` proxy which fetches the 64px
  // source, runs Sharp Lanczos3 at 4x, and serves a 256-wide PNG.
  // Cards in the broadcast overlay then display crisply at 116-200px
  // without browser CSS-scaling blur. Skip when the URL isn't on the
  // FUTBIN host (allowlist mismatch → proxy would 400 anyway).
  function upscale(rawUrl: string | null, w = 256): string | null {
    if (!rawUrl) return null;
    try {
      const u = new URL(rawUrl);
      if (u.hostname !== "cdn3.futbin.com") return rawUrl;
      return `/api/img/upscale?url=${encodeURIComponent(rawUrl)}&w=${w}`;
    } catch {
      return rawUrl;
    }
  }

  const allItems: SquadItem[] = itemRows.map((r) => {
    const fc = lookup(r.name, r.rating);
    const attrs = (fc?.attributes ?? {}) as Record<string, unknown>;
    const mainsRaw = (attrs["mains"] ?? null) as Record<string, unknown> | null;
    return {
      slotIndex: r.slot_index,
      name: r.name,
      rating: r.rating,
      position: r.position,
      itemType: r.item_type,
      nationalityFlag: r.nationality_flag,
      value: Number(r.value ?? 0),
      cardImageUrl: upscale(
        typeof attrs["card_image_url"] === "string"
          ? (attrs["card_image_url"] as string)
          : null,
        256,
      ),
      cardBgUrl: upscale(
        typeof attrs["card_bg_url"] === "string"
          ? (attrs["card_bg_url"] as string)
          : null,
        320,
      ),
      mains: mainsRaw
        ? {
            pac: intOrNull(mainsRaw["pac"]),
            sho: intOrNull(mainsRaw["sho"]),
            pas: intOrNull(mainsRaw["pas"]),
            dri: intOrNull(mainsRaw["dri"]),
            def: intOrNull(mainsRaw["def"]),
            phy: intOrNull(mainsRaw["phy"]),
          }
        : null,
      weakFoot: intOrNull(attrs["weak_foot"]),
      skillMoves: intOrNull(attrs["skill_moves"]),
    };
  });

  const starting = allItems.filter((i) => i.slotIndex >= 0 && i.slotIndex <= 10);
  const subs = allItems.filter((i) => i.slotIndex >= 11 && i.slotIndex <= 22);

  // Best-effort formation derivation from starting positions. Counts D/M/F
  // based on conventional position groupings; falls back to null when fewer
  // than 11 starters are present.
  const formation = deriveFormation(starting);

  return NextResponse.json(
    {
      payload: {
        draftOwner: {
          playerId: player.id,
          displayName,
          gamerTag: player.gamer_tag,
          headshotUrl,
        },
        submission: {
          id: submission.id,
          weekStartDate: submission.week_start_date,
          validationStatus: submission.validation_status,
          submittedAt: submission.submitted_at,
        },
        formation,
        chemistry: null,
        starting,
        subs,
      },
      seasonId,
      channel,
    },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}

const DEF_POSITIONS = new Set(["GK", "CB", "LB", "RB", "LWB", "RWB", "SW"]);
const MID_POSITIONS = new Set([
  "CM",
  "CDM",
  "CAM",
  "LM",
  "RM",
  "LW",
  "RW",
]);
const FWD_POSITIONS = new Set(["ST", "CF", "LF", "RF", "LW", "RW"]);

function deriveFormation(items: SquadItem[]): string | null {
  if (items.length < 11) return null;
  let d = 0;
  let m = 0;
  let f = 0;
  let gk = 0;
  for (const it of items) {
    const p = (it.position || "").toUpperCase();
    if (p === "GK") {
      gk += 1;
    } else if (DEF_POSITIONS.has(p)) {
      d += 1;
    } else if (MID_POSITIONS.has(p) && !FWD_POSITIONS.has(p)) {
      m += 1;
    } else if (FWD_POSITIONS.has(p)) {
      f += 1;
    }
  }
  if (gk + d + m + f < 10) return null;
  return `${d}-${m}-${f}`;
}
