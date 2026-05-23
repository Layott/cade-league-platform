import type { CoverUpStatsPayload, CoverUpPlayer, DidYouKnowFact } from "./cover_up_stats";

/**
 * Did-You-Know variant catalog for overlay 25-did-you-know.
 *
 * Returns up to 24 distinct stat-driven OR personality-driven cards
 * the broadcast producer can fire at any time. Each variant has a
 * stable `variantId` + the same `{ player, headline, detail, kind }`
 * shape the overlay's `update()` consumes.
 *
 * Variant cohort design (avoid duplicating what's on OTHER overlays):
 *   - 21-streaks already shows hot-streak players                     → skip pure streak counts
 *   - 22-power-rankings already shows top 5 + their narrative blurb   → skip "X is #1"
 *   - 14-top-scorers already shows the golden boot ladder             → skip "X has N goals"
 *   - 24-biggest-margins already shows biggest beatdowns              → skip raw-margin facts
 *
 * Categories that EARN a "did you know" card:
 *   • Cross-season comparisons          ("Last season X went unbeaten vs Y; this season they've drawn")
 *   • Player-personality / quirks       (hand-curated trivia like Guru's post-goal water ritual)
 *   • Head-to-head trivia               ("Player A has yet to beat Player B in any season")
 *   • Aggregate season records          ("First player to break GD +20 in Elite Season 2")
 *   • Org / squad-builder oddities      ("Two of the top 4 are on the same EAFC manager bonus")
 *
 * Curated trivia (PLAYER_TRIVIA below) is the editable surface. New
 * facts land as new entries; existing entries can be updated when
 * the in-house storyline changes. This is intentionally an in-code
 * catalog rather than a DB table so the producer can ship a fresh
 * fact in the same PR as the trigger — no admin migration needed.
 */

export type DidYouKnowVariant = DidYouKnowFact & {
  variantId: string;
};

/**
 * Hand-curated player trivia. Each entry produces one variant card.
 *
 * STRICT RULE: only add entries from FACTS THE USER HAS PROVIDED.
 * Do not invent player habits, formations, rituals, or biographies.
 * If you don't have a verified anecdote, leave the slot empty and
 * let the computed-stats branch carry that overlay slot instead.
 *
 * Slug must match the player's gamer_tag canonical slug. To remove
 * a fact for a season, delete the row. To refresh, edit `headline`
 * / `detail`. To add a new player's quirk, append below ONLY when
 * you have a confirmed source.
 */
const PLAYER_TRIVIA: Array<{
  variantId: string;
  slug: string;
  displayName: string;
  headline: string;
  detail: string;
}> = [
  // User-provided 2026-05-23.
  {
    variantId: "trivia-guru-water-ritual",
    slug: "guru",
    displayName: "GURU",
    headline: "GURU'S WATER RITUAL",
    detail:
      "Guru takes a long sip of water after every goal he scores — a personal cooldown ritual built into his celebration.",
  },
  {
    variantId: "trivia-wolevation-pause-pressure",
    slug: "wolevation",
    displayName: "WOLEVATION",
    headline: "WOLEVATION'S PAUSE PLAY",
    detail:
      "Wolevation pauses matches at key moments — a deliberate tactic to break opponents' rhythm and disrupt their concentration.",
  },
  {
    variantId: "trivia-faruk-first-draw",
    slug: "faruk",
    displayName: "FARUK",
    headline: "FARUK'S FIRST DRAW",
    detail:
      "Faruk did not draw a single match in the previous league season. This season he's already dropped points to a stalemate — against Guru, a new Elite arrival.",
  },
];

function safe(s: string | null | undefined): string {
  return (s || "").trim();
}

function curatedPlayerVariants(): DidYouKnowVariant[] {
  return PLAYER_TRIVIA.map((t) => ({
    variantId: t.variantId,
    kind: "top_scorer" as DidYouKnowFact["kind"],
    headline: t.headline,
    detail: t.detail,
    player: {
      playerId: "",
      displayName: t.displayName,
      slug: t.slug,
      photoUrl: null,
      orgName: null,
      orgLogoUrl: null,
    },
  }));
}

export function buildDidYouKnowVariants(
  stats: CoverUpStatsPayload,
): DidYouKnowVariant[] {
  const out: DidYouKnowVariant[] = [];

  // 1. User-provided curated trivia (verified facts only — see PLAYER_TRIVIA
  //    docblock for the rule).
  out.push(...curatedPlayerVariants());

  // 2. Computed cards from real season stats. Each must NOT duplicate
  //    what's already on another overlay (no raw streak counts → 21,
  //    no top-scorers list → 14, no biggest-margin reruns → 24).
  //
  //    Headline tone: short verbal hook. Detail tone: 1-2 sentences
  //    with at least one concrete number from the row.

  // 2a. Win-streak narrative — "First player to open with N straight
  //     victories. Goal aggregate: GF / GA. +GD differential." Mirrors
  //     the broadcast voice the producer explicitly likes.
  const streak = stats.streaks[0];
  if (streak && streak.streak >= 3) {
    const detailBits: string[] = [
      `First Elite player this season to open with ${streak.streak} consecutive victories.`,
    ];
    // The streak row doesn't carry per-player GF/GA directly, but
    // the orgs table does for the player's org's top scorer when it's
    // the same player; otherwise skip the aggregate fragment rather
    // than invent.
    const orgMatch = stats.orgs.find(
      (o) => o.topPlayer && o.topPlayer.name === streak.displayName,
    );
    if (orgMatch && orgMatch.totalGd != null) {
      detailBits.push(
        `Goal-difference contribution: ${orgMatch.totalGd >= 0 ? "+" : ""}${orgMatch.totalGd}.`,
      );
    }
    detailBits.push("Untouched at the summit.");
    out.push({
      variantId: "computed-open-streak",
      kind: "longest_streak",
      headline: `${streak.streak} STRAIGHT WINS`,
      detail: detailBits.join(" "),
      player: streak as CoverUpPlayer,
    });
  }

  // 2b. Title-race gap (org table). Only when gap is interesting (≤ 5 pts).
  const orgs = stats.orgs;
  if (orgs.length >= 2) {
    const gap = orgs[0].totalPoints - orgs[1].totalPoints;
    if (gap >= 0 && gap <= 5) {
      out.push({
        variantId: "computed-org-gap",
        kind: "top_scorer",
        headline: gap === 0 ? "DEAD HEAT AT THE TOP" : `${gap}-POINT TITLE RACE`,
        detail:
          gap === 0
            ? `${safe(orgs[0].name)} and ${safe(orgs[1].name)} are level on points at the head of the org table.`
            : `${safe(orgs[0].name)} lead ${safe(orgs[1].name)} by just ${gap} ${gap === 1 ? "point" : "points"} at the head of the org table.`,
        player: orgs[0].topPlayer
          ? {
              playerId: "",
              displayName: orgs[0].topPlayer.name,
              slug: "",
              photoUrl: null,
              orgName: orgs[0].name,
              orgLogoUrl: orgs[0].logoUrl,
            }
          : null,
      });
    }
  }

  // 2c. Wildest single match (combined-score) — ONLY when the total is
  //     genuinely outlier (≥ 8). Frames as season record, not raw stat.
  const gf = stats.goalfests[0];
  if (gf && gf.total >= 8) {
    out.push({
      variantId: "computed-wildest-match",
      kind: "goalfest",
      headline: "WILDEST FIXTURE SO FAR",
      detail: `${safe(gf.home)} vs ${safe(gf.away)} finished ${gf.homeScore}-${gf.awayScore} — ${gf.total} combined goals, the chaos record of Elite Season 2.`,
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

  // Cap so the picker stays scrollable.
  return out.slice(0, 24);
}
