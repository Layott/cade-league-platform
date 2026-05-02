// Shared diff-aware upsert for Futbin scrapers.
//
// Goal: only write to fc26_players when the scraped row has a real change
// (price, card image, main stats, weak foot, skill moves, meta rating,
// variant, item_type). Identical re-scrapes are no-ops — no UPDATE, no
// audit noise, no `updated_at` churn, no wasted Realtime broadcasts.
//
// Returns per row: { status, diff }
//   status: "unchanged" | "inserted" | "updated"
//   diff:   array of string field names that changed (for logging)
//
// Contract: caller has ALREADY parsed prices + computed item_type.
// See _scrape_futbin_headful.js for the full scrape pipeline.

const { classifyVariant } = require("./_classify_variant");

function buildAttrs(r, coinsPs, coinsPc, existingAttrs) {
  const attrs = existingAttrs && typeof existingAttrs === "object" ? { ...existingAttrs } : {};
  attrs.price_source = "futbin_live";
  attrs.price_snapshot_at = new Date().toISOString();
  attrs.futbin_resource_id = r.resourceId;
  attrs.futbin_variant = r.variant || "normal";
  attrs.platform_prices = { ps: coinsPs, pc: coinsPc };
  if (r.stats) attrs.mains = r.stats;
  if (r.weakFoot != null) attrs.weak_foot = r.weakFoot;
  if (r.skillMoves != null) attrs.skill_moves = r.skillMoves;
  if (r.popularity != null) attrs.popularity = r.popularity;
  if (r.metaTag) attrs.futbin_meta_rating = r.metaTag;
  if (r.cardImageUrl) {
    attrs.card_image_url = r.cardImageUrl.startsWith("http")
      ? r.cardImageUrl
      : `https://www.futbin.com${r.cardImageUrl}`;
  }
  // Card frame background (the designed card art — gold/icon/hero/promo
  // shell). Rendered behind the player portrait in the picker so the
  // card looks like the Futbin original, not a black rectangle.
  if (r.cardBgUrl) {
    attrs.card_bg_url = r.cardBgUrl.startsWith("http")
      ? r.cardBgUrl
      : `https://www.futbin.com${r.cardBgUrl}`;
  }
  // Futbin-internal IDs for nation / league / club — parsed from the
  // row-level icon CDN paths. Futbin doesn't ship raw ISO codes or
  // readable names on the list page (they're purely image assets keyed
  // by Futbin's internal registry), so we capture the IDs and resolve
  // them to human-readable values via a separate mapping. Chief use
  // case: the Nigerian-in-starting-XI count, which keys off these IDs
  // when `nation_iso` is empty on a Futbin-sourced row.
  if (r.nationId != null) attrs.futbin_nation_id = r.nationId;
  if (r.leagueId != null) attrs.futbin_league_id = r.leagueId;
  if (r.clubId != null) attrs.futbin_club_id = r.clubId;
  // Full CDN flag/logo URL (signed imgix). Useful where a UI surface
  // wants to render the Futbin-styled flag directly without rebuilding
  // the CDN path from the integer ID. Futbin's <img class="nation">
  // exposes only `src` (no alt/title) so the human-readable nation
  // name is resolved post-scrape via _backfill_nationality.js mapping
  // the futbin_nation_id → ISO/name.
  if (r.nationFlagUrl) {
    attrs.nation_flag_url = r.nationFlagUrl.startsWith("http")
      ? r.nationFlagUrl
      : `https://www.futbin.com${r.nationFlagUrl}`;
  }
  if (r.leagueFlagUrl) {
    attrs.league_logo_url = r.leagueFlagUrl.startsWith("http")
      ? r.leagueFlagUrl
      : `https://www.futbin.com${r.leagueFlagUrl}`;
  }
  if (r.clubLogoUrl) {
    attrs.club_logo_url = r.clubLogoUrl.startsWith("http")
      ? r.clubLogoUrl
      : `https://www.futbin.com${r.clubLogoUrl}`;
  }
  return attrs;
}

function diffFields(oldRow, newCoins, newItemType, newAttrs) {
  const changes = [];
  const oldAttrs = oldRow.attributes || {};
  if (oldRow.value_coins_estimate !== newCoins) changes.push("price");
  if (oldRow.item_type !== newItemType) changes.push("item_type");
  if ((oldAttrs.card_image_url || null) !== (newAttrs.card_image_url || null)) changes.push("card_image");
  // Card frame background (the gold/silver/bronze/icon/hero shell image
  // from Futbin's /img/cards/tiny/ CDN path, signed with imgix HMAC).
  // MUST be diffed — prior to this check a row that had `card_bg_url`
  // freshly captured by a re-scrape (silvers + bronzes pre-86e4aba),
  // but whose price/stats/image were otherwise unchanged, would be
  // labelled "unchanged" and the UPDATE skipped → the bg never landed
  // in the DB and the picker kept rendering a black rectangle. This
  // single comparison was the primary reason 12,931 rows still lacked
  // bg after the selector fix shipped.
  if ((oldAttrs.card_bg_url || null) !== (newAttrs.card_bg_url || null)) changes.push("card_bg");
  if ((oldAttrs.futbin_variant || null) !== (newAttrs.futbin_variant || null)) changes.push("variant");
  if ((oldAttrs.futbin_meta_rating || null) !== (newAttrs.futbin_meta_rating || null)) changes.push("meta");
  if ((oldAttrs.weak_foot ?? null) !== (newAttrs.weak_foot ?? null)) changes.push("weak_foot");
  if ((oldAttrs.skill_moves ?? null) !== (newAttrs.skill_moves ?? null)) changes.push("skill_moves");
  const oldStats = oldAttrs.mains || {};
  const newStats = newAttrs.mains || {};
  for (const k of ["pac", "sho", "pas", "dri", "def", "phy"]) {
    if ((oldStats[k] ?? null) !== (newStats[k] ?? null)) { changes.push(`stats.${k}`); break; }
  }
  const oldPS = oldAttrs.platform_prices?.ps ?? null;
  const oldPC = oldAttrs.platform_prices?.pc ?? null;
  const newPS = newAttrs.platform_prices?.ps ?? null;
  const newPC = newAttrs.platform_prices?.pc ?? null;
  if (oldPS !== newPS) changes.push("ps_price");
  if (oldPC !== newPC) changes.push("pc_price");
  // Futbin-internal registry IDs — trigger a re-write when any of the
  // three shift (rare but happens: league reassignment, transfer). Keeps
  // downstream consumers (Nigerian check, league filters) in sync.
  if ((oldAttrs.futbin_nation_id ?? null) !== (newAttrs.futbin_nation_id ?? null)) changes.push("nation_id");
  if ((oldAttrs.futbin_league_id ?? null) !== (newAttrs.futbin_league_id ?? null)) changes.push("league_id");
  if ((oldAttrs.futbin_club_id ?? null) !== (newAttrs.futbin_club_id ?? null)) changes.push("club_id");
  // Flag / logo CDN URLs. Diff so a row that previously lacked the URL
  // but now has it (post-scraper-patch re-run) gets persisted. URL
  // signatures change when Futbin re-signs the imgix HMAC — strip the
  // query string before comparing to avoid unnecessary churn.
  const stripQS = (u) => (u || "").split("?")[0];
  if (stripQS(oldAttrs.nation_flag_url) !== stripQS(newAttrs.nation_flag_url)) changes.push("nation_flag_url");
  if (stripQS(oldAttrs.league_logo_url) !== stripQS(newAttrs.league_logo_url)) changes.push("league_logo_url");
  if (stripQS(oldAttrs.club_logo_url) !== stripQS(newAttrs.club_logo_url)) changes.push("club_logo_url");
  return changes;
}

// Upsert one scraped Futbin row with diff-aware semantics.
//   sb        — supabase service-role client
//   r         — scraped row: { resourceId, name, rating, position, variant,
//                              pricePs, pricePc, stats, weakFoot, skillMoves,
//                              popularity, metaTag, cardImageUrl, slug }
//   coinsPs/coinsPc — pre-parsed numeric coin values (null if extinct)
//   stats     — mutable counters object (inserted/updated/unchanged/noPrice)
//
// Caller responsibility: parseCoins + supply slug. We do not re-parse
// here to keep the helper thin.
async function diffUpsertFutbinRow(sb, r, coinsPs, coinsPc, slug, stats) {
  const coins = coinsPs || coinsPc;
  if (!coins) { stats.noPrice++; return { status: "skipped", diff: [] }; }

  const sourceRowId = `futbin_${r.resourceId}`;
  const itemType = classifyVariant(r.variant);

  const { data: exist } = await sb
    .from("fc26_players")
    .select("id, value_coins_estimate, item_type, attributes")
    .eq("source_dataset", "futbin.com")
    .eq("source_row_id", sourceRowId)
    .is("deleted_at", null)
    .maybeSingle();

  const newAttrs = buildAttrs(r, coinsPs, coinsPc, exist?.attributes);

  if (!exist) {
    await sb.from("fc26_players").insert({
      source_dataset: "futbin.com",
      source_row_id: sourceRowId,
      name: r.name,
      slug,
      rating: r.rating,
      position: r.position || "ST",
      item_type: itemType,
      value_coins_estimate: coins,
      attributes: newAttrs,
    });
    stats.inserted++;
    return { status: "inserted", diff: [] };
  }

  const changes = diffFields(exist, coins, itemType, newAttrs);
  if (changes.length === 0) {
    // Price snapshot timestamp differs, but nothing else. Skip the write —
    // saves audit + realtime noise. Users don't see snapshot timestamps.
    stats.unchanged = (stats.unchanged || 0) + 1;
    return { status: "unchanged", diff: [] };
  }

  await sb.from("fc26_players").update({
    value_coins_estimate: coins,
    item_type: itemType,
    attributes: newAttrs,
    updated_at: new Date().toISOString(),
  }).eq("id", exist.id);
  stats.updated++;
  return { status: "updated", diff: changes };
}

module.exports = { diffUpsertFutbinRow, buildAttrs, diffFields };
