import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "./registry";

/**
 * Card-Meta data feed for the 26-card-meta cover-up overlay.
 *
 * Counts every confirmed-active squad_player_item across the season's
 * squad_submissions, groups by resolved_fc_player_id, joins to
 * fc26_players for card-bg + card-face + rating + name, and returns the
 * top N picks with a percent-of-submissions counter.
 *
 * Picks per submission are 1 each (no duplicates within a submission's
 * 11-slot squad) so percent = uniqueSubmissionsPickingCard / totalSubmissions.
 */

export type CardMetaRow = {
  rank: number;
  fcPlayerId: string;
  name: string;
  rating: number | null;
  itemType: string | null;
  position: string | null;
  isGoalkeeper: boolean;
  /**
   * Six main stats (0-99). Same key shape for outfield + GK — the
   * overlay swaps labels (PAC/SHO/PAS/DRI/DEF/PHY ↔ DIV/HAN/KIC/REF/SPE/POS)
   * based on `isGoalkeeper`. Null when the scraper hasn't populated
   * `attributes.mains` for that card yet.
   */
  mainStats: {
    pac: number | null;
    sho: number | null;
    pas: number | null;
    dri: number | null;
    def: number | null;
    phy: number | null;
  } | null;
  cardBgUrl: string | null;
  cardFaceUrl: string | null;
  pickCount: number;
  pickPct: number;
};

export type CardMetaResult = {
  seasonId: string;
  channel: string;
  payload: {
    matchDayLabel: string;
    totalSubmissions: number;
    cards: CardMetaRow[];
  };
};

type ItemJoin = {
  submission_id: string;
  resolved_fc_player_id: string | null;
  fc_player:
    | {
        id: string;
        name: string;
        rating: number | null;
        position: string | null;
        item_type: string | null;
        attributes: Record<string, unknown> | null;
      }
    | null;
};

function readMainStats(attrs: Record<string, unknown> | null): {
  pac: number | null;
  sho: number | null;
  pas: number | null;
  dri: number | null;
  def: number | null;
  phy: number | null;
} | null {
  if (!attrs || typeof attrs !== "object") return null;
  const m = attrs["mains"];
  if (!m || typeof m !== "object") return null;
  const rec = m as Record<string, unknown>;
  const toInt = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    pac: toInt(rec.pac),
    sho: toInt(rec.sho),
    pas: toInt(rec.pas),
    dri: toInt(rec.dri),
    def: toInt(rec.def),
    phy: toInt(rec.phy),
  };
}

export async function fetchCardMetaData(
  sb: SupabaseClient,
  seasonId: string,
  topN: number = 8,
): Promise<CardMetaResult> {
  // 1. Active submissions in the season.
  const { data: subs } = await sb
    .from("squad_submissions")
    .select("id, week_start_date")
    .eq("season_id", seasonId)
    .eq("validation_status", "approved")
    .is("deleted_at", null);
  const subIds = (subs ?? []).map((s) => (s as { id: string }).id);
  const totalSubmissions = subIds.length;

  if (totalSubmissions === 0) {
    return {
      seasonId,
      channel: REALTIME.standingsChannel(seasonId),
      payload: { matchDayLabel: "WEEK 0 SUBMISSIONS", totalSubmissions: 0, cards: [] },
    };
  }

  // 2. Items across those submissions joined to fc26_players.
  const { data: itemsRaw } = await sb
    .from("squad_player_items")
    .select(
      `
      submission_id,
      resolved_fc_player_id,
      fc_player:resolved_fc_player_id ( id, name, rating, position, item_type, attributes )
      `,
    )
    .in("submission_id", subIds)
    .is("deleted_at", null);

  const items: ItemJoin[] = ((itemsRaw ?? []) as unknown as ItemJoin[]).filter(
    (i) => i.resolved_fc_player_id && i.fc_player,
  );

  // 3. Group by fc_player_id → unique submissions picking it.
  type Accum = {
    fcPlayerId: string;
    name: string;
    rating: number | null;
    itemType: string | null;
    position: string | null;
    isGoalkeeper: boolean;
    mainStats: CardMetaRow["mainStats"];
    cardBgUrl: string | null;
    cardFaceUrl: string | null;
    submissions: Set<string>;
  };
  const accum = new Map<string, Accum>();
  for (const it of items) {
    if (!it.resolved_fc_player_id || !it.fc_player) continue;
    const fp = it.fc_player;
    // Prefer the locally-mirrored URLs (Supabase Storage) over the
    // raw Futbin CDN ones — Futbin's CDN hot-link-blocks any non-browser
    // origin (see _backfill-card-images.mjs + scraper enhancement). Falls
    // back to the Futbin URL for rows the backfill hasn't touched yet so
    // the field is never undefined in a transitional state.
    const attrs = fp.attributes ?? {};
    const position = fp.position ?? null;
    const entry =
      accum.get(fp.id) ??
      {
        fcPlayerId: fp.id,
        name: fp.name,
        rating: fp.rating,
        itemType: fp.item_type,
        position,
        isGoalkeeper: (position ?? "").toUpperCase() === "GK",
        mainStats: readMainStats(attrs),
        cardBgUrl:
          (attrs["card_bg_local"] as string) ??
          (attrs["card_bg_url"] as string) ??
          null,
        cardFaceUrl:
          (attrs["card_image_local"] as string) ??
          (attrs["card_image_url"] as string) ??
          null,
        submissions: new Set<string>(),
      };
    entry.submissions.add(it.submission_id);
    accum.set(fp.id, entry);
  }

  const ranked: CardMetaRow[] = Array.from(accum.values())
    .map((a) => ({
      rank: 0,
      fcPlayerId: a.fcPlayerId,
      name: a.name,
      rating: a.rating,
      itemType: a.itemType,
      position: a.position,
      isGoalkeeper: a.isGoalkeeper,
      mainStats: a.mainStats,
      cardBgUrl: a.cardBgUrl,
      cardFaceUrl: a.cardFaceUrl,
      pickCount: a.submissions.size,
      pickPct: Math.round((a.submissions.size / totalSubmissions) * 100),
    }))
    .sort((a, b) => b.pickCount - a.pickCount || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, topN)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  // 4. Resolve current match-day label (best-effort).
  const { data: mdRow } = await sb
    .from("match_days")
    .select("match_day_number, played_at")
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const md = mdRow as { match_day_number: number | null; played_at: string | null } | null;
  const matchDayLabel = md?.match_day_number
    ? `MATCH DAY ${md.match_day_number} SUBMISSIONS`
    : "ELITE SEASON 2 SUBMISSIONS";

  return {
    seasonId,
    channel: REALTIME.standingsChannel(seasonId),
    payload: { matchDayLabel, totalSubmissions, cards: ranked },
  };
}
