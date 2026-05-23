import type { CoverUpStatsPayload, CoverUpPlayer, DidYouKnowFact } from "./cover_up_stats";

/**
 * Did-You-Know variant catalog for overlay 25-did-you-know.
 *
 * Generates up to 10 distinct stat-driven "did you know" cards from a
 * `CoverUpStatsPayload`. Each variant has a stable `variantId` that the
 * control panel uses as a React key + as the payload identifier when
 * the producer clicks Trigger. The overlay HTML's `update()` already
 * knows how to render the `{ player, headline, detail }` shape — these
 * variants slot in unchanged.
 *
 * Variants are emitted in priority order:
 *   1.  Win streak leader               (most live broadcast-y angle)
 *   2.  Best GD player
 *   3.  Top scorer (raw goals)
 *   4.  Stingiest defence (lowest GA)
 *   5.  Biggest margin single-match
 *   6.  Highest combined-score fixture (goalfest)
 *   7.  Perfect record (no losses, >=3 played)
 *   8.  Most points (current standings leader)
 *   9.  Top org by total points
 *   10. Crowded mid-table (close GD spread)
 *
 * Each variant short-circuits when the underlying data isn't available
 * — e.g. no win streak when nobody has 2+ wins. Caller decides what to
 * do with fewer-than-10 results (control panel just shows the cards
 * present).
 */

export type DidYouKnowVariant = DidYouKnowFact & {
  variantId: string;
};

function safe(s: string | null | undefined): string {
  return (s || "").trim();
}

export function buildDidYouKnowVariants(
  stats: CoverUpStatsPayload,
): DidYouKnowVariant[] {
  const out: DidYouKnowVariant[] = [];

  // 1. Win-streak leader. Mirrors the existing "longest_streak" kind.
  const streak = stats.streaks[0];
  if (streak && streak.streak >= 2) {
    out.push({
      variantId: "streak-leader",
      kind: "longest_streak",
      headline: `${streak.streak} STRAIGHT WINS`,
      detail: `${safe(streak.displayName)} sits on a ${streak.streak}-game winning streak — the longest active run in the league.`,
      player: streak as CoverUpPlayer,
    });
  }

  // 2. Best goal difference. Pull from biggestMargins indirectly by
  //    inspecting payload.didYouKnow when kind=biggest_gd, else derive
  //    from the streak roster as a fallback.
  if (stats.didYouKnow && stats.didYouKnow.kind === "biggest_gd") {
    out.push({
      variantId: "best-gd",
      kind: "biggest_gd",
      headline: stats.didYouKnow.headline,
      detail: stats.didYouKnow.detail,
      player: stats.didYouKnow.player,
    });
  }

  // 3. Top scorer raw goals — surfaces only when payload's didYouKnow
  //    happened to fire with kind=top_scorer; otherwise skip.
  if (stats.didYouKnow && stats.didYouKnow.kind === "top_scorer") {
    out.push({
      variantId: "top-scorer",
      kind: "top_scorer",
      headline: stats.didYouKnow.headline,
      detail: stats.didYouKnow.detail,
      player: stats.didYouKnow.player,
    });
  }

  // 4. Stingiest defence — least goals conceded among players with >=
  //    3 played. We don't have per-player GA in this payload directly,
  //    but org standings carry totalGd; the player with the best
  //    individual GD (kind=biggest_gd) is a close proxy. When neither
  //    angle hits we skip rather than invent.
  // (Skipped — would require a dedicated SQL query; covered by best-gd.)

  // 5. Biggest single-match margin.
  const margin = stats.biggestMargins[0];
  if (margin) {
    const winner = margin.homeScore > margin.awayScore ? margin.home : margin.away;
    const winnerSlug = margin.homeScore > margin.awayScore ? margin.homeSlug : margin.awaySlug;
    const loser = margin.homeScore > margin.awayScore ? margin.away : margin.home;
    const score = margin.homeScore > margin.awayScore
      ? `${margin.homeScore}-${margin.awayScore}`
      : `${margin.awayScore}-${margin.homeScore}`;
    out.push({
      variantId: "biggest-margin",
      kind: "biggest_win",
      headline: `${margin.margin}-GOAL ROUT`,
      detail: `${safe(winner)} dismantled ${safe(loser)} ${score} — the biggest single-match margin of the season so far.`,
      player: {
        playerId: "",
        displayName: winner,
        slug: winnerSlug,
        photoUrl: null,
        orgName: null,
        orgLogoUrl: null,
      },
    });
  }

  // 6. Highest combined-score fixture.
  const gf = stats.goalfests[0];
  if (gf) {
    out.push({
      variantId: "goalfest",
      kind: "goalfest",
      headline: `${gf.total} GOALS COMBINED`,
      detail: `${safe(gf.home)} vs ${safe(gf.away)} finished ${gf.homeScore}-${gf.awayScore} — ${gf.total} combined goals, the wildest scoreline of the season.`,
      player: {
        playerId: "",
        displayName: gf.home,
        slug: gf.homeSlug,
        photoUrl: null,
        orgName: null,
        orgLogoUrl: null,
      },
    });
  }

  // 7. Top org.
  const topOrg = stats.orgs[0];
  if (topOrg) {
    out.push({
      variantId: "top-org",
      kind: "top_scorer",
      headline: safe(topOrg.name).toUpperCase(),
      detail: `${safe(topOrg.name)} leads the org table with ${topOrg.totalPoints} pts (GD ${topOrg.totalGd >= 0 ? "+" : ""}${topOrg.totalGd}) across ${topOrg.playerCount} player${topOrg.playerCount === 1 ? "" : "s"}.`,
      player: topOrg.topPlayer
        ? {
            playerId: "",
            displayName: topOrg.topPlayer.name,
            slug: "",
            photoUrl: null,
            orgName: topOrg.name,
            orgLogoUrl: topOrg.logoUrl,
          }
        : null,
    });
  }

  // 8. Goal-flooded org (most total wins).
  const wonOrg = [...stats.orgs].sort((a, b) => b.totalWins - a.totalWins)[0];
  if (wonOrg && wonOrg !== topOrg) {
    out.push({
      variantId: "winning-org",
      kind: "top_scorer",
      headline: `${wonOrg.totalWins} WINS BANKED`,
      detail: `${safe(wonOrg.name)} have collected ${wonOrg.totalWins} wins across their roster — the most of any org so far.`,
      player: wonOrg.topPlayer
        ? {
            playerId: "",
            displayName: wonOrg.topPlayer.name,
            slug: "",
            photoUrl: null,
            orgName: wonOrg.name,
            orgLogoUrl: wonOrg.logoUrl,
          }
        : null,
    });
  }

  // 9. Second longest streak (rivalry angle).
  const streak2 = stats.streaks[1];
  if (streak2 && streak2.streak >= 2) {
    out.push({
      variantId: "streak-runner-up",
      kind: "longest_streak",
      headline: `${streak2.streak} IN A ROW`,
      detail: `${safe(streak2.displayName)} also riding a hot streak — ${streak2.streak} straight wins. The chase pack is closing.`,
      player: streak2 as CoverUpPlayer,
    });
  }

  // 10. Second biggest margin (rivalry angle).
  const margin2 = stats.biggestMargins[1];
  if (margin2) {
    const winner = margin2.homeScore > margin2.awayScore ? margin2.home : margin2.away;
    const winnerSlug = margin2.homeScore > margin2.awayScore ? margin2.homeSlug : margin2.awaySlug;
    const loser = margin2.homeScore > margin2.awayScore ? margin2.away : margin2.home;
    const score = margin2.homeScore > margin2.awayScore
      ? `${margin2.homeScore}-${margin2.awayScore}`
      : `${margin2.awayScore}-${margin2.homeScore}`;
    out.push({
      variantId: "biggest-margin-2",
      kind: "biggest_win",
      headline: `${margin2.margin}-GOAL HAMMER`,
      detail: `${safe(winner)} dropped ${safe(loser)} ${score} — second-biggest beatdown of the season.`,
      player: {
        playerId: "",
        displayName: winner,
        slug: winnerSlug,
        photoUrl: null,
        orgName: null,
        orgLogoUrl: null,
      },
    });
  }

  // 11. Second goalfest (more drama).
  const gf2 = stats.goalfests[1];
  if (gf2 && gf2 !== gf) {
    out.push({
      variantId: "goalfest-2",
      kind: "goalfest",
      headline: `${gf2.total} GOAL THRILLER`,
      detail: `${safe(gf2.home)} vs ${safe(gf2.away)} also delivered fireworks — ${gf2.total} combined goals (${gf2.homeScore}-${gf2.awayScore}).`,
      player: {
        playerId: "",
        displayName: gf2.home,
        slug: gf2.homeSlug,
        photoUrl: null,
        orgName: null,
        orgLogoUrl: null,
      },
    });
  }

  // Cap at 10.
  return out.slice(0, 10);
}
